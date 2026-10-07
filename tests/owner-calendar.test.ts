import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { capacityOverrides, tenants, customers, orders } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('owner calendar', () => {
  const testDbPath = './test-cal.db';
  const appSecret = 's'.repeat(32);

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

  it('owner closes a day and customer availability reflects it', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const target = addDays(toIsoDate(now, 'Europe/Moscow'), 4);

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:cal:toggle:${target}`));

    const rows = await getDb().select().from(capacityOverrides);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isClosed).toBe(true);
    expect(rows[0]!.capacity).toBe(5); // default preserved

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2] as string).toContain('Закрыт');
  });

  it('owner sets capacity for a day', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const target = addDays(toIsoDate(now, 'Europe/Moscow'), 4);

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:cal:setcap:${target}`));
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: '3',
        entities: [],
      },
    } as never);

    const rows = await getDb().select().from(capacityOverrides);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capacity).toBe(3);
  });

  it('day screen lists due orders with view buttons', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    await db.update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const target = addDays(toIsoDate(now, 'Europe/Moscow'), 4);
    await db.insert(customers).values({
      id: 'c1',
      tenantId,
      telegramId: 42,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    await db.insert(orders).values({
      id: 'o1',
      tenantId,
      number: 1,
      customerId: 'c1',
      status: 'new',
      dueDate: target,
      fulfillment: 'pickup',
      contactName: 'A',
      contactPhone: '1',
      itemsTotalMinor: 1000,
      totalMinor: 1000,
      prepaymentMinor: 500,
      capacityUnits: 1,
      idempotencyKey: 'k1',
      createdAt: now,
      updatedAt: now,
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:cal:day:${target}`));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const last = edits[edits.length - 1]!;
    expect(last.args[2] as string).toContain('Заказы:');
    expect(JSON.stringify(last.args[3])).toContain('adm:ord:view:o1');
  });
});
