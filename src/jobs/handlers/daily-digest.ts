import { JobResult } from '../types.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { TelegramError, TelegramPort } from '../../telegram/port.js';
import { ownerDailyDigestPayloadSchema } from '../types.js';
import { computeDigest, formatDigest } from '../../services/digest.js';

export function createDailyDigestHandler(ports: {
  getPort: (tenantId: string) => TelegramPort | undefined;
}) {
  return async (payload: unknown, _jobId: string): Promise<JobResult> => {
    const parsed = ownerDailyDigestPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Invalid payload: ${parsed.error.message}` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.date)) {
      return { success: false, error: 'Invalid digest date' };
    }

    const db = getDb();
    const tenantRows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, parsed.data.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active' || !tenant.ownerTelegramId) {
      return { success: true };
    }
    const port = ports.getPort(tenant.id);
    if (!port) {
      return { success: false, error: `no bot for tenant ${tenant.id}` };
    }

    const summary = await computeDigest(tenant.id, parsed.data.date);
    try {
      await port.sendMessage(tenant.ownerTelegramId, formatDigest(summary), {
        parseMode: 'HTML',
      });
    } catch (error) {
      if (error instanceof TelegramError && error.code === 'BLOCKED') {
        // Owner blocked the bot: retrying cannot help.
        return { success: true };
      }
      return { success: false, error: String(error) };
    }
    return { success: true };
  };
}
