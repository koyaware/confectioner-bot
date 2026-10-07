import { getDb } from '../db/client.js';
import {
  orders,
  orderItems,
  customers,
  products,
  productOptions,
  tenants,
  capacityOverrides,
  orderEvents,
  orderAttachments,
  jobs as jobsTable,
} from '../db/schema.js';
import { and, desc, eq, inArray, max, ne } from 'drizzle-orm';
import { Cart, CheckoutDraft, Result } from '../types.js';
import { priceLine, requiredLeadDays } from '../domain/pricing.js';
import { effectiveCapacity, OCCUPYING_STATUSES, usedUnits } from '../domain/capacity.js';
import { transition } from '../domain/order-machine.js';
import { OrderEvent } from '../types.js';
import { addDays, compareIso, toIsoDate, zonedTimeToUtc } from '../lib/time.js';
import { getDateAvailability } from './dates.js';
import { nanoid } from 'nanoid';

export interface CreateOrderInput {
  tenantId: string;
  customerId: string;
  cart: Cart;
  checkout: Required<
    Pick<CheckoutDraft, 'checkoutId' | 'dueDate' | 'fulfillment' | 'contactName' | 'contactPhone'>
  > &
    CheckoutDraft;
  now: Date;
}

export type CreateOrderError =
  | 'EMPTY_CART'
  | 'PRODUCT_INACTIVE'
  | 'DATE_UNAVAILABLE'
  | 'CAPACITY_EXCEEDED'
  | 'TENANT_BUSY'
  | 'BAD_QTY'
  | 'BAD_ADDRESS'
  | 'BAD_OPTIONS'
  | 'CUSTOMER_BLOCKED';

export async function getCustomerOrderNumber(orderId: string): Promise<number | null> {
  const db = getDb();
  const row = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  if (!row) return null;

  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerId, row.customerId), eq(orders.tenantId, row.tenantId)))
    .orderBy(orders.createdAt, orders.number);

  const idx = rows.findIndex((r) => r.id === orderId);
  return idx === -1 ? null : idx + 1;
}

export async function createOrder(
  input: CreateOrderInput
): Promise<Result<typeof orders.$inferSelect, CreateOrderError>> {
  const db = getDb();

  if (input.cart.lines.length === 0) {
    return { ok: false, error: 'EMPTY_CART' };
  }

  // Retry the whole transaction if another concurrent creation grabbed our
  // order number first; idempotency collisions return the existing order.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = db.transaction((tx) => {
        const tenantRows = tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1)
          .all();
        const tenant = tenantRows[0];
        if (!tenant) {
          return { error: 'DATE_UNAVAILABLE' as const };
        }
        if (!tenant.acceptOrders) {
          return { error: 'TENANT_BUSY' as const };
        }
        if (input.checkout.fulfillment === 'delivery' && !input.checkout.address?.trim()) {
          return { error: 'BAD_ADDRESS' as const };
        }

        const customerRows = tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, input.tenantId)))
          .limit(1)
          .all();
        const customer = customerRows[0];
        if (!customer) {
          return { error: 'DATE_UNAVAILABLE' as const };
        }
        if (customer.isBlocked) {
          return { error: 'CUSTOMER_BLOCKED' as const };
        }

        // Idempotent replay: same checkoutId returns the existing order
        const existing = tx
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, input.tenantId),
              eq(orders.idempotencyKey, input.checkout.checkoutId)
            )
          )
          .limit(1)
          .all();
        if (existing.length > 0) {
          return { order: existing[0]! } as const;
        }

        // Validate cart lines against current product state
        const lines: {
          product: typeof products.$inferSelect;
          qty: number;
          options: (typeof productOptions.$inferSelect)[];
        }[] = [];

        for (const line of input.cart.lines) {
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            return { error: 'BAD_QTY' as const };
          }
          const rows = tx
            .select()
            .from(products)
            .where(and(eq(products.id, line.productId), eq(products.tenantId, input.tenantId)))
            .limit(1)
            .all();
          const product = rows[0];
          if (!product || !product.isActive) {
            return { error: 'PRODUCT_INACTIVE' as const };
          }
          if (line.qty < product.minQty || line.qty > product.maxQty) {
            return { error: 'BAD_QTY' as const };
          }
          const options = tx
            .select()
            .from(productOptions)
            .where(eq(productOptions.productId, product.id))
            .all();
          const selected = options.filter((o) => line.optionIds.includes(o.id));
          if (selected.some((o) => !o.isActive)) {
            return { error: 'PRODUCT_INACTIVE' as const };
          }
          const activeByGroup = new Map<string, string[]>();
          for (const o of options) {
            if (!o.isActive) continue;
            const ids = activeByGroup.get(o.groupTitle) ?? [];
            ids.push(o.id);
            activeByGroup.set(o.groupTitle, ids);
          }
          for (const ids of activeByGroup.values()) {
            const chosen = selected.filter((s) => ids.includes(s.id));
            if (chosen.length !== 1) {
              return { error: 'BAD_OPTIONS' as const };
            }
          }
          lines.push({
            product,
            qty: line.qty,
            options: selected,
          });
        }

        const cartCapacityUnits = lines.reduce((s, l) => s + l.product.capacityUnits * l.qty, 0);
        const lead = requiredLeadDays(
          lines.map((l) => l.product.leadDays),
          tenant.minLeadDays
        );
        const today = toIsoDate(input.now, tenant.timezone);
        const minDate = addDays(today, lead);
        const maxDate = addDays(today, tenant.maxAdvanceDays);

        if (
          compareIso(input.checkout.dueDate, minDate) < 0 ||
          compareIso(input.checkout.dueDate, maxDate) > 0
        ) {
          return { error: 'DATE_UNAVAILABLE' as const };
        }

        const dayOrders = tx
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, input.tenantId),
              eq(orders.dueDate, input.checkout.dueDate),
              inArray(orders.status, [...OCCUPYING_STATUSES])
            )
          )
          .all();

        const overrideRows = tx
          .select()
          .from(capacityOverrides)
          .where(
            and(
              eq(capacityOverrides.tenantId, input.tenantId),
              eq(capacityOverrides.date, input.checkout.dueDate)
            )
          )
          .all();

        const eff = effectiveCapacity(tenant.defaultDailyCapacity, overrideRows[0]);
        if (eff.closed) {
          return { error: 'DATE_UNAVAILABLE' as const };
        }
        const used = usedUnits(dayOrders);
        if (used >= eff.capacity || used + cartCapacityUnits > eff.capacity) {
          return { error: 'CAPACITY_EXCEEDED' as const };
        }

        const maxRow = tx
          .select({ value: max(orders.number) })
          .from(orders)
          .where(eq(orders.tenantId, input.tenantId))
          .all();
        const nextNumber = (maxRow[0]?.value ?? 0) + 1;

        let itemsTotal = 0;
        const itemRows: (typeof orderItems.$inferInsert)[] = [];

        const orderId = nanoid(10);
        for (const l of lines) {
          const unitPrice = priceLine(
            l.product.priceMinor,
            l.options.map((o) => o.priceDeltaMinor),
            1
          );
          if (unitPrice <= 0) {
            return { error: 'BAD_QTY' as const };
          }
          itemsTotal += unitPrice * l.qty;
          itemRows.push({
            id: nanoid(),
            orderId,
            productId: l.product.id,
            titleSnapshot: l.product.title,
            optionsSnapshot: l.options.map((o) => ({
              group: o.groupTitle,
              title: o.title,
              deltaMinor: o.priceDeltaMinor,
            })),
            unitPriceMinor: unitPrice,
            qty: l.qty,
            capacityUnits: l.product.capacityUnits * l.qty,
          });
        }

        const deliveryFee = input.checkout.fulfillment === 'delivery' ? tenant.deliveryFeeMinor : 0;
        const total = itemsTotal + deliveryFee;
        const percent = Math.min(100, Math.max(0, tenant.prepaymentPercent));
        const prepayment = Math.ceil((total * percent) / 100);

        tx.insert(orders)
          .values({
            id: orderId,
            tenantId: input.tenantId,
            number: nextNumber,
            customerId: input.customerId,
            status: 'new',
            dueDate: input.checkout.dueDate,
            dueTimeText: input.checkout.dueTimeText ?? null,
            fulfillment: input.checkout.fulfillment,
            address: input.checkout.address ?? null,
            contactName: input.checkout.contactName,
            contactPhone: input.checkout.contactPhone,
            comment: input.checkout.comment ?? null,
            itemsTotalMinor: itemsTotal,
            deliveryFeeMinor: deliveryFee,
            totalMinor: total,
            prepaymentMinor: prepayment,
            capacityUnits: cartCapacityUnits,
            source: customer?.source ?? null,
            idempotencyKey: input.checkout.checkoutId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();

        for (const row of itemRows) {
          tx.insert(orderItems).values(row).run();
        }

        for (const ref of input.checkout.referenceFileIds ?? []) {
          tx.insert(orderAttachments)
            .values({
              id: nanoid(),
              orderId,
              kind: 'reference',
              fileId: ref.fileId,
              fileType: ref.fileType,
              createdAt: input.now,
            })
            .run();
        }

        tx.insert(orderEvents)
          .values({
            id: nanoid(),
            orderId,
            type: 'order_created',
            actor: 'customer',
            createdAt: input.now,
          })
          .run();

        const createdRows = tx.select().from(orders).where(eq(orders.id, orderId)).all();
        return { order: createdRows[0]! } as const;
      });

      if ('error' in result && result.error) {
        return { ok: false, error: result.error };
      }
      return { ok: true, value: (result as { order: typeof orders.$inferSelect }).order };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        if (error.message.includes('orders.number')) {
          continue;
        }
        const rows = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, input.tenantId),
              eq(orders.idempotencyKey, input.checkout.checkoutId)
            )
          )
          .limit(1);
        if (rows.length > 0) {
          return { ok: true, value: rows[0]! };
        }
      }
      throw error;
    }
  }
  throw new Error('Failed to allocate order number after 3 attempts');
}

export async function applyOrderEvent(
  orderId: string,
  event: OrderEvent,
  actor: 'customer' | 'owner' | 'system',
  now: Date
): Promise<Result<typeof orders.$inferSelect, 'NOT_FOUND' | 'ILLEGAL_TRANSITION'>> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const result = transition(
    { status: order.status, prepaymentMinor: order.prepaymentMinor },
    event
  );
  if (!result.ok) {
    return { ok: false, error: 'ILLEGAL_TRANSITION' };
  }

  const decidedEvents = [
    'owner_accept',
    'owner_reject',
    'customer_cancel',
    'payment_timeout',
    'payment_confirmed',
    'payment_rejected',
    'owner_cancel',
  ];

  // Set paymentDueAt when entering awaiting_payment, and schedule jobs
  let paymentDueAt = order.paymentDueAt;
  let reminderAt: Date | null = null;
  if (result.value.status === 'awaiting_payment') {
    const tenantRows = await db
      .select({ hours: tenants.paymentDeadlineHours })
      .from(tenants)
      .where(eq(tenants.id, order.tenantId))
      .limit(1);
    const hours = tenantRows[0]?.hours ?? 24;
    paymentDueAt = new Date(now.getTime() + hours * 3600_000);
    reminderAt = new Date(now.getTime() + (hours * 3600_000) / 2);
  }

  let pickupAt: Date | null = null;
  if (result.value.status === 'confirmed') {
    const tzRows = await db
      .select({ tz: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, order.tenantId))
      .limit(1);
    const tz = tzRows[0]?.tz ?? 'Europe/Moscow';
    const candidate = zonedTimeToUtc(addDays(order.dueDate, -1), '10:00', tz);
    if (candidate.getTime() > now.getTime()) {
      pickupAt = candidate;
    }
  }

  db.transaction((tx) => {
    tx.update(orders)
      .set({
        status: result.value.status,
        decidedAt: decidedEvents.includes(event) ? now : order.decidedAt,
        updatedAt: now,
        paymentDueAt,
      })
      .where(eq(orders.id, orderId))
      .run();

    if (reminderAt && paymentDueAt) {
      tx.insert(jobsTable)
        .values({
          id: nanoid(),
          type: 'order.payment_reminder',
          tenantId: order.tenantId,
          payload: { orderId: order.id },
          runAt: reminderAt,
          status: 'pending',
          attempts: 0,
          dedupeKey: `payrem:${order.id}`,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: jobsTable.dedupeKey,
          set: { runAt: reminderAt, status: 'pending', attempts: 0, lastError: null },
        })
        .run();

      tx.insert(jobsTable)
        .values({
          id: nanoid(),
          type: 'order.expire',
          tenantId: order.tenantId,
          payload: { orderId: order.id },
          runAt: paymentDueAt,
          status: 'pending',
          attempts: 0,
          dedupeKey: `expire:${order.id}`,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: jobsTable.dedupeKey,
          set: { runAt: paymentDueAt, status: 'pending', attempts: 0, lastError: null },
        })
        .run();
    }

    if (pickupAt) {
      tx.insert(jobsTable)
        .values({
          id: nanoid(),
          type: 'customer.pickup_reminder',
          tenantId: order.tenantId,
          payload: { orderId: order.id },
          runAt: pickupAt,
          status: 'pending',
          attempts: 0,
          dedupeKey: `pickup:${order.id}`,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: jobsTable.dedupeKey,
          set: { runAt: pickupAt, status: 'pending', attempts: 0, lastError: null },
        })
        .run();
    }

    tx.insert(orderEvents)
      .values({
        id: nanoid(),
        orderId,
        type: event,
        actor,
        createdAt: now,
      })
      .run();
  });

  const updated = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return { ok: true, value: updated[0]! };
}

export async function listCustomerOrders(
  tenantId: string,
  telegramId: number,
  limit = 20
): Promise<(typeof orders.$inferSelect)[]> {
  const db = getDb();
  const rows = await db
    .select({ order: orders })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(customers.tenantId, tenantId),
        eq(customers.telegramId, telegramId),
        ne(orders.status, 'cancelled')
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((r) => r.order);
}

export type AcceptProposedDateError = 'NOT_FOUND' | 'DATE_UNAVAILABLE' | 'ILLEGAL_TRANSITION';

/**
 * Customer accepts the owner's proposed date.
 * Capacity is re-checked and the date swap + status guard happen
 * atomically inside one transaction.
 */
export async function acceptProposedDate(
  orderId: string,
  tenantId: string,
  telegramId: number,
  now: Date
): Promise<Result<typeof orders.$inferSelect, AcceptProposedDateError>> {
  const db = getDb();
  const found = (
    await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, tenantId),
          eq(customers.telegramId, telegramId),
          eq(customers.tenantId, tenantId)
        )
      )
      .limit(1)
  )[0];
  if (!found || found.order.status !== 'new' || !found.order.proposedDate) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const proposed = found.order.proposedDate;

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const cartLines = items
    .filter((i) => i.productId !== null)
    .map((i, idx) => ({
      lineId: `l${idx}`,
      productId: i.productId!,
      qty: i.qty,
      optionIds: [] as string[],
    }));
  const avail = await getDateAvailability(tenantId, proposed, proposed, { lines: cartLines }, now);
  if (!avail[proposed]?.available) {
    return { ok: false, error: 'DATE_UNAVAILABLE' };
  }

  const committed: 'NOT_FOUND' | 'DATE_UNAVAILABLE' | 'ILLEGAL_TRANSITION' | null = db.transaction(
    (tx) => {
      const cur = tx
        .select()
        .from(orders)
        .where(
          and(eq(orders.id, orderId), eq(orders.status, 'new'), eq(orders.proposedDate, proposed))
        )
        .limit(1)
        .all();
      if (cur.length === 0) {
        return 'ILLEGAL_TRANSITION';
      }
      const tenantRows = tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1).all();
      const tenant = tenantRows[0];
      if (!tenant) {
        return 'NOT_FOUND';
      }
      const overrideRows = tx
        .select()
        .from(capacityOverrides)
        .where(and(eq(capacityOverrides.tenantId, tenantId), eq(capacityOverrides.date, proposed)))
        .all();
      const eff = effectiveCapacity(tenant.defaultDailyCapacity, overrideRows[0]);
      if (eff.closed) {
        return 'DATE_UNAVAILABLE';
      }
      const dayOrders = tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            eq(orders.dueDate, proposed),
            inArray(orders.status, [...OCCUPYING_STATUSES])
          )
        )
        .all();
      const used = usedUnits(dayOrders);
      if (used + cur[0]!.capacityUnits > eff.capacity) {
        return 'DATE_UNAVAILABLE';
      }
      tx.update(orders)
        .set({ dueDate: proposed, proposedDate: null, updatedAt: now })
        .where(eq(orders.id, orderId))
        .run();
      return null;
    }
  );

  if (committed === 'ILLEGAL_TRANSITION') {
    return { ok: false, error: 'ILLEGAL_TRANSITION' };
  }
  if (committed) {
    return { ok: false, error: committed };
  }
  return applyOrderEvent(orderId, 'owner_accept', 'customer', now);
}
