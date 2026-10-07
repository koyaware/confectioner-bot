import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, rmSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { jobs, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureDailyBackupJob, createBackupFile } from '../src/services/backup.js';
import { createBackupHandler } from '../src/jobs/handlers/backup.js';
import { FakePort } from '../src/telegram/fake-port.js';
import Database from 'better-sqlite3';

describe('backup', () => {
  const testDbPath = './test-backup.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    process.env.APP_SECRET = appSecret;
    initDatabase(testDbPath);
    migrate();
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    delete process.env.APP_SECRET;
    try {
      rmSync(`./backups/backup-${now.toISOString().slice(0, 10)}.db`, { force: true });
      rmSync(`./backups`, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('ensureDailyBackupJob creates one job per day', async () => {
    await seedDemo(appSecret, now);
    await ensureDailyBackupJob(now);
    await ensureDailyBackupJob(now);
    const all = await getDb().select().from(jobs);
    const backupJobs = all.filter((j) => j.type === 'backup.db');
    expect(backupJobs).toHaveLength(1);
    expect(backupJobs[0]!.dedupeKey).toBe(`backup:${now.toISOString().slice(0, 10)}`);
    expect(backupJobs[0]!.runAt.toISOString()).toBe(
      `${now.toISOString().slice(0, 10)}T03:00:00.000Z`
    );
  });

  it('backup file passes integrity check', async () => {
    await seedDemo(appSecret, now);
    const path = await createBackupFile(now);
    const db = new Database(path, { readonly: true });
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(row.integrity_check).toBe('ok');
    db.close();
  });

  it('backup handler sends the file to superadmin', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const handler = createBackupHandler({ getPort: () => port, superadminTelegramId: 1 });

    const result = await handler({}, 'job-backup');
    expect(result.success).toBe(true);

    const docs = port.getCallsForMethod('sendDocument');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.args[0]).toBe(1);
    expect(Buffer.isBuffer(docs[0]!.args[1])).toBe(true);
  });

  it('prunes old backups, keeping the newest 7', async () => {
    await seedDemo(appSecret, now);
    const { mkdirSync, writeFileSync, utimesSync, readdirSync } = await import('fs');
    mkdirSync('./backups', { recursive: true });
    for (let i = 0; i < 8; i++) {
      const name = `./backups/backup-2026-09-${String(i + 1).padStart(2, '0')}.db`;
      writeFileSync(name, 'x');
      const t = new Date(Date.now() - (10 - i) * 86400_000);
      utimesSync(name, t, t);
    }
    await createBackupFile(now);
    expect(readdirSync('./backups')).toHaveLength(7);
  });
});
