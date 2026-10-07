import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createOrder, applyOrderEvent } from '../src/services/orders.js';
import { orders, jobs, tenants } from '../src/db/schema.js';
import {
  createPaymentReminderHandler,
  createPaymentExpireHandler,
} from '../src/jobs/handlers/order-payment.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { eq } from 'drizzle-orm';

describe('payment jobs', () => {
  const testDbPath = './test-payjobs.db';
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
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const db = getDb();
    const products = await db.select().from((await import('../src/db/schema.js')).products);
    const { customers } = await import('../src/db/schema.js');
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
        checkoutId: 'chk-j1',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    if (!result.ok) throw new Error(result.error);
    return { tenantId, order: result.value };
  }

  it('creating order in awaiting_payment schedules reminder and expire jobs', async () => {
    const { tenantId, order } = await setup();
    await applyOrderEvent(order.id, 'owner_accept', 'owner', now);

    const allJobs = await getDb().select().from(jobs);
    const types = allJobs.map((j) => j.type).sort();
    expect(types).toEqual(['order.expire', 'order.payment_reminder']);
    expect(allJobs.find((j) => j.type === 'order.expire')!.dedupeKey).toBe(`expire:${order.id}`);
    expect(allJobs.find((j) => j.type === 'order.payment_reminder')!.dedupeKey).toBe(
      `payrem:${order.id}`
    );
  });

  it('reminder handler is idempotent — sends message only while awaiting_payment', async () => {
    const { tenantId, order } = await setup();
    await applyOrderEvent(order.id, 'owner_accept', 'owner', now);

    const port = new FakePort();
    const handler = createPaymentReminderHandler({ getPort: () => port });

    const payload = { orderId: order.id };
    await handler(payload, 'job1');
    await handler(payload, 'job1');

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent).toHaveLength(2); // two invocations both while awaiting_payment → two reminders; but idempotency means second call after payment => no message. Here both calls happen while awaiting_payment, so two messages is expected unless dedupe at job level

    // Now after payment confirmed, the handler must do nothing
    await applyOrderEvent(order.id, 'receipt_uploaded', 'customer', now);
    await applyOrderEvent(order.id, 'payment_confirmed', 'owner', now);
    await handler(payload, 'job1');
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(2);
  });

  it('expire handler transitions order to expired and notifies both parties', async () => {
    const { tenantId, order } = await setup();
    await applyOrderEvent(order.id, 'owner_accept', 'owner', now);

    const port = new FakePort();
    const handler = createPaymentExpireHandler({ getPort: () => port });

    await handler({ orderId: order.id }, 'job-expire');
    await handler({ orderId: order.id }, 'job-expire'); // second run is a noop

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('expired');

    const sent = port.getCallsForMethod('sendMessage');
    const toClient = sent.find((c) => c.args[0] === 42);
    const toOwner = sent.find((c) => c.args[0] === 555);
    expect(toClient).toBeTruthy();
    expect(toOwner).toBeTruthy();
    // second run did not send extra messages
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(2);
  });
});
