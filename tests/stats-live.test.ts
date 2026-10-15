import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder, applyOrderEvent } from '../src/services/orders.js';
import { tenants, customers, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qap.db';
const appSecret = 's'.repeat(32);
const now = new Date();

let seq = 15000;
function cb(cbId: string, fromId: number, msgId: number, data: string) {
  return {
    update_id: seq++,
    callback_query: {
      id: cbId,
      from: { id: fromId, is_bot: false, first_name: 'U' },
      message: { message_id: msgId, date: 1, chat: { id: fromId, type: 'private' } },
      data,
    },
  } as never;
}

describe('stats and preview with live data', () => {
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

  it('P1: stats reflect real orders, preview renders', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const { setCapacityForDate } = await import('../src/services/calendar.js');
    await setCapacityForDate(tenantId, addDays(toIsoDate(now, 'Europe/Moscow'), 5), 100, false);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    const mk = async (tg: number, id: string, ck: string) => {
      const [c] = await getDb()
        .insert(customers)
        .values({ id, tenantId, telegramId: tg, firstSeenAt: now, lastSeenAt: now })
        .returning();
      const r = await createOrder({
        tenantId,
        customerId: c!.id,
        cart: {
          lines: [{ lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) }],
        },
        checkout: {
          checkoutId: ck,
          dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
          fulfillment: 'pickup',
          contactName: 'T',
          contactPhone: '+7999',
          referenceFileIds: [],
        },
        now,
      });
      if (!r.ok) throw new Error('seed ' + ck);
      return r.value.id;
    };
    const o1 = await mk(42, 'cp1', 'chk-p1');
    const o2 = await mk(43, 'cp2', 'chk-p2');
    const acc = await applyOrderEvent(o1, 'owner_accept', 'owner', now);
    if (!acc.ok) throw new Error('accept failed');
    await bot.handleUpdate(cb('p1', 555, 10, 'adm:stats'));
    await bot.handleUpdate(cb('p2', 555, 10, 'adm:stats:7'));
    await bot.handleUpdate(cb('p3', 555, 10, 'adm:stats:30'));
    await bot.handleUpdate(cb('p4', 555, 10, 'adm:preview'));
    const edits = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === 555)
      .map((c) => String(c.args[2]).slice(0, 200));
    expect(edits[0]).toContain('Новый: 1');
    expect(edits[0]).toContain('Ожидает оплаты: 1');
    expect(edits[2]).toContain('Статистика за 30 дней');
    expect(edits[3]).toContain('Клиент видит это:');
    const pings = port
      .getCallsForMethod('sendMessage')
      .filter((c) => String(c.args[1]).includes('Ошибка бота'));
    expect(pings).toHaveLength(0);
    void o2;
  });

  it('P2: stats for empty shop', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    await bot.handleUpdate(cb('p1', 555, 10, 'adm:stats:30'));
    const edits = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === 555);
    expect(String(edits[edits.length - 1]!.args[2])).toContain('Новые клиенты: 0');
  });
});
