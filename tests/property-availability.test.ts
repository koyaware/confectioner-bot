import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { getDateAvailability } from '../src/services/dates.js';
import { capacityOverrides, customers, orders } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('getDateAvailability invariants (property)', () => {
  const testDbPath = './test-propav.db';
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

  it('closed or too-soon or full dates are never available, regardless of random input', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 90 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 8 }),
        async (offset, closedFlag, usedCount) => {
          const date = addDays(today, offset);
          // randomize state: closed override or not, and number of occupying orders
          await getDb().delete(capacityOverrides);
          await getDb().delete(orders);
          if (closedFlag) {
            await getDb()
              .insert(capacityOverrides)
              .values({ tenantId, date, capacity: 5, isClosed: true });
          }
          await getDb()
            .delete(customers)
            .catch(() => undefined);
          await getDb().insert(customers).values({
            id: 'c1',
            tenantId,
            telegramId: 7,
            firstSeenAt: now,
            lastSeenAt: now,
          });
          for (let i = 0; i < usedCount; i++) {
            await getDb()
              .insert(orders)
              .values({
                id: `o${i}`,
                tenantId,
                number: i + 1,
                customerId: 'c1',
                status: 'confirmed',
                dueDate: date,
                fulfillment: 'pickup',
                contactName: 'A',
                contactPhone: '1',
                itemsTotalMinor: 100,
                totalMinor: 100,
                prepaymentMinor: 0,
                capacityUnits: 1,
                idempotencyKey: `k${i}:${date}`,
                createdAt: now,
                updatedAt: now,
              })
              .catch(() => undefined);
          }

          const avail = await getDateAvailability(tenantId, date, date, { lines: [] }, now);
          const entry = avail[date]!;

          const leadDays = 2; // demo tenant default
          const maxDays = 60;
          if (offset < leadDays) {
            expect(entry.available).toBe(false);
            expect(entry.reason).toBe('TOO_SOON');
          } else if (offset > maxDays) {
            expect(entry.available).toBe(false);
            expect(entry.reason).toBe('TOO_FAR');
          } else if (closedFlag) {
            expect(entry.available).toBe(false);
            expect(entry.reason).toBe('CLOSED');
          } else if (usedCount >= 5) {
            expect(entry.available).toBe(false);
            expect(entry.reason).toBe('FULL');
          } else {
            expect(entry.available).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
