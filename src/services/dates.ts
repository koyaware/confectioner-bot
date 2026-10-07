import { getDb } from '../db/client.js';
import { tenants, capacityOverrides, orders, products } from '../db/schema.js';
import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { Cart, IsoDate } from '../types.js';
import { addDays, compareIso, toIsoDate } from '../lib/time.js';
import { effectiveCapacity, usedUnits, OCCUPYING_STATUSES } from '../domain/capacity.js';
import { requiredLeadDays } from '../domain/pricing.js';

export type DateReason = 'CLOSED' | 'FULL' | 'TOO_SOON' | 'TOO_FAR';
export type DateAvailability = Record<IsoDate, { available: boolean; reason?: DateReason }>;

export async function getDateAvailability(
  tenantId: string,
  from: IsoDate,
  to: IsoDate,
  cart: Cart,
  now: Date
): Promise<DateAvailability> {
  const db = getDb();

  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    const out: DateAvailability = {};
    for (const d of eachDate(from, to)) out[d] = { available: false, reason: 'CLOSED' };
    return out;
  }

  const overrides = await db
    .select()
    .from(capacityOverrides)
    .where(
      and(
        eq(capacityOverrides.tenantId, tenantId),
        gte(capacityOverrides.date, from),
        lte(capacityOverrides.date, to)
      )
    );
  const overrideByDate = new Map(overrides.map((o) => [o.date, o]));

  const dayOrders = await db
    .select({ dueDate: orders.dueDate, status: orders.status, capacityUnits: orders.capacityUnits })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        gte(orders.dueDate, from),
        lte(orders.dueDate, to),
        inArray(orders.status, [...OCCUPYING_STATUSES])
      )
    );
  const ordersByDate = new Map<string, typeof dayOrders>();
  for (const o of dayOrders) {
    const arr = ordersByDate.get(o.dueDate) ?? [];
    arr.push(o);
    ordersByDate.set(o.dueDate, arr);
  }

  // Compute cart capacity units
  let cartUnits = 0;
  const productLeadDays: (number | null)[] = [];
  for (const line of cart.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) continue;
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, line.productId), eq(products.tenantId, tenantId)))
      .limit(1);
    const product = rows[0];
    if (product && line.qty >= product.minQty && line.qty <= product.maxQty) {
      cartUnits += product.capacityUnits * line.qty;
      productLeadDays.push(product.leadDays);
    }
  }

  const lead = requiredLeadDays(productLeadDays, tenant.minLeadDays);
  const today = toIsoDate(now, tenant.timezone);
  const minDate = addDays(today, lead);
  const maxDate = addDays(today, tenant.maxAdvanceDays);

  const out: DateAvailability = {};
  for (const date of eachDate(from, to)) {
    if (compareIso(date, minDate) < 0) {
      out[date] = { available: false, reason: 'TOO_SOON' };
      continue;
    }
    if (compareIso(date, maxDate) > 0) {
      out[date] = { available: false, reason: 'TOO_FAR' };
      continue;
    }
    if (!tenant.acceptOrders) {
      out[date] = { available: false, reason: 'CLOSED' };
      continue;
    }
    const override = overrideByDate.get(date);
    const eff = effectiveCapacity(tenant.defaultDailyCapacity, override);
    if (eff.closed) {
      out[date] = { available: false, reason: 'CLOSED' };
      continue;
    }
    const used = usedUnits(ordersByDate.get(date) ?? []);
    if (used >= eff.capacity || used + cartUnits > eff.capacity) {
      out[date] = { available: false, reason: 'FULL' };
      continue;
    }
    out[date] = { available: true };
  }
  return out;
}

function* eachDate(from: IsoDate, to: IsoDate): Generator<IsoDate> {
  let d = from;
  while (compareIso(d, to) <= 0) {
    yield d;
    d = addDays(d, 1);
  }
}
