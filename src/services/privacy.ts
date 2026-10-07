import { getDb } from '../db/client.js';
import { customers, orders, sessions, funnelEvents, orderAttachments } from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';

const PLACEHOLDER = '[удалено]';

export async function eraseCustomerData(tenantId: string, telegramId: number): Promise<boolean> {
  const db = getDb();

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.telegramId, telegramId)))
    .limit(1);

  const customer = customerRows[0];
  if (!customer) {
    return false;
  }

  await db
    .update(customers)
    .set({
      firstName: PLACEHOLDER,
      username: null,
      phone: PLACEHOLDER,
    })
    .where(eq(customers.id, customer.id));

  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.customerId, customer.id));
  const orderIds = orderRows.map((o) => o.id);

  await db
    .update(orders)
    .set({
      contactName: PLACEHOLDER,
      contactPhone: PLACEHOLDER,
      address: PLACEHOLDER,
      comment: PLACEHOLDER,
    })
    .where(eq(orders.customerId, customer.id));

  if (orderIds.length > 0) {
    await db.delete(orderAttachments).where(inArray(orderAttachments.orderId, orderIds));
  }
  await db.delete(funnelEvents).where(eq(funnelEvents.customerId, customer.id));

  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.telegramId, telegramId)));

  for (const row of rows) {
    let data = row.data as Record<string, unknown>;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    const checkout = data.checkout as Record<string, unknown> | undefined;
    if (checkout) {
      checkout.contactName = PLACEHOLDER;
      checkout.contactPhone = PLACEHOLDER;
      checkout.address = PLACEHOLDER;
      checkout.comment = PLACEHOLDER;
      data.checkout = checkout;
    }
    data.cart = { lines: [] };
    await db
      .update(sessions)
      .set({ data })
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.telegramId, telegramId)));
  }

  return true;
}
