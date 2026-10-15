import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenant } from '../src/services/tenants.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { tenants, customers, products, orders } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qam2.db';
const appSecret = 's'.repeat(32);
const now = new Date();

let seq = 12000;
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

describe('tenant isolation', () => {
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

  it('tenants do not leak into each other', async () => {
    const { tenantId: a } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, a));
    const createdB = await createTenant({
      slug: 'shop-b',
      shopName: 'Shop B',
      botToken: '222:y',
      botId: 222,
      botUsername: 'shop_b_bot',
      appSecret,
      now,
    });
    if (!createdB.ok) throw new Error(createdB.error);
    const b = createdB.value.id;

    const portA = new FakePort();
    const portB = new FakePort();
    const { bot: botA } = createTenantBot('111:x', a, 'shop-a', portA);
    const { bot: botB } = createTenantBot('222:y', b, 'shop-b', portB);

    // Order in A.
    const plist = await getDb().select().from(products).where(eq(products.tenantId, a));
    const p = plist[0]!;
    const [c] = await getDb()
      .insert(customers)
      .values({ id: 'cm2', tenantId: a, telegramId: 42, firstSeenAt: now, lastSeenAt: now })
      .returning();
    const res = await createOrder({
      tenantId: a,
      customerId: c!.id,
      cart: {
        lines: [
          { lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) },
        ],
      },
      checkout: {
        checkoutId: 'chk-m2',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'T',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    if (!res.ok) throw new Error('seed: ' + res.error);

    // B my:list for A's customer: no view buttons to A's order.
    await botB.handleUpdate(cb('m1', 42, 10, 'my:list'));
    const bKb = JSON.stringify(
      portB.getCallsForMethod('editMessageTextOrSend').map((x) => x.args[3])
    );
    expect(bKb).not.toContain(`my:view:${res.value.id}`);

    // B adm:ord:view of A's order: refused.
    await botB.handleUpdate(cb('m2', 555, 10, `adm:ord:view:${res.value.id}`));
    const answers = portB.getCallsForMethod('answerCallback');
    expect(String(answers[answers.length - 1]!.args[1])).toContain('владелец');

    // Cart isolation: item in A's cart, B checkout starts empty.
    const aEdits = () =>
      portA.getCallsForMethod('editMessageTextOrSend').filter((x) => (x.args[0] as number) === 42);
    await botA.handleUpdate(cb('m3', 42, 10, 'cat:list'));
    const catA = JSON.stringify(aEdits()[aEdits().length - 1]!.args[3]).match(
      /cat:open:[A-Za-z0-9_-]+/
    )![0];
    await botA.handleUpdate(cb('m4', 42, 10, catA));
    const prdA = JSON.stringify(aEdits()[aEdits().length - 1]!.args[3]).match(
      /prd:open:[A-Za-z0-9_-]+/
    )![0];
    await botA.handleUpdate(cb('m5', 42, 10, prdA));
    const addA = JSON.stringify(aEdits()[aEdits().length - 1]!.args[3]).match(
      /prd:add:[A-Za-z0-9_-]+/
    );
    if (addA) await botA.handleUpdate(cb('m6', 42, 10, addA[0]));
    await botB.handleUpdate(cb('m7', 42, 10, 'chk:start'));
    const bEdits = portB
      .getCallsForMethod('editMessageTextOrSend')
      .filter((x) => (x.args[0] as number) === 42);
    expect(String(bEdits[bEdits.length - 1]!.args[2])).toContain('Корзина пуста');

    const dbOrders = await getDb().select().from(orders);
    expect(dbOrders).toHaveLength(1);
  });
});
