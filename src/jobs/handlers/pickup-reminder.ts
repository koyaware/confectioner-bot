import { JobHandler, JobResult } from '../types.js';
import { getDb } from '../../db/client.js';
import { customers, orders, tenants } from '../../db/schema.js';
import { getCustomerOrderNumber } from '../../services/orders.js';
import { sendCustomerMessage } from '../../services/notify.js';
import { TelegramPort } from '../../telegram/port.js';
import { stringsFor } from '../../i18n/index.js';
import { eq } from 'drizzle-orm';

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
    const t = stringsFor(tenant.language);
    const detail =
      order.fulfillment === 'delivery'
        ? order.address
          ? t.jobs.pickupDeliveryAddr(order.address)
          : t.jobs.pickupDelivery
        : t.jobs.pickupPickup;
    try {
      const result = await sendCustomerMessage(
        port,
        order.tenantId,
        customer.id,
        t.jobs.pickup(
          (await getCustomerOrderNumber(order.id)) ?? order.number,
          `${order.dueDate}${order.dueTimeText ? `, ${order.dueTimeText}` : ''}`,
          detail
        )
      );
      if (result === 'failed') {
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
    return { success: true };
  };
}
