import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants, customers, orders, relayMessages, sessions } from '../src/db/schema.js';
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

  function cb(update_id: number, from: number, data: string, message_id: number) {
    return {
      update_id,
      callback_query: {
        id: String(update_id),
        from: { id: from, is_bot: false, first_name: 'C', username: 'cust42' },
        message: { message_id, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  it('customer opens relay via rel:start, sends message, owner gets notification with reply button', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    // Create a customer and active order for testing
    const db = getDb();
    const customerId = 'test-cust-relay';
    await db.insert(customers).values({
      id: customerId,
      tenantId,
      telegramId: 42,
      username: 'cust42',
      firstName: 'C',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    const orderId = 'test-order-relay';
    await db.insert(orders).values({
      id: orderId,
      tenantId,
      customerId,
      number: 1,
      status: 'new',
      items: [],
      itemsTotalMinor: 1000,
      deliveryFeeMinor: 0,
      totalMinor: 1000,
      prepaymentMinor: 500,
      capacityUnits: 1,
      dueDate: '2026-01-15',
      fulfillment: 'pickup',
      contactName: 'Test',
      contactPhone: '+79990000000',
      idempotencyKey: 'test-idem-' + orderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // Customer opens relay via rel:start
    await bot.handleUpdate(cb(0, 42, 'rel:start', 9));

    // Customer sends a message in relay
    await bot.handleUpdate(msg(1, 42, 'Подскажите, есть ли доставка?'));

    // Owner got a single message with header + text + reply button
    const sent = port.getCallsForMethod('sendMessage');
    const toOwner = sent.find((c) => c.args[0] === 555);
    expect(toOwner).toBeTruthy();
    expect((toOwner!.args[1] as string)).toContain('cust42');
    expect((toOwner!.args[1] as string)).toContain('Подскажите, есть ли доставка?');
    // Keyboard has only the block button; owner replies via Telegram reply (no write-to-client button)
    const opts = toOwner!.args[2] as { keyboard?: { inline_keyboard: { text: string }[][] } };
    expect(
      opts.keyboard?.inline_keyboard.some((row) =>
        row.some((btn) => btn.text === '🚫 Блокировать')
      )
    ).toBe(true);
    expect(
      opts.keyboard?.inline_keyboard.some((row) =>
        row.some((btn) => btn.text === '✍️ Ответить')
      )
    ).toBe(false);

    // Customer got auto-reply
    expect(
      sent.some((c) => c.args[0] === 42 && (c.args[1] as string).includes('Мастер скоро ответит'))
    ).toBe(true);

    // Relay messages saved
    const rows = await getDb().select().from(relayMessages);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Dialog state is set (goes back to idle after message sent)
    const sessionRows = await getDb().select().from(sessions);
    expect(sessionRows[0]!.state).toBe('idle');
  });

  it('owner replies via reply-to-message, customer receives it', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // Customer opens relay and sends message
    await bot.handleUpdate(cb(0, 42, 'rel:start', 9));
    await bot.handleUpdate(msg(1, 42, 'Подскажите, есть ли доставка?'));

    // Debug: check session state
    const sessionRows = await getDb().select().from(sessions);
    console.log('SESSION STATE AFTER MESSAGE:', sessionRows[0]?.state);

    // Find the relay message to get owner message ID
    const relayRows = await getDb().select().from(relayMessages).where(eq(relayMessages.tenantId, tenantId));
    console.log('RELAY ROWS:', relayRows);
    const relay = relayRows[0]!;

    // Owner replies by replying to the relay message
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 99,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Да, есть, от 300 ₽',
        reply_to_message: { message_id: relay.ownerMessageId, chat: { id: 555 }, date: 1 },
      },
    } as never);

    // Customer receives the reply
    const copies = port.getCallsForMethod('copyMessage');
    const toCustomer = copies.find((c) => c.args[0] === 42);
    expect(toCustomer).toBeTruthy();

    // Owner gets confirmation
    const sent = port.getCallsForMethod('sendMessage');
    const toOwner = sent.find((c) => c.args[0] === 555 && (c.args[1] as string).includes('Отправлено клиенту'));
    expect(toOwner).toBeTruthy();
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

    // Future relay from this customer goes nowhere
    await bot.handleUpdate(msg(2, 42, 'Ещё вопрос'));
    const sentAfter = port.getCallsForMethod('sendMessage').filter((c) => c.args[0] === 555);
    expect(sentAfter).toHaveLength(0);
  });

  it('stray customer text is removed with a hint, not relayed', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(msg(1, 42, 'Просто текст'));

    expect(port.getCallsForMethod('copyMessage')).toHaveLength(0);
    expect(port.getCallsForMethod('deleteMessage')).toHaveLength(1);
    const sent = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sent.some((t) => t.includes('✍️ Написать мастеру'))).toBe(true);
    expect(tenantId).toBeTruthy();
  });
});