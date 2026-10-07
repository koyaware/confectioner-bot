import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { customers, orders, sessions, tenants } from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { eraseCustomerData } from '../src/services/privacy.js';

describe('deleteme', () => {
  const testDbPath = './test-deleteme.db';
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

  function msg(update_id: number, from: number, text: string) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'C' },
        text,
        entities: text.startsWith('/')
          ? [{ type: 'bot_command', offset: 0, length: text.length }]
          : [],
      },
    } as never;
  }

  async function seedTenantAndCustomer() {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    await db.insert(customers).values({
      id: 'c1',
      tenantId,
      telegramId: 42,
      firstName: 'Иван',
      username: 'ivan',
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
      address: 'ул. Пушкина, 10',
      comment: 'Позвонить',
      itemsTotalMinor: 1000,
      totalMinor: 1000,
      prepaymentMinor: 500,
      capacityUnits: 1,
      idempotencyKey: 'k1',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sessions).values({
      tenantId,
      telegramId: 42,
      state: 'idle',
      data: JSON.stringify({
        cart: { lines: [] },
        checkout: {
          contactName: 'Иван',
          contactPhone: '+7999',
          address: 'ул. Пушкина, 10',
          comment: 'Позвонить',
        },
      }),
      updatedAt: now,
    });
    return tenantId;
  }

  it('eraseCustomerData masks customer and order personal data', async () => {
    const tenantId = await seedTenantAndCustomer();
    const db = getDb();
    const { funnelEvents, relayMessages, orderAttachments } = await import('../src/db/schema.js');
    await db.insert(funnelEvents).values({
      tenantId,
      customerId: 'c1',
      type: 'catalog_view',
      at: now,
    });
    await db.insert(relayMessages).values({
      id: 'r1',
      tenantId,
      customerId: 'c1',
      ownerChatId: 555,
      ownerMessageId: 10,
      customerChatId: 42,
      createdAt: now,
    });
    await db.insert(orderAttachments).values({
      id: 'a1',
      orderId: 'o1',
      kind: 'receipt',
      fileId: 'file-1',
      fileType: 'photo',
      createdAt: now,
    });

    const ok = await eraseCustomerData(tenantId, 42);
    expect(ok).toBe(true);

    const cust = await getDb().select().from(customers);
    expect(cust[0]!.firstName).toBe('[удалено]');
    expect(cust[0]!.phone).toBe('[удалено]');
    expect(cust[0]!.username).toBeNull();

    const ord = await getDb().select().from(orders);
    expect(ord[0]!.contactName).toBe('[удалено]');
    expect(ord[0]!.contactPhone).toBe('[удалено]');
    expect(ord[0]!.address).toBe('[удалено]');
    expect(ord[0]!.comment).toBe('[удалено]');

    expect(await getDb().select().from(funnelEvents)).toHaveLength(0);
    expect(await getDb().select().from(relayMessages)).toHaveLength(0);
    expect(await getDb().select().from(orderAttachments)).toHaveLength(0);

    const sess = await getDb().select().from(sessions);
    const data = typeof sess[0]!.data === 'string' ? JSON.parse(sess[0]!.data) : sess[0]!.data;
    expect(data.checkout.contactName).toBe('[удалено]');
    expect(data.checkout.contactPhone).toBe('[удалено]');
    expect(data.checkout.address).toBe('[удалено]');
    expect(data.checkout.comment).toBe('[удалено]');
  });

  it('/deleteme masks data and confirms to customer', async () => {
    const tenantId = await seedTenantAndCustomer();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(msg(1, 42, '/deleteme'));

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!.args[1]).toContain('обезличены');
  });
});
