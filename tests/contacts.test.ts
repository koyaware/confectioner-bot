import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { decodeCallback } from '../src/bot/callbacks.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('contacts instead of chat', () => {
  const testDbPath = './test-contacts.db';
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

  function cb(updateId: number, from: number, msgId: number, data: string) {
    return {
      update_id: updateId,
      callback_query: {
        id: `cb${updateId}`,
        from: { id: from, is_bot: false, first_name: 'C' },
        message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  function textMsg(update_id: number, from: number, text: string) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'C' },
        text,
        entities: [],
      },
    } as never;
  }

  it('cnt:show renders owner contacts with back button', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, contactsText: 'Звоните: +79990000000' })
      .where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    expect(decodeCallback('cnt:show')).toEqual({
      ok: true,
      value: { ns: 'cnt', action: 'show' },
    });

    await bot.handleUpdate(cb(1, 42, 9, 'cnt:show'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits.length).toBeGreaterThan(0);
    const last = edits[edits.length - 1]!;
    expect(last.args[2] as string).toContain('📞 Контакты мастера');
    expect(last.args[2] as string).toContain('+79990000000');
  });

  it('cnt:show falls back when owner set no contacts', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, contactsText: null })
      .where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 42, 9, 'cnt:show'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2] as string).toContain('шапке профиля Instagram');
  });

  it('free text points to contacts once per 6h, nothing relayed', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(textMsg(1, 42, 'Здравствуйте, а торт будет?'));
    let sent = port.getCallsForMethod('sendMessage');
    const first = sent.filter((c) => c.args[0] === 42);
    expect(first).toHaveLength(1);
    expect(first[0]!.args[1] as string).toContain('📞 Контакты мастера');
    // Owner got nothing: no chat in this bot.
    expect(sent.some((c) => c.args[0] === 555)).toBe(false);

    // Second text within the window stays silent.
    await bot.handleUpdate(textMsg(2, 42, 'Ау?'));
    sent = port.getCallsForMethod('sendMessage');
    expect(sent.filter((c) => c.args[0] === 42)).toHaveLength(1);
  });
});
