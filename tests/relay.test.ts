import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants, customers, relayMessages } from '../src/db/schema.js';
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

  it('customer free text goes to owner with header, owner reply goes back', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // customer writes to bot
    await bot.handleUpdate(msg(1, 42, 'Подскажите, есть ли доставка?'));

    // owner got header + copy
    const sent = port.getCallsForMethod('sendMessage');
    expect(sent.some((c) => c.args[0] === 555 && (c.args[1] as string).includes('cust42'))).toBe(
      true
    );
    const copies = port.getCallsForMethod('copyMessage');
    expect(copies.some((c) => c.args[0] === 555)).toBe(true);

    // customer got auto-reply
    expect(
      sent.some((c) => c.args[0] === 42 && (c.args[1] as string).includes('Передал мастеру'))
    ).toBe(true);

    // relay messages saved
    const rows = await getDb().select().from(relayMessages);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // find owner header message id for reply
    const headerId = rows[0]!.ownerMessageId;

    // owner replies referencing the header
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 99,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Да, есть, от 300 ₽',
        reply_to_message: { message_id: headerId, chat: { id: 555 }, date: 1 },
      },
    } as never);

    const copies2 = port.getCallsForMethod('copyMessage');
    const toCustomer = copies2.find((c) => c.args[0] === 42);
    expect(toCustomer).toBeTruthy();
  });
});
