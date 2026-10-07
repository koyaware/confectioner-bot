import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { sources, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('links', () => {
  const testDbPath = './test-links.db';
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

  it('owner creates a source and gets link and QR with templates', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, botUsername: 'demo_bot' })
      .where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 555, 10, 'adm:src:add'));
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Рилс с бенто',
        entities: [],
      },
    } as never);

    const rows = await getDb().select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('Рилс с бенто');

    await bot.handleUpdate(cb(3, 'c3', 555, 10, `adm:src:view:${rows[0]!.code}`));

    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    // List screen is removed so the chat keeps tidy (one screen rule).
    const deleted = port.getCallsForMethod('deleteMessage');
    expect(deleted.some((c) => c.args[0] === 555 && c.args[1] === 10)).toBe(true);

    const sent = port.getCallsForMethod('sendMessage');
    const textMsg = sent.find((c) =>
      (c.args[1] as string).includes('https://t.me/demo_bot?start=')
    );
    expect(textMsg).toBeTruthy();
    const detailKb = JSON.stringify(textMsg!.args[2]);
    expect(detailKb).toContain(`adm:src:del:${rows[0]!.code}`);
    expect(detailKb).toContain('adm:src:list');
  });

  it('backfills source on later start with code', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 43, type: 'private' },
        from: { id: 43, is_bot: false, first_name: 'C' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 43, type: 'private' },
        from: { id: 43, is_bot: false, first_name: 'C' },
        text: '/start reels',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);

    const { customers } = await import('../src/db/schema.js');
    const rows = await getDb().select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('reels');
    expect(tenantId).toBeTruthy();
  });
});
