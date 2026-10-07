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

describe('owner order handling', () => {
  const testDbPath = './test-ownerords.db';
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

  async function makeOrder(tenantId: string) {
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
        checkoutId: 'chk-o1',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it('owner accept moves to awaiting_payment, client notified, double accept no-op', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const order = await makeOrder(tenantId);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:accept:${order.id}`));

    let rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('awaiting_payment');

    const sent = port.getCallsForMethod('sendMessage');
    const toClient = sent.find((c) => c.args[0] === 42);
    expect(toClient!.args[1] as string).toContain('принят');

    // double accept: no transition, no customer notification (only answerCallback + no extra)
    const sentBefore = port.getCallsForMethod('sendMessage').length;
    await bot.handleUpdate(cb(2, 'c2', 555, 10, `adm:ord:accept:${order.id}`));
    rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('awaiting_payment');
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(sentBefore);
  });

  it('reject with reason stores rejectReason and notifies client', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const order = await makeOrder(tenantId);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:ord:reject:${order.id}`));
    const edits = port.getCallsForMethod('editMessageText');
    const kb = JSON.stringify(edits[edits.length - 1]!.args[3]);
    expect(kb).toContain('adm:ord:rr:');

    await bot.handleUpdate(cb(2, 'c2', 555, 10, `adm:ord:rr:${order.id}:full`));

    const rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('rejected');
    expect(rows[0]!.rejectReason).toBe('Нет мест на эту дату');

    const sent = port.getCallsForMethod('sendMessage');
    const toClient = sent.find((c) => c.args[0] === 42);
    expect(toClient!.args[1] as string).toContain('отклонён');

    const cardEdits = port.getCallsForMethod('editMessageText');
    const cardText = cardEdits[cardEdits.length - 1]!.args[2] as string;
    expect(cardText).toContain('Причина отказа: Нет мест на эту дату');
    expect(cardText).toContain('Загрузка даты:');
  });

  it('non-owner adm callback is rejected without effect', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const order = await makeOrder(tenantId);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `adm:ord:accept:${order.id}`));
    const rows = await getDb().select().from(orders);
    expect(rows[0]!.status).toBe('new');
  });
});
