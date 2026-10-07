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
} from '../db/schema.js';
import { and, eq, inArray, max } from 'drizzle-orm';
import { Cart, CheckoutDraft, Result } from '../types.js';
import { priceLine, requiredLeadDays } from '../domain/pricing.js';
import { effectiveCapacity, OCCUPYING_STATUSES, usedUnits } from '../domain/capacity.js';
import { transition } from '../domain/order-machine.js';
import { OrderEvent } from '../types.js';
import { addDays, compareIso, toIsoDate } from '../domain/dates.js';
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
  | 'BAD_QTY';

export async function createOrder(
  input: CreateOrderInput
): Promise<Result<typeof orders.$inferSelect, CreateOrderError>> {
  const db = getDb();

  if (input.cart.lines.length === 0) {
    return { ok: false, error: 'EMPTY_CART' };
  }

  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    return { ok: false, error: 'DATE_UNAVAILABLE' };
  }
  if (!tenant.acceptOrders) {
    return { ok: false, error: 'TENANT_BUSY' };
  }

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, input.tenantId)))
    .limit(1);
  const customer = customerRows[0];

  // Idempotent replay: same checkoutId returns the existing order
  const existing = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.tenantId, input.tenantId), eq(orders.idempotencyKey, input.checkout.checkoutId))
    )
    .limit(1);
  if (existing.length > 0) {
    return { ok: true, value: existing[0]! };
  }

  // Validate cart lines against current product state
  const lines: {
    product: typeof products.$inferSelect;
    qty: number;
    options: (typeof productOptions.$inferSelect)[];
  }[] = [];

  for (const line of input.cart.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      return { ok: false, error: 'BAD_QTY' };
    }
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, line.productId), eq(products.tenantId, input.tenantId)))
      .limit(1);
    const product = rows[0];
    if (!product || !product.isActive) {
      return { ok: false, error: 'PRODUCT_INACTIVE' };
    }
    if (line.qty < product.minQty || line.qty > product.maxQty) {
      return { ok: false, error: 'BAD_QTY' };
    }
    const options = await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, product.id));
    lines.push({
      product,
      qty: line.qty,
      options: options.filter((o) => line.optionIds.includes(o.id)),
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
    return { ok: false, error: 'DATE_UNAVAILABLE' };
  }

  try {
    const result = db.transaction((tx) => {
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

      const orderId = nanoid();
      for (const l of lines) {
        const unitPrice = priceLine(
          l.product.priceMinor,
          l.options.map((o) => o.priceDeltaMinor),
          1
        );
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
      const prepayment = Math.ceil((total * tenant.prepaymentPercent) / 100);

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

  db.transaction((tx) => {
    tx.update(orders)
      .set({
        status: result.value.status,
        decidedAt: decidedEvents.includes(event) ? now : order.decidedAt,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId))
      .run();

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
