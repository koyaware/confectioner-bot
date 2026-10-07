import { JobHandler, JobResult } from '../types.js';
import { getDb } from '../../db/client.js';
import { customers, orders, tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { applyOrderEvent, getCustomerOrderNumber } from '../../services/orders.js';
import { TelegramPort, TelegramError } from '../../telegram/port.js';
import { formatMinor } from '../../lib/money.js';

export interface PortResolver {
  getPort(tenantId: string): TelegramPort | undefined;
}

async function getOrderWithCustomer(orderId: string) {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return { order: undefined, customer: undefined, tenant: undefined };
  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
  return { order, customer: customerRows[0], tenant: tenantRows[0] };
}

export function createPaymentReminderHandler(ports: PortResolver): JobHandler<{ orderId: string }> {
  return async (payload, _jobId): Promise<JobResult> => {
    const { order, customer, tenant } = await getOrderWithCustomer(payload.orderId);
    if (!order || order.status !== 'awaiting_payment' || !customer || !tenant) {
      return { success: true };
    }
    if (customer.botBlocked) {
      return { success: true };
    }
    const port = ports.getPort(order.tenantId);
    if (!port) {
      return { success: false, error: `no bot for tenant ${order.tenantId}` };
    }
    try {
      const deadline = order.paymentDueAt
        ? new Intl.DateTimeFormat('ru-RU', {
            timeZone: tenant.timezone,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(order.paymentDueAt))
        : '—';
      await port.sendMessage(
        customer.telegramId,
        `Напоминаем: предоплата по заказу №${(await getCustomerOrderNumber(order.id)) ?? order.number} — ${formatMinor(order.prepaymentMinor, tenant.currency)}. Срок до ${deadline}.`
      );
    } catch (error) {
      if (error instanceof TelegramError && error.code === 'BLOCKED') {
        const db = getDb();
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
        return { success: true };
      }
      return { success: false, error: String(error) };
    }
    return { success: true };
  };
}

export function createPaymentExpireHandler(ports: PortResolver): JobHandler<{ orderId: string }> {
  return async (payload, _jobId): Promise<JobResult> => {
    const { order, customer, tenant } = await getOrderWithCustomer(payload.orderId);
    if (!order || order.status !== 'awaiting_payment') {
      return { success: true };
    }
    const result = await applyOrderEvent(order.id, 'payment_timeout', 'system', new Date());
    if (!result.ok) {
      return { success: true };
    }

    const port = ports.getPort(order.tenantId);
    if (port) {
      if (customer && !customer.botBlocked) {
        try {
          await port.sendMessage(
            customer.telegramId,
            `Заказ №${(await getCustomerOrderNumber(order.id)) ?? order.number} снят: предоплата не поступила вовремя.`
          );
        } catch (error) {
          if (error instanceof TelegramError && error.code === 'BLOCKED') {
            const db = getDb();
            await db
              .update(customers)
              .set({ botBlocked: true })
              .where(eq(customers.id, customer.id));
          }
        }
      }
      if (tenant?.ownerTelegramId) {
        try {
          await port.sendMessage(
            tenant.ownerTelegramId,
            `Заказ №${order.number} снят: клиент не оплатил предоплату вовремя.`
          );
        } catch {
          // noop
        }
      }
    }
    return { success: true };
  };
}
