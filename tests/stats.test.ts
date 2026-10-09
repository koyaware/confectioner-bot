import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { customers, orders, funnelEvents, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { computeStats } from '../src/services/stats.js';

describe('stats', () => {
  const testDbPath = './test-stats.db';
  const appSecret = 's'.repeat(32);
  const now = new Date();

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

  async function seed() {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, botUsername: 'demo_bot' })
      .where(eq(tenants.id, tenantId));
    const db = getDb();
    await db.insert(customers).values([
      {
        id: 'c1',
        tenantId,
        telegramId: 1,
        source: 'reels',
        firstSeenAt: new Date(now.getTime() - 2 * 86400000),
        lastSeenAt: now,
      },
      {
        id: 'c2',
        tenantId,
        telegramId: 2,
        source: 'reels',
        firstSeenAt: new Date(now.getTime() - 86400000),
        lastSeenAt: now,
      },
      {
        id: 'c3',
        tenantId,
        telegramId: 3,
        source: null,
        firstSeenAt: new Date(now.getTime() - 40 * 86400000),
        lastSeenAt: now,
      },
    ]);
    await db.insert(orders).values([
      {
        id: 'o1',
        tenantId,
        number: 1,
        customerId: 'c1',
        status: 'confirmed',
        dueDate: '2026-10-05',
        fulfillment: 'pickup',
        contactName: 'A',
        contactPhone: '1',
        itemsTotalMinor: 10000,
        totalMinor: 10000,
        prepaymentMinor: 5000,
        capacityUnits: 1,
        idempotencyKey: 'k1',
        createdAt: new Date(now.getTime() - 3 * 86400000),
        decidedAt: new Date(now.getTime() - 3 * 86400000 + 60 * 60000),
        updatedAt: now,
      },
      {
        id: 'o2',
        tenantId,
        number: 2,
        customerId: 'c2',
        status: 'new',
        dueDate: '2026-10-06',
        fulfillment: 'pickup',
        contactName: 'B',
        contactPhone: '2',
        itemsTotalMinor: 5000,
        totalMinor: 5000,
        prepaymentMinor: 2500,
        capacityUnits: 1,
        idempotencyKey: 'k2',
        createdAt: new Date(now.getTime() - 86400000),
        updatedAt: now,
      },
    ]);
    await db.insert(funnelEvents).values([
      { tenantId, customerId: 'c1', type: 'catalog_view', at: new Date(now.getTime() - 86400000) },
      { tenantId, customerId: 'c2', type: 'faq_view', at: new Date(now.getTime() - 86400000) },
      { tenantId, customerId: 'c2', type: 'free_text', at: new Date(now.getTime() - 3600000) },
      { tenantId, customerId: 'c1', type: 'catalog_view', at: new Date(now.getTime() - 7200000) },
    ]);
    return tenantId;
  }

  it('computes stats for a window', async () => {
    const tenantId = await seed();
    const s7 = await computeStats(tenantId, 7, now);
    expect(s7.newCustomersTotal).toBe(2);
    expect(s7.newCustomersBySource[0]).toEqual({ source: 'reels', count: 2 });
    expect(s7.ordersByStatus).toHaveLength(2);
    expect(s7.revenueMinor).toBe(10000);
    expect(s7.confirmedOrders).toBe(1);
    expect(s7.avgDecisionMinutes).toBe(60);
    expect(s7.botOnlyInteractions).toBe(2);

    const s30 = await computeStats(tenantId, 30, now);
    expect(s30.newCustomersTotal).toBe(2);
  });

  it('renders canonical order, hides free_text, localizes unknown source', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const D = 86400000;
    await db.insert(customers).values({
      id: 'cx',
      tenantId,
      telegramId: 9,
      source: null,
      firstSeenAt: new Date(now.getTime() - D),
      lastSeenAt: now,
    });
    await db.insert(funnelEvents).values([
      { tenantId, customerId: 'cx', type: 'order_submit', at: new Date(now.getTime() - D) },
      { tenantId, customerId: 'cx', type: 'free_text', at: new Date(now.getTime() - D) },
      { tenantId, customerId: 'cx', type: 'start', at: new Date(now.getTime() - D) },
    ]);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, 'adm:stats'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const text = edits[edits.length - 1]!.args[2] as string;
    expect(text).toContain('без метки');
    expect(text).not.toContain('неизвестно');
    expect(text).not.toContain('Свободный вопрос');
    const funnelStart = text.indexOf('Воронка:');
    const startPos = text.indexOf('Старт', funnelStart);
    const orderPos = text.indexOf('Заказ', funnelStart);
    expect(startPos).toBeGreaterThan(-1);
    expect(orderPos).toBeGreaterThan(-1);
    expect(startPos).toBeLessThan(orderPos);
  });

  it('pluralizes bot-only line in Russian', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const D = 86400000;
    await db.insert(customers).values({
      id: 'c1',
      tenantId,
      telegramId: 1,
      source: null,
      firstSeenAt: new Date(now.getTime() - D),
      lastSeenAt: now,
    });
    await db.insert(funnelEvents).values({
      tenantId,
      customerId: 'c1',
      type: 'catalog_view',
      at: new Date(now.getTime() - D),
    });
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, 'adm:stats'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const text = edits[edits.length - 1]!.args[2] as string;
    expect(text).toContain('1 обращение');
    expect(text).not.toContain('1 клиентов');
  });

  it('renders stats to owner and supports 30d button screen', async () => {
    const tenantId = await seed();
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, 'adm:stats'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0]!.args[2]).toContain('Статистика за 7 дней');
    expect(edits[0]!.args[2]).toContain('Каталог');
    expect(edits[0]!.args[2]).toContain('FAQ');
    expect(edits[0]!.args[2]).not.toContain('catalog_view');

    await bot.handleUpdate(cb(2, 'c2', 555, 10, 'adm:stats:30'));
    const edits2 = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits2[edits2.length - 1]!.args[2]).toContain('Статистика за 30 дней');
  });
});
