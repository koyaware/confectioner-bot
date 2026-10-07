import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { tenants, customers, orders, orderAttachments } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('my orders', () => {
  const testDbPath = './test-myorders.db';
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

  async function setup() {
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
        checkoutId: 'chk-my1',
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

  it('customer sees own order list and cannot see orders of others', async () => {
    const { tenantId, order } = await setup();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'my:list'));
    const edits = port.getCallsForMethod('editMessageText');
    expect(JSON.stringify(edits[0]!.args[3])).toContain('my:view:');

    // user 43 does not own anything
    await bot.handleUpdate(cb(2, 'c2', 43, 10, 'my:list'));
    const edits2 = port.getCallsForMethod('editMessageText');
    expect(edits2[1]!.args[2]).toBe('У вас пока нет заказов.');

    // user 43 cannot view order directly
    await bot.handleUpdate(cb(3, 'c3', 43, 10, `my:view:${order.id}`));
    const edits3 = port.getCallsForMethod('editMessageText');
    expect(edits3[2]!.args[2]).toBe('Заказ не найден.');
  });

  it('customer can cancel own new order; owner is notified', async () => {
    const { tenantId, order } = await setup();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `my:cancel:${order.id}`));

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('cancelled');

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.some((c) => c.args[0] === 555)).toBe(true);
  });

  it('cancelled orders are hidden from customer list', async () => {
    const { tenantId, order } = await setup();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `my:cancel:${order.id}`));
    await bot.handleUpdate(cb(2, 'c2', 42, 10, 'my:list'));

    const edits = port.getCallsForMethod('editMessageText');
    expect(edits[1]!.args[2]).toBe('У вас пока нет заказов.');
  });

  it('customer can view stored reference photos', async () => {
    const { tenantId, order } = await setup();
    await getDb().insert(orderAttachments).values({
      id: 'a1',
      orderId: order.id,
      kind: 'reference',
      fileId: 'file-1',
      fileType: 'photo',
      createdAt: now,
    });
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `my:view:${order.id}`));
    const edits = port.getCallsForMethod('editMessageText');
    expect(edits[0]!.args[2]).toContain('Референсы: 1 шт.');
    expect(JSON.stringify(edits[0]!.args[3])).toContain(`my:refs:${order.id}`);

    await bot.handleUpdate(cb(2, 'c2', 42, 10, `my:refs:${order.id}`));
    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    expect(photos[0]!.args[0]).toBe(42);
    expect(photos[0]!.args[1]).toBe('file-1');
  });
});
