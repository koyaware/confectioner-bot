import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('overload mode', () => {
  const testDbPath = './test-overload.db';
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

  it('chk:start shows busyText and does not start checkout when overloaded', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ acceptOrders: false, busyText: 'Много заказов, подойдите позже' });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'cat:list'));
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    const catBtn = JSON.stringify(edits[0]!.args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(2, 'c2', 42, 10, catBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const prdBtn = JSON.stringify(edits[1]!.args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(3, 'c3', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const addBtn = JSON.stringify(edits[2]!.args[3]).match(/prd:add:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(4, 'c4', 42, 10, addBtn));
    await bot.handleUpdate(cb(5, 'c5', 42, 10, 'cart:show'));
    await bot.handleUpdate(cb(6, 'c6', 42, 10, 'chk:start'));

    const busyEdits = port.getCallsForMethod('editMessageTextOrSend');
    const busyLast = busyEdits[busyEdits.length - 1]!;
    expect(busyLast.args[1]).toBe(10);
    expect(busyLast.args[2] as string).toContain('Много заказов');
    expect(
      port
        .getCallsForMethod('sendMessage')
        .some((c) => (c.args[1] as string).includes('Много заказов'))
    ).toBe(false);

    const sessions = await getDb()
      .select()
      .from((await import('../src/db/schema.js')).sessions);
    for (const s of sessions) {
      const data = (typeof s.data === 'string' ? JSON.parse(s.data) : s.data) as {
        checkout?: unknown;
      };
      expect(data.checkout).toBeUndefined();
    }
  });

  it('owner toggles acceptOrders via settings', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(0, 'c0', 555, 10, 'adm:set:list'));
    const listEdits = port.getCallsForMethod('editMessageTextOrSend');
    expect(JSON.stringify(listEdits[0]!.args[3])).toContain('adm:set:edit:toggle_accept');

    await bot.handleUpdate(cb(1, 'c1', 555, 10, 'adm:set:edit:toggle_accept'));
    let rows = await getDb().select().from(tenants);
    expect(rows[0]!.acceptOrders).toBe(false);

    await bot.handleUpdate(cb(2, 'c2', 555, 10, 'adm:set:edit:toggle_accept'));
    rows = await getDb().select().from(tenants);
    expect(rows[0]!.acceptOrders).toBe(true);
  });
});
