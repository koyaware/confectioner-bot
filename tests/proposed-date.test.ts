import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { tenants, customers, orders } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

describe('proposed date', () => {
  const testDbPath = './test-propdate.db';
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
      cart: {
        lines: [
          {
            lineId: 'l1',
            productId: products[0]!.id,
            qty: 1,
            optionIds: await firstActiveOptionIds(products[0]!.id),
          },
        ],
      },
      checkout: {
        checkoutId: 'chk-pd',
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

  it('pd:yes moves dueDate and auto-accepts order', async () => {
    const { tenantId, order } = await setup();
    const newDate = addDays(toIsoDate(now, 'Europe/Moscow'), 8);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // owner proposes date
    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:pd:${order.id}:${newDate}`));
    let rows = await getDb().select().from(orders);
    expect(rows[0]!.proposedDate).toBe(newDate);

    // client accepts
    await bot.handleUpdate(cb(2, 'c2', 42, 11, `pd:yes:${order.id}`));
    rows = await getDb().select().from(orders);
    expect(rows[0]!.proposedDate).toBeNull();
    expect(rows[0]!.dueDate).toBe(newDate);
    expect(rows[0]!.status).toBe('awaiting_payment');
  });

  it('pd:no clears proposedDate and notifies owner', async () => {
    const { tenantId, order } = await setup();
    const newDate = addDays(toIsoDate(now, 'Europe/Moscow'), 8);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:pd:${order.id}:${newDate}`));
    await bot.handleUpdate(cb(2, 'c2', 42, 11, `pd:no:${order.id}`));

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.proposedDate).toBeNull();
    expect(rows[0]!.status).toBe('new');

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.some((c) => c.args[0] === 555 && (c.args[1] as string).includes('отклонил'))).toBe(
      true
    );
  });

  it('pd to an unavailable date is rejected', async () => {
    const { tenantId, order } = await setup();
    const tooSoon = addDays(toIsoDate(now, 'Europe/Moscow'), 1);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:pd:${order.id}:${tooSoon}`));

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.proposedDate).toBeNull();
    const answers = port.getCallsForMethod('answerCallback');
    expect(answers[answers.length - 1]!.args[1]).toBe('Дата уже недоступна.');
    expect(tenantId).toBeTruthy();
  });

  it('double pd:yes accepts once, second is rejected', async () => {
    const { tenantId, order } = await setup();
    const newDate = addDays(toIsoDate(now, 'Europe/Moscow'), 8);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:pd:${order.id}:${newDate}`));
    await bot.handleUpdate(cb(2, 'c2', 42, 11, `pd:yes:${order.id}`));
    await bot.handleUpdate(cb(3, 'c3', 42, 11, `pd:yes:${order.id}`));

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.dueDate).toBe(newDate);
    expect(rows[0]!.status).toBe('awaiting_payment');
    const edits = port.getCallsForMethod('editMessageText');
    expect(edits[edits.length - 1]!.args[2]).toBe('Заказ не найден.');
    expect(tenantId).toBeTruthy();
  });
});
