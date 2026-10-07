import { getDb } from '../db/client.js';
import { customers, tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { SendOpts, TelegramError, TelegramPort } from '../telegram/port.js';

export type CustomerSendResult = 'sent' | 'blocked' | 'failed';

/**
 * Send a message to a customer through a bot port.
 * On BLOCKED: marks customers.botBlocked and notifies the owner exactly once
 * (guarded by the previous flag value). Other errors are rethrown so the
 * job scheduler can retry them.
 */
export async function sendCustomerMessage(
  port: TelegramPort,
  tenantId: string,
  customerId: string,
  text: string,
  opts?: SendOpts
): Promise<CustomerSendResult> {
  const db = getDb();
  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const customer = customerRows[0];
  const tenant = tenantRows[0];
  if (!customer || !tenant || customer.tenantId !== tenantId) {
    return 'failed';
  }

  try {
    await port.sendMessage(customer.telegramId, text, opts);
    return 'sent';
  } catch (error) {
    if (error instanceof TelegramError && error.code === 'BLOCKED') {
      if (!customer.botBlocked) {
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
        if (tenant.ownerTelegramId) {
          try {
            await port.sendMessage(
              tenant.ownerTelegramId,
              `Клиент ${customer.firstName ?? ''}${customer.username ? ` (@${customer.username})` : ''} заблокировал бота. Уведомления ему не дойдут.`
            );
          } catch {
            // owner unreachable: flag is already stored, job succeeds
          }
        }
      }
      return 'blocked';
    }
    throw error;
  }
}
