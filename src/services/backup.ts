import { createJob } from '../jobs/create.js';
import { backupDatabase } from '../db/client.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';

export async function ensureDailyBackupJob(now: Date = new Date()): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  const runAt = new Date(`${date}T03:00:00Z`);

  await createJob({
    type: 'backup.db',
    tenantId: undefined,
    payload: {},
    runAt,
    dedupeKey: `backup:${date}`,
  });
}

export async function createBackupFile(now: Date = new Date()): Promise<string> {
  const date = now.toISOString().slice(0, 10);
  const dir = join(process.cwd(), 'backups');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `backup-${date}.db`);
  await backupDatabase(path);
  return path;
}
