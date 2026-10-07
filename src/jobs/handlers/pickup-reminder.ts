import { JobHandler, JobResult } from '../types.js';
import { getDb } from '../../db/client.js';
import { customers, orders, tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { TelegramPort } from '../../telegram/port.js';

export function createPickupReminderHandler(ports: {
  getPort(tenantId: string): TelegramPort | undefined;
}): JobHandler<{ orderId: string }> {
  return async (payload, _jobId): Promise<JobResult> => {
    const db = getDb();
    const rows = await db.select().from(orders).where(eq(orders.id, payload.orderId)).limit(1);
    const order = rows[0];
    if (!order || (order.status !== 'confirmed' && order.status !== 'ready')) {
      return { success: true };
    }
    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);
    const customer = customerRows[0];
    const tenantRows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, order.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!customer || customer.botBlocked || !tenant) {
      return { success: true };
    }
    const port = ports.getPort(order.tenantId);
    if (!port) {
      return { success: false, error: `no bot for tenant ${order.tenantId}` };
    }
    const detail =
      order.fulfillment === 'delivery'
        ? `доставка${order.address ? `, адрес: ${order.address}` : ''}`
        : 'самовывоз';
    await port.sendMessage(
      customer.telegramId,
      `Напоминание: заказ №${order.number} — ${order.dueDate}${order.dueTimeText ? `, ${order.dueTimeText}` : ''}. ${detail}.`
    );
    return { success: true };
  };
}
