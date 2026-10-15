import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { createDailyDigestHandler } from '../src/jobs/handlers/daily-digest.js';
import { createBackupHandler } from '../src/jobs/handlers/backup.js';
import { tenants, customers, products, orders } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qal.db';
const appSecret = 's'.repeat(32);

let seq = 9500;
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

describe('digest and backup with live data', () => {
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

  async function mkOrder(
    tenantId: string,
    customerId: string,
    dueDate: string,
    ck: string,
    now: Date
  ) {
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    return createOrder({
      tenantId,
      customerId,
      cart: {
        lines: [
          { lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) },
        ],
      },
      checkout: {
        checkoutId: ck,
        dueDate,
        fulfillment: 'pickup',
        contactName: 'T',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
  }

  it('L1: digest counts, lists and isolates tenants', async () => {
    const now = new Date();
    const today = toIsoDate(now, 'Europe/Moscow');
    const tomorrow = addDays(today, 1);
    const d5 = addDays(today, 5);
    const { tenantId: a } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, a));
    const { createTenant: createTenantSvc } = await import('../src/services/tenants.js');
    const createdB = await createTenantSvc({
      slug: 'digest-b',
      shopName: 'Digest B',
      botToken: '999:z',
      botId: 999,
      botUsername: 'digest_b_bot',
      appSecret,
      now,
    });
    if (!createdB.ok) throw new Error(createdB.error);
    const b = createdB.value.id;
    const { setCapacityForDate } = await import('../src/services/calendar.js');
    await setCapacityForDate(a, d5, 100, false);
    const mkCust = async (tid: string, id: string, tg: number) =>
      (
        await getDb()
          .insert(customers)
          .values({ id, tenantId: tid, telegramId: tg, firstSeenAt: now, lastSeenAt: now })
          .returning()
      )[0]!;
    const ca = await mkCust(a, 'ca', 42);
    const cb_ = await mkCust(b, 'cb', 43);
    const { orders: ordersTbl } = await import('../src/db/schema.js');
    await getDb().insert(ordersTbl).values({
      id: 'b-order-1',
      tenantId: b,
      number: 1,
      customerId: cb_.id,
      status: 'new',
      dueDate: d5,
      fulfillment: 'pickup',
      contactName: 'B',
      contactPhone: '+7999',
      itemsTotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
      prepaymentMinor: 50,
      currency: '₽',
      capacityUnits: 1,
      idempotencyKey: 'dl-b1',
      createdAt: now,
      updatedAt: now,
    });
    const d6 = addDays(today, 6);
    const r = await mkOrder(a, ca.id, d5, 'dl1', now);
    if (!r.ok) throw new Error('seed dl1: ' + r.error);
    await mkOrder(a, ca.id, d5, 'dl2', now);
    await mkOrder(a, ca.id, d6, 'dl3', now);
    await mkOrder(a, ca.id, addDays(today, 10), 'dl4', now);

    const cancelled = await mkOrder(a, ca.id, d5, 'dl6', now);
    if (!cancelled.ok) throw new Error('seed dl6: ' + cancelled.error);
    const { applyOrderEvent } = await import('../src/services/orders.js');
    const cev = await applyOrderEvent(cancelled.value.id, 'customer_cancel', 'customer', now);
    if (!cev.ok) throw new Error('cancel failed: ' + cev.error);

    const portA = new FakePort();
    const { bot: _b1 } = createTenantBot('111:x', a, 'shop-a', portA);
    void _b1;
    const handler = createDailyDigestHandler({ getPort: (tid) => (tid === a ? portA : undefined) });
    const res = await handler({ tenantId: a, date: d5 }, 'job1');
    expect(res.success).toBe(true);
    const sends = portA.getCallsForMethod('sendMessage');
    const text = String(sends[sends.length - 1]!.args[1]);
    expect(text).toContain('Заказов на сегодня: 2');
    expect(text).toContain('Заказов на завтра: 1');
    expect(text).toContain('Без решения: 4');
    const kb = JSON.stringify(sends[sends.length - 1]!.args[2]);
    expect(kb.match(/adm:ord:view/g) || []).toHaveLength(3);
  });

  it('L2: digest skips paused/ownerless tenants silently', async () => {
    const now = new Date();
    const today = toIsoDate(now, 'Europe/Moscow');
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const handler = createDailyDigestHandler({ getPort: () => port });
    // no owner
    const r1 = await handler({ tenantId, date: today }, 'j1');
    expect(r1.success).toBe(true);
    // paused with owner
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, status: 'paused' })
      .where(eq(tenants.id, tenantId));
    const r2 = await handler({ tenantId, date: today }, 'j2');
    expect(r2.success).toBe(true);
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(0);
  });

  it('L3: digest to blocked owner succeeds without retry', async () => {
    const now = new Date();
    const today = toIsoDate(now, 'Europe/Moscow');
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    port.addBlockedOnFirstCall('sendMessage');
    const handler = createDailyDigestHandler({ getPort: () => port });
    const res = await handler({ tenantId, date: today }, 'j3');
    expect(res).toEqual({ success: true });
  });

  it('L4: backup creates file and sends document', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const handler = createBackupHandler({ getPort: () => port, superadminTelegramId: 1 });
    const res = await handler({}, 'jb1');
    expect(res).toEqual({ success: true });
    const docs = port.getCallsForMethod('sendDocument');
    expect(docs).toHaveLength(1);
    expect(String(docs[0]!.args[2])).toContain('Бэкап БД');
    void tenantId;
  });
});
