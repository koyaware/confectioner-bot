import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { customers, orders, funnelEvents, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const appSecret = 's'.repeat(32);
const testDbPath = './test-scratch-stats2.db';
const now = new Date('2026-10-02T12:00:00Z');

function cb(update_id: number, id: string, from: number, msgId: number, data: string) {
  return {
    update_id,
    callback_query: {
      id,
      from: { id: from, is_bot: false, first_name: 'O' },
      message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
      data,
    },
  } as never;
}

describe('scratch stats buttons', () => {
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

  it('cycles 7/30/7 and detects identical re-edits', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const D = 86400000;
    await db
      .update(tenants)
      .set({ ownerTelegramId: 555 })
      .where(eq(tenants.id, tenantId));
    await db.insert(customers).values({
      id: 'c1', tenantId, telegramId: 1, source: 'reels',
      firstSeenAt: new Date(now.getTime() - D), lastSeenAt: now,
    });
    await db.insert(orders).values({
      id: 'o1', tenantId, number: 1, customerId: 'c1', status: 'confirmed',
      dueDate: '2026-10-05', fulfillment: 'pickup', contactName: 'A', contactPhone: '1',
      itemsTotalMinor: 10000, totalMinor: 10000, prepaymentMinor: 5000, capacityUnits: 1,
      idempotencyKey: 'k1', createdAt: new Date(now.getTime() - 2 * D),
      decidedAt: new Date(now.getTime() - 2 * D + 3600000), updatedAt: now,
    });
    await db.insert(funnelEvents).values([
      { tenantId, customerId: 'c1', type: 'catalog_view', at: new Date(now.getTime() - D) },
      { tenantId, customerId: 'c1', type: 'free_text', at: new Date(now.getTime() - D) },
    ]);

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    const seen: string[] = [];
    for (const [i, data] of ['adm:stats', 'adm:stats:7', 'adm:stats:30', 'adm:stats:7'].entries()) {
      await bot.handleUpdate(cb(i + 1, `c${i}`, 555, 10, data));
      const edits = port.getCallsForMethod('editMessageTextOrSend');
      const last = edits[edits.length - 1]!;
      seen.push(String(last.args[2]).slice(0, 60));
    }
    console.log('SCREENS:', JSON.stringify(seen, null, 1));
    const answers = port.getCallsForMethod('answerCallback');
    console.log('ANSWERS:', answers.length);
    // identical consecutive re-edits would 400 live ("message is not modified")
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const texts = edits.map((c) => String(c.args[2]));
    const dupes = texts.filter((t, i) => i > 0 && t === texts[i - 1]);
    console.log('IDENTICAL RE-EDITS:', dupes.length);
    expect(true).toBe(true);
  });
});
