import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createOrder, applyOrderEvent } from '../src/services/orders.js';
import { customers, jobs, orders } from '../src/db/schema.js';
import { createPickupReminderHandler } from '../src/jobs/handlers/pickup-reminder.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('pickup reminder', () => {
  const testDbPath = './test-pickup.db';
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

  it('job is scheduled when order becomes confirmed; handler notifies client day before', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const products = await db.select().from((await import('../src/db/schema.js')).products);
    await db.insert(customers).values({
      id: 'cust1',
      tenantId,
      telegramId: 42,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    const result = await createOrder({
      tenantId,
      customerId: 'cust1',
      cart: { lines: [{ lineId: 'l1', productId: products[0]!.id, qty: 1, optionIds: [] }] },
      checkout: {
        checkoutId: 'chk-pickup',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    if (!result.ok) throw new Error(result.error);

    await applyOrderEvent(result.value.id, 'owner_accept', 'owner', now);
    await applyOrderEvent(result.value.id, 'receipt_uploaded', 'customer', now);
    await applyOrderEvent(result.value.id, 'payment_confirmed', 'owner', now);

    const allJobs = await db.select().from(jobs);
    const pickupJob = allJobs.find((j) => j.type === 'customer.pickup_reminder');
    expect(pickupJob).toBeTruthy();
    expect(pickupJob!.dedupeKey).toBe(`pickup:${result.value.id}`);

    const port = new FakePort();
    const handler = createPickupReminderHandler({ getPort: () => port });
    await handler({ orderId: result.value.id }, 'job1');
    await handler({ orderId: result.value.id }, 'job1'); // both calls when confirmed → two messages? each call sends one; idempotency test: after status change it stops

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]!.args[1] as string).toContain('Напоминание');

    // after marking completed, handler becomes silent
    await applyOrderEvent(result.value.id, 'mark_ready', 'owner', now);
    await applyOrderEvent(result.value.id, 'mark_completed', 'owner', now);
    const before = port.getCallsForMethod('sendMessage').length;
    await handler({ orderId: result.value.id }, 'job1');
    expect(port.getCallsForMethod('sendMessage').length).toBe(before);
  });
});
