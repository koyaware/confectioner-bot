import { JobResult } from '../types.js';
import { backupDbPayloadSchema } from '../types.js';
import { TelegramPort } from '../../telegram/port.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { createBackupFile } from '../../services/backup.js';
import { readFile } from 'fs/promises';

export function createBackupHandler(ports: {
  getPort: (tenantId: string) => TelegramPort | undefined;
  superadminTelegramId: number;
}) {
  return async (payload: unknown, _jobId: string): Promise<JobResult> => {
    const parsed = backupDbPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: `Invalid payload: ${parsed.error.message}` };
    }

    const filePath = await createBackupFile();

    const db = getDb();
    const activeTenants = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.status, 'active'));

    let port: TelegramPort | undefined;
    for (const tenant of activeTenants) {
      port = ports.getPort(tenant.id);
      if (port) break;
    }
    if (!port) {
      return { success: false, error: 'no running bot to send backup through' };
    }

    const buffer = await readFile(filePath);
    await port.sendDocument(
      ports.superadminTelegramId,
      buffer,
      `Бэкап БД ${new Date().toISOString().slice(0, 10)}`
    );

    return { success: true };
  };
}
