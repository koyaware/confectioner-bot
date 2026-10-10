import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { sessions } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('cart', () => {
  const testDbPath = './test-cart.db';
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

  it('adds product with default options, cart persists in session, dec removes', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // open catalog, first category, first product
    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'cat:list'));
    let edits = port.getCallsForMethod('editMessageTextOrSend');
    const catBtn = JSON.stringify(edits[0]!.args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(2, 'c2', 42, 10, catBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const prdBtn = JSON.stringify(edits[1]!.args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(3, 'c3', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    // product card now has prd:add button
    expect(JSON.stringify(edits[2]!.args[3])).toContain('prd:add:');
    const addBtn = JSON.stringify(edits[2]!.args[3]).match(/prd:add:[A-Za-z0-9_-]+/)![0];

    await bot.handleUpdate(cb(4, 'c4', 42, 10, addBtn));
    expect(port.getCallsForMethod('answerCallback').map((c) => c.args[1])).toContain(
      '✅ Добавлено в корзину.'
    );

    // cart persisted
    const sessionRows = await getDb().select().from(sessions);
    const data = (
      typeof sessionRows[0]!.data === 'string'
        ? JSON.parse(sessionRows[0]!.data)
        : sessionRows[0]!.data
    ) as {
      cart: { lines: { productId: string; qty: number; optionIds: string[] }[] };
    };
    expect(data.cart.lines).toHaveLength(1);
    await bot.handleUpdate(cb(5, 'c5', 42, 10, 'cart:show'));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2] as string).toContain('Итого');

    // inc then dec back, then dec removes line
    const incBtn = JSON.stringify(edits[edits.length - 1]!.args[3]).match(
      /cart:inc:[A-Za-z0-9_-]+/
    );
    const decBtn = JSON.stringify(edits[edits.length - 1]!.args[3]).match(
      /cart:dec:[A-Za-z0-9_-]+/
    );
    await bot.handleUpdate(cb(6, 'c6', 42, 10, incBtn![0]));
    await bot.handleUpdate(cb(7, 'c7', 42, 10, decBtn![0]));
    await bot.handleUpdate(cb(8, 'c8', 42, 10, decBtn![0]));

    const sessionRows2 = await getDb().select().from(sessions);
    const data2 = (
      typeof sessionRows2[0]!.data === 'string'
        ? JSON.parse(sessionRows2[0]!.data)
        : sessionRows2[0]!.data
    ) as { cart: { lines: unknown[] } };
    expect(data2.cart.lines).toHaveLength(0);
  });

  it('chk:start switches state to checkout.date and persists draft', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
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
    edits = port.getCallsForMethod('editMessageTextOrSend');
    await bot.handleUpdate(cb(6, 'c6', 42, 10, 'chk:start'));

    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('checkout.date');
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { checkout?: { checkoutId: string } };
    expect(data.checkout?.checkoutId).toBeTruthy();
  });

  it('adding the same product twice merges into one line', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
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
    await bot.handleUpdate(cb(5, 'c5', 42, 10, addBtn));

    const rows = await getDb().select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { cart: { lines: { qty: number }[] } };
    expect(data.cart.lines).toHaveLength(1);
    expect(data.cart.lines[0]!.qty).toBe(2);
  });

  it('tapping a chosen option deselects it; add keeps empty selection', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
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
    const cardKb = JSON.stringify(edits[2]!.args[3]);
    const optBtn = cardKb.match(/prd:opt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/)![0];
    const addBtn = cardKb.match(/prd:add:[A-Za-z0-9_-]+/)![0];

    const checkedOptBtns = (): string[] => {
      const allEdits = port.getCallsForMethod('editMessageTextOrSend');
      const opts = allEdits[allEdits.length - 1]!.args[3] as {
        keyboard: { inline_keyboard: { text: string; callback_data?: string }[][] };
      };
      const kb = opts.keyboard.inline_keyboard;
      return kb
        .flat()
        .filter((b) => b.text.startsWith('✅ ') && b.callback_data?.startsWith('prd:opt:'))
        .map((b) => b.callback_data!);
    };
    // defaults are checked; tapping a checked option deselects it
    expect(checkedOptBtns().length).toBeGreaterThan(0);
    const first = checkedOptBtns()[0]!;
    await bot.handleUpdate(cb(4, 'c4', 42, 10, first));
    expect(checkedOptBtns()).not.toContain(first);
    // tapping again selects it back
    await bot.handleUpdate(cb(5, 'c5', 42, 10, first));
    expect(checkedOptBtns()).toContain(first);
    // deselect everything, then add: line stored with empty options
    let n = 6;
    for (const data of [...checkedOptBtns()]) {
      await bot.handleUpdate(cb(n, `c${n}`, 42, 10, data));
      n++;
    }
    expect(checkedOptBtns()).toHaveLength(0);
    await bot.handleUpdate(cb(n, `c${n}`, 42, 10, addBtn));

    const rows = await getDb().select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { cart: { lines: { optionIds: string[] }[] } };
    expect(data.cart.lines).toHaveLength(1);
    expect(data.cart.lines[0]!.optionIds).toEqual([]);
  });

  it('added configuration stays selected so qty stepper persists', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
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
    const cardKb = JSON.stringify(edits[2]!.args[3]);
    const addBtn = cardKb.match(/prd:add:[A-Za-z0-9_-]+/)![0];
    // deselect everything first so the added line has empty options
    const optBtn = cardKb.match(/prd:opt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(4, 'c4', 42, 10, optBtn));

    await bot.handleUpdate(cb(5, 'c5', 42, 10, addBtn));
    // reopening the card shows the stepper for the just-added line
    await bot.handleUpdate(cb(6, 'c6', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageTextOrSend');
    const kb = (
      edits[edits.length - 1]!.args[3] as {
        keyboard: { inline_keyboard: { text: string; callback_data?: string }[][] };
      }
    ).keyboard.inline_keyboard;
    const qtyBtns = kb
      .flat()
      .filter((b) => b.callback_data?.startsWith('prd:qty:'))
      .map((b) => b.text);
    expect(qtyBtns).toContain('−');
    expect(qtyBtns).toContain('+');
  });

  it('hidden product cannot be added via stale card', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const db = getDb();
    const { products } = await import('../src/db/schema.js');
    const { setProductActive } = await import('../src/services/catalog-editor.js');
    const all = await db.select().from(products).limit(1);
    const productId = all[0]!.id;
    await setProductActive(tenantId, productId, false);

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `prd:add:${productId}`));

    expect(
      port
        .getCallsForMethod('answerCallback')
        .some((c) => String(c.args[1]).includes('Товар не найден.'))
    ).toBe(true);
    const rows = await db.select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { cart: { lines: unknown[] } };
    expect(data.cart.lines).toHaveLength(0);
  });
});
