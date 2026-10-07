import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('superadmin commands', () => {
  const testDbPath = './test-superadmin.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

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

  function commandMsg(update_id: number, from: number, text: string) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'S' },
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
      },
    } as never;
  }

  it('/status sends info to superadmin', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(commandMsg(1, 1, '/status'));

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[1]).toContain('Статус');
  });

  it('/pause and /resume update tenant status', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(commandMsg(1, 1, '/pause demo'));
    let rows = await getDb().select().from(tenants);
    expect(rows[0]!.status).toBe('paused');

    await bot.handleUpdate(commandMsg(2, 1, '/resume demo'));
    rows = await getDb().select().from(tenants);
    expect(rows[0]!.status).toBe('active');
  });

  it('/tenants lists tenants', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(commandMsg(1, 1, '/tenants'));

    const sent = port.getCallsForMethod('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[1]).toContain('demo');
  });

});
