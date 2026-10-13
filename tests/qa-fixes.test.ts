import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { createOrder } from '../src/services/orders.js';
import { isValidIsoDate, isValidIsoMonth } from '../src/lib/time.js';
import { tenants, customers, categories, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { firstActiveOptionIds } from './helpers.js';

const testDbPath = './test-qafix.db';
const appSecret = 's'.repeat(32);
const now = new Date('2026-10-02T12:00:00Z');

function cb(updateId: number, cbId: string, fromId: number, msgId: number, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: cbId,
      from: { id: fromId, is_bot: false, first_name: 'O' },
      message: { message_id: msgId, date: 1, chat: { id: fromId, type: 'private' } },
      data,
    },
  } as never;
}

describe('strict calendar validators', () => {
  it('accepts real dates, rejects impossible ones', () => {
    expect(isValidIsoDate('2026-10-13')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('9999-99-99')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-10-32')).toBe(false);
    expect(isValidIsoDate('2026-10-00')).toBe(false);
    expect(isValidIsoDate('2026-4-31')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
    expect(isValidIsoMonth('2026-10')).toBe(true);
    expect(isValidIsoMonth('2026-13')).toBe(false);
    expect(isValidIsoMonth('2026-1')).toBe(false);
    expect(isValidIsoMonth('2026-10-01')).toBe(false);
  });

  it('property: every real calendar day of 2023-2027 is valid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2023, max: 2027 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          expect(isValidIsoDate(s)).toBe(true);
        }
      )
    );
  });

  it('property: out-of-range month/day never valid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2030 }),
        fc.integer({ min: 13, max: 99 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          expect(
            isValidIsoDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
          ).toBe(false);
        }
      )
    );
  });
});

describe('QA fixes: dates, cancel ownership, delete UX', () => {
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
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    return { bot, port, tenantId };
  }

  function errorPings(port: FakePort) {
    return port
      .getCallsForMethod('sendMessage')
      .filter((c) => String(c.args[1]).includes('Ошибка бота'));
  }

  it('bug 51: impossible calendar dates are ignored, superadmin stays silent', async () => {
    const { bot, port, tenantId } = await setup();
    const bad = [
      'chk:date:9999-99-99',
      'chk:date:2026-13-45',
      'chk:closed:9999-99-99',
      'chk:datepage:9999-99',
      'adm:cal:day:9999-99-99',
      'adm:cal:toggle:2026-13-40',
      'adm:cal:setcap:9999-99-99',
      'adm:cal:page:9999-99',
    ];
    for (const [i, data] of bad.entries()) {
      const uid = data.startsWith('adm:') ? 555 : 42;
      await bot.handleUpdate(cb(100 + i, `cb${i}`, uid, 10, data));
    }
    expect(errorPings(port)).toHaveLength(0);
    void tenantId;
  });

  it('bug 52: cancel reason picker refuses foreign orders', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products);
    const p = plist[0]!;
    const [c] = await getDb()
      .insert(customers)
      .values({ id: 'c52', tenantId, telegramId: 42, firstSeenAt: now, lastSeenAt: now })
      .returning();
    const res = await createOrder({
      tenantId,
      customerId: c!.id,
      cart: {
        lines: [
          { lineId: 'l1', productId: p.id, qty: 1, optionIds: await firstActiveOptionIds(p.id) },
        ],
      },
      checkout: {
        checkoutId: 'chk-52',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'T',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    if (!res.ok) throw new Error('seed failed');
    await bot.handleUpdate(cb(1, 'c1', 777, 10, `my:cancel:${res.value.id}`));
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(String(edits[edits.length - 1]!.args[2])).toContain('не найден');
  });

  it('bug 53: deleting a non-empty category explains why', async () => {
    const { bot, port, tenantId } = await setup();
    const cats = await getDb().select().from(categories).where(eq(categories.tenantId, tenantId));
    const target = cats[0]!;
    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:cat:del:${target.id}`));
    const answers = port.getCallsForMethod('answerCallback');
    const texts = answers.map((c) => String(c.args[1] ?? ''));
    expect(texts.some((t) => t.includes('есть товары'))).toBe(true);
    // category still there
    const still = await getDb().select().from(categories).where(eq(categories.id, target.id));
    expect(still).toHaveLength(1);
  });

  it('bug 54: product delete needs confirmation', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const target = plist[0]!;
    await bot.handleUpdate(cb(1, 'c1', 555, 10, `adm:prd:del:${target.id}`));
    // single tap must NOT delete
    const afterTap = await getDb().select().from(products).where(eq(products.id, target.id));
    expect(afterTap).toHaveLength(1);
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(String(edits[edits.length - 1]!.args[2])).toContain('Удалить товар');
    // confirm deletes
    await bot.handleUpdate(cb(2, 'c2', 555, 10, `adm:prd:delcf:${target.id}`));
    const afterConfirm = await getDb().select().from(products).where(eq(products.id, target.id));
    expect(afterConfirm).toHaveLength(0);
  });
});
