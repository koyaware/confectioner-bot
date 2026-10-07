import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('owner settings', () => {
  const testDbPath = './test-settings.db';
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

  it('owner edits greeting text and it is used for customers', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:set:edit:greetingText',
      },
    } as never);

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Новое приветствие',
        entities: [],
      },
    } as never);

    const rows = await getDb().select().from(tenants);
    expect(rows[0]!.greetingText).toBe('Новое приветствие');
  });

  it('saving a setting edits the prompt screen instead of sending anew', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:set:edit:greetingText',
      },
    } as never);
    const sendsBefore = port.getCallsForMethod('sendMessage').length;

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Новое приветствие',
        entities: [],
      },
    } as never);

    // The prompt screen (message 1) is edited; no new bot message appears.
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(sendsBefore);
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const saved = edits.filter((c) => c.args[1] === 1);
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(String(saved[saved.length - 1]!.args[2])).toContain('Сохранено');
  });

  it('invalid prepayment percent is rejected and keeps old value', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:set:edit:prepaymentPercent',
      },
    } as never);

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: '150',
        entities: [],
      },
    } as never);

    const rows = await getDb().select().from(tenants);
    expect(rows[0]!.prepaymentPercent).toBe(50);
  });

  it('delivery fee is entered in rubles and stored as minor units', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:set:edit:deliveryFeeMinor',
      },
    } as never);

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: '350',
        entities: [],
      },
    } as never);

    const rows = await getDb().select().from(tenants);
    expect(rows[0]!.deliveryFeeMinor).toBe(35000);
  });
});
