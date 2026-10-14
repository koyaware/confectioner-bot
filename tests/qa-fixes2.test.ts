import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { validateSetting } from '../src/services/settings.js';
import { tenants, categories, products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

const testDbPath = './test-qafix2.db';
const appSecret = 's'.repeat(32);

let seq = 9000;
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
function txt(fromId: number, text: string, updateId?: number) {
  const id = updateId ?? seq++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'U' },
      text,
      entities: [],
    },
  } as never;
}
function cmd(fromId: number, text: string) {
  const id = seq++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'S' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
    },
  } as never;
}

describe('QA fixes 2: resume, photos guard, input caps', () => {
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
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    return { bot, port, tenantId, now };
  }

  function lastUserText(port: FakePort, userId: number): string {
    const edits = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === userId);
    return String(edits[edits.length - 1]!.args[2]);
  }

  async function fillCart(bot: any, port: FakePort, u: number) {
    const lastEdit = () => {
      const cs = port
        .getCallsForMethod('editMessageTextOrSend')
        .filter((c) => (c.args[0] as number) === u);
      return cs[cs.length - 1]!;
    };
    await bot.handleUpdate(cb(`q0-${u}`, u, 10, 'cat:list'));
    const cat = JSON.stringify(lastEdit().args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(`q1-${u}`, u, 10, cat));
    const prd = JSON.stringify(lastEdit().args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(`q2-${u}`, u, 10, prd));
    const add = JSON.stringify(lastEdit().args[3]).match(/prd:add:[A-Za-z0-9_-]+/);
    if (add) await bot.handleUpdate(cb(`q3-${u}`, u, 10, add[0]));
  }

  it('bug 58: failed resume keeps tenant paused with a clear error', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port, {
      stopTenant: async () => {},
      startTenant: async () => {
        throw new Error('getMe 401 Unauthorized');
      },
    } as never);
    await getDb().update(tenants).set({ status: 'paused' }).where(eq(tenants.id, tenantId));
    await bot.handleUpdate(cmd(1, '/resume demo'));
    const rows = await getDb().select().from(tenants).where(eq(tenants.id, tenantId));
    expect(rows[0]!.status).toBe('paused');
    const sends = port.getCallsForMethod('sendMessage').map((c) => String(c.args[1]));
    expect(sends.some((t) => t.includes('Не удалось запустить') && t.includes('паузе'))).toBe(true);
  });

  it('bug 59: photos:done outside photos state does nothing', async () => {
    const { bot, port, tenantId } = await setup();
    const u = 42;
    await fillCart(bot, port, u);
    await bot.handleUpdate(cb('s1', u, 10, 'chk:start'));
    const due = addDays(toIsoDate(new Date(), 'Europe/Moscow'), 5);
    await bot.handleUpdate(cb('s2', u, 10, `chk:date:${due}`));
    // Stray photos:done while in time state must not jump to confirm.
    await bot.handleUpdate(cb('s3', u, 10, 'chk:photos:done'));
    expect(lastUserText(port, u)).not.toContain('Ваш заказ');
    void tenantId;
  });

  it('bug 60: oversized time/address/name/phone are rejected', async () => {
    const { bot, port } = await setup();
    const u = 43;
    await fillCart(bot, port, u);
    await bot.handleUpdate(cb('t1', u, 10, 'chk:start'));
    const due = addDays(toIsoDate(new Date(), 'Europe/Moscow'), 5);
    await bot.handleUpdate(cb('t2', u, 10, `chk:date:${due}`));
    await bot.handleUpdate(txt(u, 'x'.repeat(101)));
    expect(lastUserText(port, u)).toContain('слишком длинный');
    await bot.handleUpdate(txt(u, 'к 15:00'));
    await bot.handleUpdate(cb('t3', u, 10, 'chk:ful:delivery'));
    await bot.handleUpdate(txt(u, 'y'.repeat(501)));
    expect(lastUserText(port, u)).toContain('слишком длинный');
    await bot.handleUpdate(txt(u, 'ул. Ленина 1'));
    await bot.handleUpdate(txt(u, `${'z'.repeat(101)}, +79991234567`));
    expect(lastUserText(port, u)).toContain('Не понял');
    await bot.handleUpdate(txt(u, '++, --- ---'));
    expect(lastUserText(port, u)).toContain('Не понял');
    await bot.handleUpdate(txt(u, 'Иван, +79991234567'));
    await bot.handleUpdate(txt(u, 'Без комментария'));
    await bot.handleUpdate(cb('t4', u, 10, 'chk:skip'));
    const edits = port
      .getCallsForMethod('editMessageTextOrSend')
      .filter((c) => (c.args[0] as number) === u);
    expect(JSON.stringify(edits[edits.length - 1]!.args[3])).toContain('chk:submit:');
  });

  it('bug 60: numeric caps hold', () => {
    expect(validateSetting('minLeadDays', '3651').ok).toBe(false);
    expect(validateSetting('maxAdvanceDays', '999999').ok).toBe(false);
    expect(validateSetting('paymentDeadlineHours', '99999').ok).toBe(false);
    expect(validateSetting('defaultDailyCapacity', '10001').ok).toBe(false);
    expect(validateSetting('defaultDailyCapacity', '1000').ok).toBe(true);
    expect(validateSetting('deliveryFeeMinor', '99999999999').ok).toBe(false);
    expect(validateSetting('deliveryFeeMinor', '500').ok).toBe(true);
  });

  it('bug 60: absurd product price rejected', async () => {
    const { bot, port, tenantId } = await setup();
    const plist = await getDb().select().from(products).where(eq(products.tenantId, tenantId));
    const p = plist[0]!;
    const before = p.priceMinor;
    await bot.handleUpdate(cb('p1', 555, 10, `adm:prd:field:${p.id}:price`));
    await bot.handleUpdate(txt(555, '100000000'));
    const after = await getDb().select().from(products).where(eq(products.id, p.id));
    expect(after[0]!.priceMinor).toBe(before);
    const sends = port.getCallsForMethod('sendMessage').map((c) => String(c.args[1]));
    void sends;
    expect(lastUserText(port, 555)).toContain('цену');
  });

  it('categories list sanity', async () => {
    const { tenantId } = await setup();
    const cats = await getDb().select().from(categories).where(eq(categories.tenantId, tenantId));
    expect(cats.length).toBeGreaterThan(0);
  });
});
