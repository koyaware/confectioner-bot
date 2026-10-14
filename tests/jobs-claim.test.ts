import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { JobScheduler } from '../src/jobs/scheduler.js';
import { createJob } from '../src/jobs/create.js';
import { jobs } from '../src/db/schema.js';

const testDbPath = './test-qah.db';
const appSecret = 's'.repeat(32);

describe('job claim: one worker wins', () => {
  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    process.env.APP_SECRET = appSecret;
    process.env.SUPERADMIN_TELEGRAM_ID = '1';
    initDatabase(testDbPath);
    migrate();
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    delete process.env.APP_SECRET;
    delete process.env.SUPERADMIN_TELEGRAM_ID;
  });

  it('two schedulers racing execute a job exactly once', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const seenIds: string[] = [];
    const slowHandler = async (_payload: unknown, jobId: string) => {
      seenIds.push(jobId);
      await new Promise((r) => setTimeout(r, 50));
      return { success: true as const };
    };
    const s1 = new JobScheduler();
    const s2 = new JobScheduler();
    s1.registerHandler('owner.daily_digest', slowHandler as never);
    s2.registerHandler('owner.daily_digest', slowHandler as never);
    const created = await createJob({
      type: 'owner.daily_digest',
      tenantId,
      payload: { tenantId, date: '2026-10-02' },
      runAt: new Date(Date.now() - 1000),
      dedupeKey: 'race-digest-1',
    });
    // Bypass private poll via start + immediate double poll tick.
    s1.start();
    s2.start();
    await new Promise((r) => setTimeout(r, 500));
    s1.stop();
    s2.stop();
    const rows = await getDb().select().from(jobs);
    expect(seenIds.filter((id) => id === created.id)).toHaveLength(1);
    const mine = rows.find((r) => r.id === created.id);
    expect(mine?.status).toBe('done');
  });
});
