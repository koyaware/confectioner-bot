import { JobResult } from '../types.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { TelegramPort } from '../../telegram/port.js';
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

    const db = getDb();
    const tenantRows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, parsed.data.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant || !tenant.ownerTelegramId) {
      return { success: true };
    }
    const port = ports.getPort(tenant.id);
    if (!port) {
      return { success: false, error: `no bot for tenant ${tenant.id}` };
    }

    const summary = await computeDigest(tenant.id, parsed.data.date);
    await port.sendMessage(tenant.ownerTelegramId, formatDigest(summary), {
      parseMode: 'HTML',
    });
    return { success: true };
  };
}
