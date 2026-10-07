import { createJob } from '../jobs/create.js';
import { backupDatabase } from '../db/client.js';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

const KEEP_BACKUPS = 7;

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
  await pruneOldBackups(dir);
  return path;
}

async function pruneOldBackups(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.startsWith('backup-') && f.endsWith('.db'));
  if (files.length <= KEEP_BACKUPS) return;
  const withTime = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await stat(join(dir, f))).mtimeMs }))
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  for (const { f } of withTime.slice(KEEP_BACKUPS)) {
    await unlink(join(dir, f));
  }
}
