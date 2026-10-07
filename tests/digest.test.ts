import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { tenants, orders, customers, jobs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { computeDigest, ensureDailyDigestJobs } from '../src/services/digest.js';
import { createDailyDigestHandler } from '../src/jobs/handlers/daily-digest.js';
import { FakePort } from '../src/telegram/fake-port.js';

describe('daily digest', () => {
  const testDbPath = './test-digest.db';
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
  });

  async function setup() {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    await db
      .update(tenants)
      .set({ ownerTelegramId: 555, digestHour: 9 })
      .where(eq(tenants.id, tenantId));
    await db.insert(customers).values({
      id: 'c1',
      tenantId,
      telegramId: 42,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return tenantId;
  }

  it('computes today/tomorrow and pending counts', async () => {
    const tenantId = await setup();
    const db = getDb();
    await db.insert(orders).values([
      {
        id: 'o1',
        tenantId,
        number: 1,
        customerId: 'c1',
        status: 'new',
        dueDate: '2026-10-02',
        fulfillment: 'pickup',
        contactName: 'A',
        contactPhone: '1',
        itemsTotalMinor: 10000,
        totalMinor: 10000,
        prepaymentMinor: 5000,
        capacityUnits: 1,
        idempotencyKey: 'k1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'o2',
        tenantId,
        number: 2,
        customerId: 'c1',
        status: 'awaiting_payment',
        dueDate: '2026-10-03',
        fulfillment: 'pickup',
        contactName: 'B',
        contactPhone: '2',
        itemsTotalMinor: 5000,
        totalMinor: 5000,
        prepaymentMinor: 2500,
        capacityUnits: 1,
        idempotencyKey: 'k2',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const d = await computeDigest(tenantId, '2026-10-02');
    expect(d.todayCount).toBe(1);
    expect(d.tomorrowCount).toBe(1);
    expect(d.awaitingDecisionCount).toBe(1);
    expect(d.awaitingPaymentCount).toBe(1);
    expect(d.today.map((o) => o.number)).toEqual([1]);
    expect(d.tomorrow.map((o) => o.number)).toEqual([2]);
  });

  it('ensureDailyDigestJobs creates one deduped job for today', async () => {
    const tenantId = await setup();
    await ensureDailyDigestJobs(now);
    await ensureDailyDigestJobs(now);
    const all = await getDb().select().from(jobs);
    const digestJobs = all.filter((j) => j.type === 'owner.daily_digest');
    expect(digestJobs).toHaveLength(1);
    expect(digestJobs[0]!.dedupeKey).toBe(`digest:${tenantId}:2026-10-02`);
  });

  it('handler sends digest and is syntactically HTML formatted', async () => {
    const tenantId = await setup();
    const db = getDb();
    const { orders } = await import('../src/db/schema.js');
    await db.insert(orders).values({
      id: 'o1',
      tenantId,
      number: 1,
      customerId: 'c1',
      status: 'new',
      dueDate: '2026-10-02',
      fulfillment: 'pickup',
      contactName: 'A',
      contactPhone: '1',
      itemsTotalMinor: 10000,
      totalMinor: 10000,
      prepaymentMinor: 5000,
      capacityUnits: 1,
      idempotencyKey: 'k1',
      createdAt: now,
      updatedAt: now,
    });
    const port = new FakePort();
    const handler = createDailyDigestHandler({ getPort: () => port });
    const result = await handler({ tenantId, date: '2026-10-02' }, 'job1');
    expect(result.success).toBe(true);
    const sent = port.getCallsForMethod('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[0]).toBe(555);
    expect(sent[0]!.args[1]).toContain('Сводка на 2026-10-02');
    expect(sent[0]!.args[1]).toContain('№1');
    expect(JSON.stringify(sent[0]!.args[2])).toContain('adm:ord:view:o1');
  });

  it('owner BLOCKED is terminal, not retried', async () => {
    const tenantId = await setup();
    const port = new FakePort();
    port.addBlockedOnFirstCall('sendMessage');
    const handler = createDailyDigestHandler({ getPort: () => port });

    const result = await handler({ tenantId, date: '2026-10-02' }, 'job1');
    expect(result.success).toBe(true);
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(1);
  });
});
