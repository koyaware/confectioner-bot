import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants, customers, relayMessages } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('relay', () => {
  const testDbPath = './test-relay.db';
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

  function msg(update_id: number, from: number, text: string, extra?: Record<string, unknown>) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'C', username: 'cust42' },
        text,
        entities: [],
        ...extra,
      },
    } as never;
  }

  it('customer free text goes to owner with header, owner reply goes back', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // customer writes to bot
    await bot.handleUpdate(msg(1, 42, 'Подскажите, есть ли доставка?'));

    // owner got header + copy
    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.some((c) => c.args[0] === 555 && (c.args[1] as string).includes('cust42'))).toBe(
      true
    );
    const copies = port.getCallsForMethod('copyMessage');
    expect(copies.some((c) => c.args[0] === 555)).toBe(true);

    // customer got auto-reply
    expect(
      sent.some((c) => c.args[0] === 42 && (c.args[1] as string).includes('Передал мастеру'))
    ).toBe(true);

    // relay messages saved
    const rows = await getDb().select().from(relayMessages);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // find owner header message id for reply
    const headerId = rows[0]!.ownerMessageId;

    // owner replies referencing the header
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 99,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Да, есть, от 300 ₽',
        reply_to_message: { message_id: headerId, chat: { id: 555 }, date: 1 },
      },
    } as never);

    const copies2 = port.getCallsForMethod('copyMessage');
    const toCustomer = copies2.find((c) => c.args[0] === 42);
    expect(toCustomer).toBeTruthy();
  });

  it('owner can block a client from the relay header', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const db = getDb();
    await db.insert(customers).values({
      id: 'cust-block',
      tenantId,
      telegramId: 42,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'c1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 10, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:relay:block:cust-block',
      },
    } as never);

    const rows = await getDb().select().from(customers).where(eq(customers.id, 'cust-block'));
    expect(rows[0]!.isBlocked).toBe(true);

    // future relay from this customer goes nowhere
    await bot.handleUpdate(msg(2, 42, 'Ещё вопрос'));
    const sentAfter = port.getCallsForMethod('sendMessage').filter((c) => c.args[0] === 555);
    expect(sentAfter).toHaveLength(0);
  });

  it('customer voice messages are relayed to owner', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C', username: 'cust42' },
        voice: { file_id: 'voice1', file_unique_id: 'v1', duration: 5 },
      },
    } as never);

    const copies = port.getCallsForMethod('copyMessage');
    expect(copies.some((c) => c.args[0] === 555)).toBe(true);
  });
  it('rel:start compose flow acks the customer reply', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'c1',
        from: { id: 42, is_bot: false, first_name: 'C' },
        message: { message_id: 10, date: 1, chat: { id: 42, type: 'private' } },
        data: 'rel:start',
      },
    } as never);
    await bot.handleUpdate(msg(2, 42, 'Когда будет готово?'));

    const sent = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sent.some((t) => t.includes('Мастер скоро ответит'))).toBe(true);

    const { sessions } = await import('../src/db/schema.js');
    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('idle');
    expect(tenantId).toBeTruthy();
  });
});
