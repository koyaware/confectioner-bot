import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { sessions } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';

describe('checkout steps', () => {
  const testDbPath = './test-checkoutsteps.db';
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

  function msg(update_id: number, from: number, text: string) {
    return {
      update_id,
      message: {
        message_id: update_id,
        date: 1,
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'C' },
        text,
        entities: [],
      },
    } as never;
  }

  async function setupCartAndCheckout(
    port: FakePort,
    bot: ReturnType<typeof createTenantBot>['bot']
  ) {
    await bot.handleUpdate(cb(1, 'c1', 42, 10, 'cat:list'));
    let edits = port.getCallsForMethod('editMessageText');
    const catBtn = JSON.stringify(edits[0]!.args[3]).match(/cat:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(2, 'c2', 42, 10, catBtn));
    edits = port.getCallsForMethod('editMessageText');
    const prdBtn = JSON.stringify(edits[1]!.args[3]).match(/prd:open:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(3, 'c3', 42, 10, prdBtn));
    edits = port.getCallsForMethod('editMessageText');
    const addBtn = JSON.stringify(edits[2]!.args[3]).match(/prd:add:[A-Za-z0-9_-]+/)![0];
    await bot.handleUpdate(cb(4, 'c4', 42, 10, addBtn));
    await bot.handleUpdate(cb(5, 'c5', 42, 10, 'cart:show'));
    await bot.handleUpdate(cb(6, 'c6', 42, 10, 'chk:start'));
    const now = new Date();
    const freeDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);
    await bot.handleUpdate(cb(7, 'c7', 42, 10, `chk:date:${freeDate}`));
    return { freeDate };
  }

  it('full path to confirm with delivery, back navigation and cancel semantics', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    const { freeDate } = await setupCartAndCheckout(port, bot);

    // time
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    // fulfillment → delivery
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:delivery'));
    // address
    await bot.handleUpdate(msg(22, 42, 'ул. Пушкина, 1'));
    // contact
    await bot.handleUpdate(msg(23, 42, 'Иван, +79991234567'));
    // comment
    await bot.handleUpdate(msg(24, 42, 'С днём рождения!'));
    // photos skip
    await bot.handleUpdate(cb(25, 'c9', 42, 10, 'chk:skip'));

    let rows = await getDb().select().from(sessions);
    let data = JSON.parse(rows[0]!.data as string) as {
      checkout: {
        dueDate: string;
        fulfillment: string;
        address: string;
        contactName: string;
        contactPhone: string;
        comment: string;
      };
    };
    expect(data.checkout.dueDate).toBe(freeDate);
    expect(data.checkout.fulfillment).toBe('delivery');
    expect(data.checkout.address).toBe('ул. Пушкина, 1');
    expect(data.checkout.contactName).toBe('Иван');
    expect(data.checkout.contactPhone).toBe('+79991234567');
    expect(data.checkout.comment).toBe('С днём рождения!');

    // confirm screen shows summary and submit button with checkoutId
    const sent = port.getCallsForMethod('sendMessage');
    const confirmMsg = sent[sent.length - 1]!;
    expect(confirmMsg.args[1] as string).toContain('Ваш заказ');
    expect(JSON.stringify(confirmMsg.args[2])).toContain('chk:submit:');

    // back from confirm goes to photos
    await bot.handleUpdate(cb(26, 'c10', 42, 10, 'chk:back'));
    rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('checkout.photos');

    // back again to comment, then cancel clears everything
    await bot.handleUpdate(cb(27, 'c11', 42, 10, 'chk:back'));
    rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('checkout.comment');
    await bot.handleUpdate(cb(28, 'c12', 42, 10, 'chk:cancel'));
    rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('idle');
    data = JSON.parse(rows[0]!.data as string) as { checkout?: unknown };
    expect(data.checkout).toBeUndefined();
  });

  it('pickup path skips address step', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 12:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));

    // contact prompt next, not address
    const sent = port.getCallsForMethod('sendMessage');
    expect(sent[sent.length - 1]!.args[1] as string).toContain('Контакт');
  });

  it('chk:submit creates order, clears cart and informs owner', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);
    // claim ownership first so owner gets the card
    const dbAdmin = getDb();
    await dbAdmin
      .update((await import('../src/db/schema.js')).tenants)
      .set({ ownerTelegramId: 555 });

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));
    await bot.handleUpdate(msg(23, 42, 'Иван, +79991234567'));
    await bot.handleUpdate(msg(24, 42, 'Комментарий'));
    await bot.handleUpdate(cb(25, 'c9', 42, 10, 'chk:skip'));

    // now on confirm: call chk:submit with the checkoutId from session
    let rows = await getDb().select().from(sessions);
    const data = JSON.parse(rows[0]!.data as string) as {
      checkout: { checkoutId: string };
    };
    await bot.handleUpdate(cb(30, 'c13', 42, 10, `chk:submit:${data.checkout.checkoutId}`));

    rows = await getDb().select().from(sessions);
    const after = JSON.parse(rows[0]!.data as string) as {
      cart: { lines: unknown[] };
      checkout?: unknown;
    };
    expect(after.cart.lines).toHaveLength(0);
    expect(after.checkout).toBeUndefined();
    expect(rows[0]!.state).toBe('idle');

    const sent = port.getCallsForMethod('sendMessage');
    const ownerTexts = sent.map((c) => c.args[1] as string);
    expect(ownerTexts.some((t) => t.includes('Новый заказ'))).toBe(true);

    const edits = port.getCallsForMethod('editMessageText');
    const editTexts = edits.map((c) => c.args[2] as string);
    expect(editTexts.some((t) => t.includes('Заказ №'))).toBe(true);

    // second submit with same id = noop (stale draft)
    await bot.handleUpdate(cb(31, 'c14', 42, 10, `chk:submit:${data.checkout.checkoutId}`));
    const { orders } = await import('../src/db/schema.js');
    expect(await getDb().select().from(orders)).toHaveLength(1);
  });
});
