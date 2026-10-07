import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { encodeCallback, decodeCallback } from '../src/bot/callbacks.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('settings language/currency buttons', () => {
  const testDbPath = './test-settings-lang.db';
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
        from: { id: from, is_bot: false, first_name: 'O' },
        message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  async function tenantRow(tenantId: string) {
    const rows = await getDb().select().from(tenants).where(eq(tenants.id, tenantId));
    return rows[0]!;
  }

  it('codec roundtrips lang/cur buttons and rejects invalid codes', () => {
    expect(decodeCallback('adm:set:lang')).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'lang' },
    });
    expect(decodeCallback('adm:set:lang:uz')).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'lang', arg: 'uz' },
    });
    expect(decodeCallback('adm:set:cur')).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'cur' },
    });
    expect(decodeCallback('adm:set:cur:kzt')).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'cur', arg: 'kzt' },
    });
    expect(decodeCallback('adm:set:lang:kk')).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'lang', arg: 'kk' },
    });
    expect(decodeCallback('adm:set:lang:en')).toEqual({ ok: false, error: 'BAD_CALLBACK' });
    expect(decodeCallback('adm:set:cur:usd')).toEqual({ ok: false, error: 'BAD_CALLBACK' });
    expect(
      decodeCallback(encodeCallback({ ns: 'adm', area: 'set', action: 'lang', arg: 'ru' }))
    ).toEqual({
      ok: true,
      value: { ns: 'adm', area: 'set', action: 'lang', arg: 'ru' },
    });
  });

  it('settings list shows language and currency rows', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:list'));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits.length).toBeGreaterThan(0);
    const last = edits[edits.length - 1]!;
    const keyboard = (
      last.args[3] as {
        keyboard: { inline_keyboard: { text: string; callback_data?: string }[][] };
      }
    ).keyboard;
    const datas = keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain('adm:set:lang');
    expect(datas).toContain('adm:set:cur');
  });

  it('owner switches language to uz: list re-renders in Uzbek', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:lang'));
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2]).toContain('🌐');

    await bot.handleUpdate(cb(2, 555, 1, 'adm:set:lang:uz'));

    expect((await tenantRow(tenantId)).language).toBe('uz');
    edits = port.getCallsForMethod('editMessageTextOrSend');
    // Settings list is re-rendered in the NEW language, not stale ctx.t.
    expect(edits[edits.length - 1]!.args[2]).toContain('Doʻkon sozlamalari');
  });

  it('language and currency are independent', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:cur:kzt'));
    let row = await tenantRow(tenantId);
    expect(row.currency).toBe('₸');
    expect(row.language).toBe('ru');
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    // Russian texts stay with KZT currency.
    expect(edits[edits.length - 1]!.args[2]).toContain('Настройки');

    await bot.handleUpdate(cb(2, 555, 1, 'adm:set:lang:uz'));
    row = await tenantRow(tenantId);
    expect(row.language).toBe('uz');
    expect(row.currency).toBe('₸');
    edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2]).toContain('Doʻkon sozlamalari');
  });

  it('owner switches language to kk: list re-renders in Kazakh', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:lang:kk'));

    expect((await tenantRow(tenantId)).language).toBe('kk');
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2]).toContain('Дүкен баптаулары');
  });

  it('settings list has no currency text input, only the picker', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:list'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const kb = JSON.stringify(edits[edits.length - 1]!.args[3]);
    expect(kb).toContain('adm:set:cur');
    expect(kb).not.toContain('adm:set:edit:currency');
  });

  it('invalid codes and non-owner attempts change nothing', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    const before = await tenantRow(tenantId);

    await bot.handleUpdate(cb(1, 555, 1, 'adm:set:lang:en'));
    await bot.handleUpdate(cb(2, 555, 1, 'adm:set:cur:usd'));
    await bot.handleUpdate(cb(3, 777, 1, 'adm:set:lang:uz'));

    const after = await tenantRow(tenantId);
    expect(after.language).toBe(before.language);
    expect(after.currency).toBe(before.currency);
  });

  it('uz customer sees Uzbek menu buttons end-to-end', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, language: 'uz' })
      .where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'U' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);

    const sent = port.getCallsForMethod('sendMessage');
    const menu = sent.find((c) => c.args[0] === 42);
    expect(menu).toBeTruthy();
    const keyboard = (
      menu!.args[2] as {
        keyboard: { inline_keyboard: { text: string; callback_data?: string }[][] };
      }
    ).keyboard;
    const labels = keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain('📦 Katalog');
    expect(labels).toContain('🛒 Savatcha');
    expect(labels).toContain('📋 Buyurtmalarim');
    expect(labels).toContain('📞 Kontaktlar');
    expect(labels.some((t) => /[А-Яа-яЁё]/.test(t))).toBe(false);
  });
});
