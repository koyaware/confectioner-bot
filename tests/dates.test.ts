import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { getDateAvailability } from '../src/services/dates.js';
import { capacityOverrides, orders, tenants, orderItems, customers } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { eq } from 'drizzle-orm';

describe('getDateAvailability', () => {
  const testDbPath = './test-dates.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z'); // Fri Oct 2 2026 (Moscow: UTC+3)

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

  it('dates before min lead are TOO_SOON and not available', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');

    const avail = await getDateAvailability(tenantId, today, addDays(today, 5), { lines: [] }, now);

    expect(avail[today]!.available).toBe(false);
    expect(avail[today]!.reason).toBe('TOO_SOON');
    // minLeadDays default 2
    expect(avail[addDays(today, 1)]!.reason).toBe('TOO_SOON');
    expect(avail[addDays(today, 2)]!.available).toBe(true);
  });

  it('closed day is CLOSED and not available', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');
    const closed = addDays(today, 3);

    await getDb()
      .insert(capacityOverrides)
      .values({ tenantId, date: closed, capacity: 5, isClosed: true });

    const avail = await getDateAvailability(tenantId, closed, closed, { lines: [] }, now);
    expect(avail[closed]!.available).toBe(false);
    expect(avail[closed]!.reason).toBe('CLOSED');
  });

  it('full day is FULL and not available', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');
    const full = addDays(today, 4);

    // occupy default capacity (5) with 5 orders of 1 unit
    await getDb()
      .insert(customers)
      .values({ id: 'c1', tenantId, telegramId: 7, firstSeenAt: now, lastSeenAt: now });
    for (let i = 0; i < 5; i++) {
      await getDb()
        .insert(orders)
        .values({
          id: `o${i}`,
          tenantId,
          number: i + 1,
          customerId: 'c1',
          status: 'confirmed',
          dueDate: full,
          fulfillment: 'pickup',
          contactName: 'A',
          contactPhone: '1',
          itemsTotalMinor: 100,
          totalMinor: 100,
          prepaymentMinor: 0,
          capacityUnits: 1,
          idempotencyKey: `k${i}`,
          createdAt: now,
          updatedAt: now,
        });
    }

    const avail = await getDateAvailability(tenantId, full, full, { lines: [] }, now);
    expect(avail[full]!.available).toBe(false);
    expect(avail[full]!.reason).toBe('FULL');
  });

  it('rejected/cancelled/expired orders free the slots', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');
    const target = addDays(today, 4);

    await getDb()
      .insert(customers)
      .values({ id: 'c1', tenantId, telegramId: 7, firstSeenAt: now, lastSeenAt: now });
    for (let i = 0; i < 5; i++) {
      await getDb()
        .insert(orders)
        .values({
          id: `o${i}`,
          tenantId,
          number: i + 1,
          customerId: 'c1',
          status: 'cancelled',
          dueDate: target,
          fulfillment: 'pickup',
          contactName: 'A',
          contactPhone: '1',
          itemsTotalMinor: 100,
          totalMinor: 100,
          prepaymentMinor: 0,
          capacityUnits: 1,
          idempotencyKey: `k${i}`,
          createdAt: now,
          updatedAt: now,
        });
    }

    const avail = await getDateAvailability(tenantId, target, target, { lines: [] }, now);
    expect(avail[target]!.available).toBe(true);
  });

  it('days beyond maxAdvanceDays are TOO_FAR', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');
    const far = addDays(today, 61);

    const avail = await getDateAvailability(tenantId, far, far, { lines: [] }, now);
    expect(avail[far]!.reason).toBe('TOO_FAR');
  });

  it('acceptOrders=false marks every date CLOSED', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ acceptOrders: false }).where(eq(tenants.id, tenantId));
    const today = toIsoDate(now, 'Europe/Moscow');

    const avail = await getDateAvailability(
      tenantId,
      addDays(today, 3),
      addDays(today, 4),
      { lines: [] },
      now
    );
    expect(avail[addDays(today, 3)]!.reason).toBe('CLOSED');
  });
});
