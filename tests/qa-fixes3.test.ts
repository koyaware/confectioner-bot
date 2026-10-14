import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { toIsoDate, zonedTimeToUtc } from '../src/lib/time.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const testDbPath = './test-qafix3.db';
const appSecret = 's'.repeat(32);

describe('QA fixes 3: timezone fallback', () => {
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
    } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    delete process.env.APP_SECRET;
    delete process.env.SUPERADMIN_TELEGRAM_ID;
  });

  it('invalid timezones fall back to UTC instead of throwing', () => {
    const at = new Date('2026-10-02T12:00:00Z');
    expect(toIsoDate(at, 'Mars/Olympus')).toBe('2026-10-02');
    expect(toIsoDate(at, '')).toBe('2026-10-02');
    expect(toIsoDate(at, 'Europe/Moscow')).toBe('2026-10-02');
    expect(zonedTimeToUtc('2026-10-02', '09:00', 'Mars/Olympus')).toBeInstanceOf(Date);
  });

  it('bug 61: bad tenant timezone keeps date screens alive', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb()
      .update(tenants)
      .set({ ownerTelegramId: 555, timezone: 'Mars/Olympus' })
      .where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'c1',
        from: { id: 42, is_bot: false, first_name: 'U' },
        message: { message_id: 10, date: 1, chat: { id: 42, type: 'private' } },
        data: 'chk:start',
      },
    } as never);
    const pings = port
      .getCallsForMethod('sendMessage')
      .filter((c) => String(c.args[1]).includes('Ошибка бота'));
    expect(pings).toHaveLength(0);
  });
});
