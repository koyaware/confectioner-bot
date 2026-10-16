import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { createPickupReminderHandler } from '../src/jobs/handlers/pickup-reminder.js';
import { tenants, customers, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qat.db';
const appSecret = 's'.repeat(32);
const now = new Date();

let seq = 20000;
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
function txt(fromId: number, text: string) {
  const id = seq++;
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
    : [];
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'U' },
      text,
      entities,
    },
  } as never;
}

describe('kk smoke and pickup reminders', () => {
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

  it('T1: full kk walkthrough', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, language: 'kk' })
      .where(eq(tenants.id, tenantId));
    const { setCapacityForDate } = await import('../src/services/calendar.js');
    await setCapacityForDate(tenantId, addDays(toIsoDate(now, 'Europe/Moscow'), 5), 1000, false);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    const u = 42;
    const lastEdit = () => {
      const cs = port
        .getCallsForMethod('editMessageTextOrSend')
        .filter((c) => (c.args[0] as number) === u);
      return cs[cs.length - 1]!;
    };
    await bot.handleUpdate(txt(u, '/start'));
    await bot.handleUpdate(cb('t1', u, 10, 'cat:list'));
    const cat = JSON.stringify(lastEdit().args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb('t2', u, 10, cat));
    const prd = JSON.stringify(lastEdit().args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb('t3', u, 10, prd));
    const add = JSON.stringify(lastEdit().args[3]).match(/prd:add:[A-Za-z0-9_-]+/);
    if (add) await bot.handleUpdate(cb('t4', u, 10, add[0]));
    await bot.handleUpdate(cb('t5', u, 10, 'my:list'));
    await bot.handleUpdate(cb('t6', u, 10, 'faq:list'));
    await bot.handleUpdate(cb('t7', u, 10, 'cnt:show'));
    const pings = port
      .getCallsForMethod('sendMessage')
      .filter((c) => String(c.args[1]).includes('Ошибка бота'));
    const texts = [
      ...port.getCallsForMethod('sendMessage').map((c) => String(c.args[1])),
      ...port.getCallsForMethod('editMessageTextOrSend').map((c) => String(c.args[2])),
    ];
    const latin = texts.filter((t) => /[A-Za-z]/.test(t) && !/t\.me|QR|FAQ|ID|№/.test(t));
    expect(pings).toHaveLength(0);
  });

  it('T2: pickup reminder pickup vs delivery', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    let tgSeq = 100;
    const mk = async (id: string, ck: string, ful: 'pickup' | 'delivery') => {
      tgSeq++;
      const [c] = await getDb()
        .insert(customers)
        .values({ id, tenantId, telegramId: tgSeq, firstSeenAt: now, lastSeenAt: now })
        .returning();
      const r = await createOrder({
        tenantId,
        customerId: c!.id,
        cart: {
          lines: [
            { lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) },
          ],
        },
        checkout: {
          checkoutId: ck,
          dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
          fulfillment: ful,
          address: ful === 'delivery' ? 'ул. Ленина 1' : undefined,
          contactName: 'T',
          contactPhone: '+7999',
          referenceFileIds: [],
        },
        now,
      });
      if (!r.ok) throw new Error('seed');
      return r.value.id;
    };
    const { applyOrderEvent } = await import('../src/services/orders.js');
    await getDb().update(tenants).set({ prepaymentPercent: 0 }).where(eq(tenants.id, tenantId));
    const oPickup = await mk('ct1', 'chk-t1', 'pickup');
    const oDelivery = await mk('ct2', 'chk-t2', 'delivery');
    await applyOrderEvent(oPickup, 'owner_accept', 'owner', now);
    await applyOrderEvent(oDelivery, 'owner_accept', 'owner', now);
    const port = new FakePort();
    const handler = createPickupReminderHandler({ getPort: () => port });
    expect(await handler({ orderId: oPickup }, 'j1')).toEqual({ success: true });
    expect(await handler({ orderId: oDelivery }, 'j2')).toEqual({ success: true });
    const sends = port.getCallsForMethod('sendMessage').map((c) => String(c.args[1]));
    expect(sends[0]).toContain('самовывоз');
    expect(sends[1]).toContain('ул. Ленина 1');
  });
});
