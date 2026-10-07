import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { listFaq } from '../src/services/faq.js';
import { tenants, funnelEvents } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('faq', () => {
  const testDbPath = './test-faq.db';
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

  it('customer sees faq list and answer with back button', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 42, is_bot: false, first_name: 'C' },
        message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' } },
        data: 'faq:list',
      },
    } as never);

    let edits = port.getCallsForMethod('editMessageText');
    expect(edits).toHaveLength(1);
    let buttons = JSON.stringify(edits[0]!.args[3]);
    expect(buttons).toContain('faq:view:');

    const match = buttons.match(/faq:view:([A-Za-z0-9_-]+)/);
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'cb2',
        from: { id: 42, is_bot: false, first_name: 'C' },
        message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' } },
        data: `faq:view:${match![1]}`,
      },
    } as never);

    edits = port.getCallsForMethod('editMessageText');
    expect(edits).toHaveLength(2);
    buttons = JSON.stringify(edits[1]!.args[3]);
    expect(buttons).toContain('faq:list');

    const events = await getDb().select().from(funnelEvents);
    expect(events.map((e) => e.type)).toContain('faq_view');
  });

  it('owner adds a faq item via edit_field state', async () => {
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
        data: 'adm:faq:add',
      },
    } as never);

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Можно ли оформить заказ сегодня?',
        entities: [],
      },
    } as never);

    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Да, если есть слоты на нужную дату.',
        entities: [],
      },
    } as never);

    const items = await listFaq(tenantId);
    expect(items.map((f) => f.question)).toContain('Можно ли оформить заказ сегодня?');
  });
});
