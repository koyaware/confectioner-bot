import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { sessions } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('contact share button', () => {
  const testDbPath = './test-contactshare.db';
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
        from: { id: from, is_bot: false, first_name: 'C' },
        message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  function msg(update_id: number, from: number, text: string) {
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

  function contactMsg(update_id: number, from: number) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'C' },
        contact: { phone_number: '+79990001122', first_name: 'Ivan', user_id: from },
      },
    } as never;
  }

  async function driveToContact(port: FakePort, bot: ReturnType<typeof createTenantBot>['bot']) {
    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'cat:list'));
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    const catBtn = JSON.stringify(edits[0]!.args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(2, 'c2', 42, 10, catBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const prdBtn = JSON.stringify(edits[1]!.args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(3, 'c3', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const addBtn = JSON.stringify(edits[edits.length - 1]!.args[3]).match(
      /prd:add:[A-Za-z0-9_-]+/
    )![0];
    await bot.handleUpdate(cb(4, 'c4', 42, 10, addBtn));
    await bot.handleUpdate(cb(5, 'c5', 42, 10, 'cart:show'));
    await bot.handleUpdate(cb(6, 'c6', 42, 10, 'chk:start'));
    const freeDate = addDays(toIsoDate(new Date(), 'Europe/Moscow'), 5);
    await bot.handleUpdate(cb(7, 'c7', 42, 10, `chk:date:${freeDate}`));
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));
  }

  async function sessionData() {
    const rows = await getDb().select().from(sessions);
    const data = rows[0]!.data;
    return (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  }

  it('contact step sends one reply keyboard with request_contact', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    void tenantId;
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await driveToContact(port, bot);

    const sends = port.getCallsForMethod('sendMessage');
    const kbSends = sends.filter(
      (c) => (c.args[2] as { replyKeyboard?: unknown } | undefined)?.replyKeyboard
    );
    expect(kbSends).toHaveLength(1);
    const kb = (
      kbSends[0]!.args[2] as { replyKeyboard: { text: string; requestContact?: boolean }[][] }
    ).replyKeyboard;
    expect(kb[0]![0]).toEqual({ text: '📱 Отправить контакт', requestContact: true });

    const data = await sessionData();
    expect(typeof data.contactKbMsgId).toBe('number');
  });

  it('shared contact fills name/phone, advances and removes keyboard', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    void tenantId;
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await driveToContact(port, bot);
    const before = await sessionData();
    const kbId = before.contactKbMsgId as number;

    await bot.handleUpdate(contactMsg(30, 42));

    const data = await sessionData();
    const checkout = data.checkout as { contactName: string; contactPhone: string };
    expect(checkout.contactName).toBe('Ivan');
    expect(checkout.contactPhone).toBe('+79990001122');
    expect(data.contactKbMsgId).toBeUndefined();

    const deleted = port.getCallsForMethod('deleteMessage');
    expect(deleted.some((c) => c.args[1] === kbId)).toBe(true);
    const sends = port.getCallsForMethod('sendMessage');
    expect(
      sends.some((c) => (c.args[2] as { removeKeyboard?: boolean } | undefined)?.removeKeyboard)
    ).toBe(true);
  });

  it('typed contact also clears the keyboard', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    void tenantId;
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await driveToContact(port, bot);
    const before = await sessionData();
    expect(typeof before.contactKbMsgId).toBe('number');

    await bot.handleUpdate(msg(31, 42, 'Иван, +79991234567'));

    const data = await sessionData();
    expect(data.contactKbMsgId).toBeUndefined();
    const sends = port.getCallsForMethod('sendMessage');
    expect(
      sends.some((c) => (c.args[2] as { removeKeyboard?: boolean } | undefined)?.removeKeyboard)
    ).toBe(true);
  });
});
