import { getDb } from '../db/client.js';
import { customers, orders, sessions } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

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
      firstName: '[удалено]',
      username: null,
      phone: '[удалено]',
    })
    .where(eq(customers.id, customer.id));

  await db
    .update(orders)
    .set({
      contactName: '[удалено]',
      contactPhone: '[удалено]',
      address: '[удалено]',
      comment: '[удалено]',
    })
    .where(eq(orders.customerId, customer.id));

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
      checkout.contactName = '[удалено]';
      checkout.contactPhone = '[удалено]';
      checkout.address = '[удалено]';
      checkout.comment = '[удалено]';
      data.checkout = checkout;
    }
    await db
      .update(sessions)
      .set({ data: JSON.stringify(data) })
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.telegramId, telegramId)));
  }

  return true;
}
