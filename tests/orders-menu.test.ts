import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { customers, orders, sessions, tenants, orderAttachments } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function seedTenantAndCustomer() {
  const { tenantId } = await seedDemo(appSecret, now);
  const db = getDb();
  await db.update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
  await db.insert(customers).values({
    id: 'c1',
    tenantId,
    telegramId: 42,
    username: 'ivan',
    firstName: 'Иван',
    phone: '+7999',
    firstSeenAt: now,
    lastSeenAt: now,
  });
  await db.insert(orders).values({
    id: 'o1',
    tenantId,
    number: 1,
    customerId: 'c1',
    status: 'new',
    dueDate: '2026-10-10',
    fulfillment: 'pickup',
    contactName: 'Иван',
    contactPhone: '+7999',
    itemsTotalMinor: 1000,
    totalMinor: 1000,
    prepaymentMinor: 500,
    capacityUnits: 1,
    idempotencyKey: 'k1',
    createdAt: now,
    updatedAt: now,
  });
  return tenantId;
}

function cb(update_id: number, from: number, data: string) {
  return {
    update_id,
    callback_query: {
      id: `c-${update_id}`,
      from: { id: from, is_bot: false, first_name: 'O' },
      message: { message_id: 10, date: 1, chat: { id: from, type: 'private' } },
      data,
    },
  } as never;
}

const appSecret = 's'.repeat(32);
const now = new Date('2026-10-02T12:00:00Z');

describe('owner orders callbacks', () => {
  const testDbPath = './test-orders-menu.db';

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

  it('adm:ord:list renders order list with buttons', async () => {
    const tenantId = await seedTenantAndCustomer();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 'adm:ord:list'));

    const edits = port.getCallsForMethod('editMessageText');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.args[2]).toBe('Последние заказы:');
    const keyboard = JSON.stringify(edits[0]!.args[3]);
    expect(keyboard).toContain('adm:ord:view:o1');
    expect(keyboard).toContain('adm:menu');
  });

  it('adm:ord:view renders order card with back', async () => {
    const tenantId = await seedTenantAndCustomer();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 'adm:ord:view:o1'));

    const edits = port.getCallsForMethod('editMessageText');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.args[2]).toContain('Заказ №1');
    const keyboard = JSON.stringify(edits[0]!.args[3]);
    expect(keyboard).toContain('adm:ord:list');
  });

  it('adm:ord:msg sets owner reply state', async () => {
    const tenantId = await seedTenantAndCustomer();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 'adm:ord:msg:o1'));

    const edits = port.getCallsForMethod('editMessageText');
    expect(edits[0]!.args[2]).toBe('Напишите сообщение клиенту.');

    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('owner.reply_to_customer');

    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as {
      ownerDraft: { kind: string; targetId: string };
    };
    expect(data.ownerDraft.kind).toBe('ord_msg');
    expect(data.ownerDraft.targetId).toBe('o1');
  });

  it('adm:ord:refs sends stored reference photos to owner', async () => {
    const tenantId = await seedTenantAndCustomer();
    const db = getDb();
    await db.insert(orderAttachments).values({
      id: 'a1',
      orderId: 'o1',
      kind: 'reference',
      fileId: 'file-1',
      fileType: 'photo',
      createdAt: now,
    });
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 'adm:ord:view:o1'));
    const edits = port.getCallsForMethod('editMessageText');
    expect(edits[0]!.args[2]).toContain('Референсы: 1 шт.');
    expect(JSON.stringify(edits[0]!.args[3])).toContain('adm:ord:refs:o1');

    await bot.handleUpdate(cb(2, 555, 'adm:ord:refs:o1'));
    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    expect(photos[0]!.args[0]).toBe(555);
    expect(photos[0]!.args[1]).toBe('file-1');
  });
});
