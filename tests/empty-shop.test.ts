import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { createTenant } from '../src/services/tenants.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';

// Presale gate: a brand-new shop with no catalog content must render
// friendly empty states everywhere instead of crashing or blank screens.
describe('empty shop first run', () => {
  const testDbPath = './test-empty-shop.db';
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
        from: { id: from, is_bot: false, first_name: 'U' },
        message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  it('empty catalog, faq, orders and contacts fallback render cleanly', async () => {
    const created = await createTenant({
      slug: 'fresh-shop',
      shopName: 'Fresh',
      botToken: '111:x',
      botId: 111,
      botUsername: 'fresh_bot',
      appSecret,
      now: new Date(),
    });
    if (!created.ok) throw new Error(created.error);

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', created.value.id, 'demo', port);

    await bot.handleUpdate(cb(2, 'c1', 42, 10, 'cat:list'));
    await bot.handleUpdate(cb(3, 'c2', 42, 10, 'faq:list'));
    await bot.handleUpdate(cb(4, 'c3', 42, 10, 'my:list'));
    await bot.handleUpdate(cb(5, 'c4', 42, 10, 'cnt:show'));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits).toHaveLength(4);
    const texts = edits.map((c) => String(c.args[2]));
    expect(texts[0]).toContain('пока нет категорий');
    expect(texts[1]).toContain('пока не добавлены');
    expect(texts[2]).toContain('пока нет заказов');
    expect(texts[3]).toContain('Контакты мастера');
    for (const t of texts) {
      expect(t.trim().length).toBeGreaterThan(0);
    }

    // Guest (not owner, no claim) gets the customer menu, nothing crashes.
    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 6,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: '/menu',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    } as never);
    expect(
      port
        .getCallsForMethod('sendMessage')
        .some((c) => c.args[0] === 555 && String(c.args[1]).includes('Главное меню'))
    ).toBe(true);
  });
});
