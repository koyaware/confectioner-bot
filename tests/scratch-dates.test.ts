import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { createTenant } from '../src/services/tenants.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { getDateAvailability } from '../src/services/dates.js';

const appSecret = 's'.repeat(32);
const testDbPath = './test-scratch-dates.db';

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

describe('scratch dates', () => {
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

  it('dumps tenant defaults and availability for a real-path tenant', async () => {
    const created = await createTenant({
      slug: 'real-shop',
      shopName: 'Real',
      botToken: '111:x',
      botId: 111,
      botUsername: 'real_bot',
      appSecret,
      now: new Date(),
    });
    if (!created.ok) throw new Error(created.error);
    const tenantId = created.value.id;
    const t = (await getDb().select().from(tenants).where(eq(tenants.id, tenantId)))[0]!;
    console.log(
      'TENANT:',
      JSON.stringify({
        acceptOrders: t.acceptOrders,
        minLeadDays: t.minLeadDays,
        maxAdvanceDays: t.maxAdvanceDays,
        defaultDailyCapacity: t.defaultDailyCapacity,
        timezone: t.timezone,
        currency: t.currency,
        language: t.language,
        status: t.status,
      })
    );

    const now = new Date();
    const iso = now.toISOString().slice(0, 10);
    const avail = await getDateAvailability(tenantId, iso.slice(0, 7) + '-01', iso.slice(0, 7) + '-28', { lines: [] }, now);
    const entries = Object.entries(avail);
    const open = entries.filter(([, v]) => v.available).map(([d]) => d);
    const closedReasons: Record<string, number> = {};
    for (const [, v] of entries) {
      if (!v.available) closedReasons[v.reason ?? '?'] = (closedReasons[v.reason ?? '?'] ?? 0) + 1;
    }
    console.log('OPEN:', open.length, 'CLOSED:', JSON.stringify(closedReasons));

    // walk to date step with empty cart
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'cat:list'));
    await bot.handleUpdate(cb(2, 'c2', 42, 10, 'chk:start'));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const last = edits[edits.length - 1]!;
    console.log('SCREEN:', JSON.stringify(String(last.args[2]).slice(0, 120)));
    const kb = JSON.stringify(last.args[3]);
    const openBtns = (kb.match(/chk:date:\d{4}-\d{2}-\d{2}/g) || []).length;
    const closedBtns = (kb.match(/✕/g) || []).length;
    console.log('OPEN BTNS:', openBtns, 'CLOSED BTNS:', closedBtns);
    expect(true).toBe(true);
  });
});
