import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { truncateHtml } from '../src/domain/truncate.js';
import { formatDigest } from '../src/services/digest.js';
import { stringsFor } from '../src/i18n/index.js';
import { tenants, customers, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qafix5.db';
const appSecret = 's'.repeat(32);
const now = new Date();

let seq = 26000;
function cb(cbId: string, fromId: number, msgId: number, data: string) {
  return {
    update_id: seq++,
    callback_query: {
      id: cbId,
      from: { id: fromId, is_bot: false, first_name: 'U' },
      message: { message_id: msgId, date: 1, chat: { id: fromId, type: 'private' } },
      data,
    },
  } as never;
}

describe('truncateHtml', () => {
  it('leaves short strings alone', () => {
    expect(truncateHtml('<b>hi</b>', 1024)).toBe('<b>hi</b>');
  });

  it('never cuts inside entities or tags and closes opens', () => {
    const out = truncateHtml(`<b>${'a & b '.repeat(300)}</b>`, 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(/&[A-Za-z0-9#]*$/.test(out.replace(/<\/[a-z]+>$/g, ''))).toBe(false);
    expect(/<[^>]*$/.test(out)).toBe(false);
    expect(out.endsWith('</b>')).toBe(true);
  });

  it('property: output is bounded and has no dangling entity/tag', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1100, maxLength: 1500 }).map((s) => `<b>${s}&amp; tail</b>`),
        fc.integer({ min: 100, max: 1024 }),
        (s, max) => {
          const out = truncateHtml(s, max);
          expect(out.length).toBeLessThanOrEqual(max);
          const core = out.replace(/(<\/[a-z]+>)+$/g, '');
          expect(/&[A-Za-z0-9#]*$/.test(core)).toBe(false);
          expect(/<[^>]*$/.test(core)).toBe(false);
        }
      )
    );
  });
});

describe('QA fixes 5: message limits', () => {
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

  async function setup() {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const { setCapacityForDate } = await import('../src/services/calendar.js');
    await setCapacityForDate(tenantId, addDays(toIsoDate(now, 'Europe/Moscow'), 5), 10000, false);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    return { bot, port, tenantId };
  }

  function lastEdit(port: FakePort, u: number) {
    const cs = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === u);
    return cs[cs.length - 1]!;
  }

  it('bug 71: giant digest stays within limits with overflow note', async () => {
    const t = stringsFor('ru');
    const today = Array.from({ length: 55 }, (_, i) => ({
      id: `o${i}`,
      number: i + 1,
      status: 'new',
    }));
    const text = formatDigest(
      {
        date: '2026-10-20',
        todayCount: 55,
        today,
        tomorrowCount: 0,
        tomorrow: [],
        awaitingDecisionCount: 55,
        awaitingPaymentCount: 0,
      },
      t
    );
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('ещё 35');
  });

  it('bug 72: customer order list paginates', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    const [c] = await getDb()
      .insert(customers)
      .values({ id: 'c72', tenantId, telegramId: 42, firstSeenAt: now, lastSeenAt: now })
      .returning();
    for (let i = 0; i < 12; i++) {
      const r = await createOrder({
        tenantId,
        customerId: c!.id,
        cart: {
          lines: [
            { lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) },
          ],
        },
        checkout: {
          checkoutId: `chk-72-${i}`,
          dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
          fulfillment: 'pickup',
          contactName: 'T',
          contactPhone: '+7999',
          referenceFileIds: [],
        },
        now,
      });
      if (!r.ok) throw new Error('seed ' + i);
    }
    await bot.handleUpdate(cb('m1', 42, 10, 'my:list'));
    let kb = JSON.stringify(lastEdit(port, 42).args[3]);
    expect((kb.match(/my:view:/g) || []).length).toBe(10);
    expect(kb).toContain('my:more:1');
    await bot.handleUpdate(cb('m2', 42, 10, 'my:more:1'));
    kb = JSON.stringify(lastEdit(port, 42).args[3]);
    expect((kb.match(/my:view:/g) || []).length).toBe(12);
    expect(kb).not.toContain('my:more:');
  });
});
