import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { tenants, customers, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qafix4.db';
const appSecret = 's'.repeat(32);
const now = new Date();

let seq = 17000;
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
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'U' },
      text,
      entities: [],
    },
  } as never;
}
function doc(fromId: number) {
  const id = seq++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'U' },
      document: { file_id: 'doc1', file_unique_id: 'd1', file_name: 'photo.pdf' },
    },
  } as never;
}
function photoMsg(fromId: number) {
  const id = seq++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'U' },
      photo: [{ file_id: 'pic1', width: 100, height: 100 }],
    },
  } as never;
}

describe('QA fixes 4: order pagination, photo document', () => {
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

  async function setup() {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const { setCapacityForDate } = await import('../src/services/calendar.js');
    await setCapacityForDate(tenantId, addDays(toIsoDate(now, 'Europe/Moscow'), 5), 1000, false);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    return { bot, port, tenantId };
  }

  function lastEdit(port: FakePort, u: number) {
    const cs = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === u);
    return cs[cs.length - 1]!;
  }

  it('bug 66: long order lists paginate instead of hiding', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    for (let i = 0; i < 25; i++) {
      const [c] = await getDb()
        .insert(customers)
        .values({
          id: `cq4-${i}`,
          tenantId,
          telegramId: 2000 + i,
          firstSeenAt: now,
          lastSeenAt: now,
        })
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
          checkoutId: `chk-q4-${i}`,
          dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
          fulfillment: 'pickup',
          contactName: 'T',
          contactPhone: '+7999',
          referenceFileIds: [],
        },
        now,
      });
      if (!r.ok) throw new Error('seed ' + i);
    }
    await bot.handleUpdate(cb('g1', 555, 10, 'adm:ord:list'));
    let kb = JSON.stringify(lastEdit(port, 555).args[3]);
    expect((kb.match(/adm:ord:view/g) || []).length).toBe(8);
    expect(kb).toContain('adm:ord:more:new:1');
    expect(kb).toContain('(17)');
    await bot.handleUpdate(cb('g2', 555, 10, 'adm:ord:more:new:1'));
    kb = JSON.stringify(lastEdit(port, 555).args[3]);
    expect((kb.match(/adm:ord:view/g) || []).length).toBe(16);
    expect(kb).toContain('adm:ord:more:new:2');
    await bot.handleUpdate(cb('g3', 555, 10, 'adm:ord:more:new:2'));
    kb = JSON.stringify(lastEdit(port, 555).args[3]);
    expect((kb.match(/adm:ord:view/g) || []).length).toBe(24);
    await bot.handleUpdate(cb('g4', 555, 10, 'adm:ord:more:new:3'));
    kb = JSON.stringify(lastEdit(port, 555).args[3]);
    expect((kb.match(/adm:ord:view/g) || []).length).toBe(25);
    expect(kb).not.toContain('adm:ord:more:');
    // garbage page ignored
    await bot.handleUpdate(cb('g5', 555, 10, 'adm:ord:more:new:99'));
    await bot.handleUpdate(cb('g6', 555, 10, 'adm:ord:more:nope:1'));
  });

  it('bug 67: document is refused as product photo, draft kept', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    await bot.handleUpdate(cb('h1', 555, 10, `adm:prd:field:${p.id}:photo`));
    await bot.handleUpdate(doc(555));
    let rows = await getDb().select().from(products).where(eq(products.id, p.id));
    expect(rows[0]!.photoFileId).toBeNull();
    // draft kept: a real photo right after still works
    await bot.handleUpdate(photoMsg(555));
    rows = await getDb().select().from(products).where(eq(products.id, p.id));
    expect(rows[0]!.photoFileId).toBe('pic1');
    void tenantId;
    void txt;
  });
});
