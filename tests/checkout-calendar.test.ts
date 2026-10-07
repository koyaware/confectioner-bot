import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { capacityOverrides, orders, customers, sessions } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('checkout calendar', () => {
  const testDbPath = './test-calendar.db';
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

  async function addOneToCart(bot: ReturnType<typeof createTenantBot>['bot'], port: FakePort) {
    await bot.handleUpdate(cb(101, 'c1', 42, 10, 'cat:list'));
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    const catBtn = JSON.stringify(edits[0]!.args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(102, 'c2', 42, 10, catBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const prdBtn = JSON.stringify(edits[1]!.args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(103, 'c3', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const addBtn = JSON.stringify(edits[2]!.args[3]).match(/prd:add:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(104, 'c4', 42, 10, addBtn));
  }

  it('closed and full days are blocked in the calendar, date picker sets date', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const today = toIsoDate(now, 'Europe/Moscow');
    const closedDate = addDays(today, 3);
    await getDb().insert(capacityOverrides).values({
      tenantId,
      date: closedDate,
      capacity: 5,
      isClosed: true,
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await addOneToCart(bot, port);
    await bot.handleUpdate(cb(1, 'c5', 42, 10, 'cart:show'));
    await bot.handleUpdate(cb(2, 'c6', 42, 10, 'chk:start'));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const calendarMsg = edits[edits.length - 1]!;
    const kb = JSON.stringify(calendarMsg.args[3]);
    expect(kb).toContain('✕');
    const closedDay = Number(closedDate.slice(8, 10));
    expect(kb).toContain(`"text":"${closedDay} ✕"`);
    expect(kb).toContain('callback_data":"cart:noop"');
    // the closed day must not have a chk:date callback
    expect(kb).not.toContain(`"callback_data":"chk:date:${closedDate}"`);

    // clicking the closed day (noop) keeps dueDate unset
    await bot.handleUpdate(cb(3, 'c7', 42, 10, 'cart:noop'));
    let rows = await getDb().select().from(sessions);
    let data = (typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data) as {
      checkout?: { dueDate?: string };
    };
    expect(data.checkout?.dueDate).toBeUndefined();

    // pick a free available date
    const freeDate = addDays(today, 6);
    await bot.handleUpdate(cb(4, 'c8', 42, 10, `chk:date:${freeDate}`));
    rows = await getDb().select().from(sessions);
    data = (typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data) as {
      checkout?: { dueDate?: string };
    };
    expect(data.checkout?.dueDate).toBe(freeDate);
    expect(rows[0]!.state).toBe('checkout.time');
  });
});
