import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

// Bug 36: owner content must be escaped in HTML messages.
describe('owner content escaping', () => {
  const testDbPath = './test-escaping.db';
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

  it('shopName and texts with HTML render escaped', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({
        ownerTelegramId: 555,
        shopName: '<b>Hack&Co',
        greetingText: null,
        busyText: 'Закрыто <soon>',
        contactsText: 'Звоните <8>',
      })
      .where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);

    const sent = port.getCallsForMethod('sendMessage');
    const greeting = sent.find((c) => c.args[0] === 42);
    expect(greeting).toBeTruthy();
    expect(greeting!.args[1] as string).toContain('&lt;b&gt;Hack&amp;Co');
    expect(greeting!.args[1] as string).not.toContain('<b>Hack');
  });
});
