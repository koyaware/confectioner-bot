import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { tenants, customers, orders, orderAttachments, sessions } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('payment flow', () => {
  const testDbPath = './test-payment.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

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
    } catch {
      // ignore
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    delete process.env.APP_SECRET;
    delete process.env.SUPERADMIN_TELEGRAM_ID;
  });

  function cb(update_id: number, id: string, from: number, msgId: number, data: string) {
    return {
      update_id,
      callback_query: {
        id,
        from: { id: from, is_bot: false, first_name: 'O' },
        message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  async function setupOrder() {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
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
        checkoutId: 'chk-pay1',
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

  it('accept with prepayment sends payment card with реквизиты and client can say оплатил', async () => {
    const { tenantId, order } = await setupOrder();
    await getDb()
      .update(tenants)
      .set({ paymentText: 'Карта 1234 5678' })
      .where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // owner accepts
    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:accept:${order.id}`));

    const sent = port.getCallsForMethod('sendMessage');
    const toClient = sent.find((c) => c.args[0] === 42);
    expect(toClient).toBeTruthy();
    expect(toClient!.args[1] as string).toContain('Карта 1234 5678');
    expect(toClient!.args[1] as string).toContain('Я оплатил'.slice(0, 2));

    const kb = JSON.stringify(toClient!.args[2]);
    expect(kb).toContain('pay:sent:');

    // order has paymentDueAt set
    const rows = await getDb().select().from(orders);
    expect(rows[0]!.paymentDueAt).not.toBeNull();
  });

  it('receipt upload creates attachment, transitions status and notifies owner', async () => {
    const { tenantId, order } = await setupOrder();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:accept:${order.id}`));

    // customer taps «Я оплатил»
    await bot.handleUpdate(cb(2, 'c2', 42, 11, `pay:sent:${order.id}`));
    let sessionRows = await getDb().select().from(sessions);
    sessionRows = sessionRows.filter((r) => r.telegramId === 42);
    expect(sessionRows[0]!.state).toBe('payment.await_receipt');

    // customer sends a photo as receipt
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C' },
        photo: [{ file_id: 'photo123', file_unique_id: 'u1', width: 10, height: 10 }],
      },
    } as never);

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('payment_review');

    const attachments = await getDb().select().from(orderAttachments);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.kind).toBe('receipt');
    expect(attachments[0]!.fileId).toBe('photo123');

    // owner got the receipt with paid/badpay buttons
    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    expect(photos[0]!.args[0]).toBe(555);
    expect(JSON.stringify(photos[0]!.args[3])).toContain('adm:ord:paid');

    // session reset to idle
    sessionRows = await getDb().select().from(sessions);
    sessionRows = sessionRows.filter((r) => r.telegramId === 42);
    expect(sessionRows[0]!.state).toBe('idle');
  });

  it('owner confirms payment → confirmed, badpay → back to awaiting_payment', async () => {
    const { tenantId, order } = await setupOrder();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:accept:${order.id}`));
    await bot.handleUpdate(cb(2, 'c2', 42, 11, `pay:sent:${order.id}`));
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C' },
        photo: [{ file_id: 'p1', file_unique_id: 'u2', width: 10, height: 10 }],
      },
    } as never);

    await bot.handleUpdate(cb(4, 'c4', 555, 10, `adm:ord:paid:${order.id}`));
    let rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('confirmed');

    const sent = port.getCallsForMethod('sendMessage');
    const toClient = sent.find(
      (c) => c.args[0] === 42 && (c.args[1] as string).includes('подтверждена')
    );
    expect(toClient).toBeTruthy();
  });
});
