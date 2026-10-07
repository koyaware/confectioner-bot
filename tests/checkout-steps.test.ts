import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { sessions, tenants, orders } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
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
    let data = (typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data) as {
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
    const confirmEdits = port.getCallsForMethod('editMessageTextOrSend');
    const confirmMsg = confirmEdits[confirmEdits.length - 1]!;
    expect(confirmMsg.args[2] as string).toContain('Ваш заказ');
    expect(JSON.stringify(confirmMsg.args[3])).toContain('chk:submit:');

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
    data = (typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data) as {
      checkout?: unknown;
    };
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
    const contactEdits = port.getCallsForMethod('editMessageTextOrSend');
    expect(contactEdits[contactEdits.length - 1]!.args[2] as string).toContain('Контакт');
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
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as {
      checkout: { checkoutId: string };
    };
    await bot.handleUpdate(cb(30, 'c13', 42, 10, `chk:submit:${data.checkout.checkoutId}`));

    rows = await getDb().select().from(sessions);
    const after = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as {
      cart: { lines: unknown[] };
      checkout?: unknown;
    };
    expect(after.cart.lines).toHaveLength(0);
    expect(after.checkout).toBeUndefined();
    expect(rows[0]!.state).toBe('idle');

    const sent = port.getCallsForMethod('sendMessage');
    const ownerMsg = sent[sent.length - 1]!;
    expect(ownerMsg.args[1] as string).toContain('Заказ №');
    expect(JSON.stringify(ownerMsg.args[2])).toContain('adm:ord:accept:');

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const editTexts = edits.map((c) => c.args[2] as string);
    expect(editTexts.some((t) => t.includes('Заказ №'))).toBe(true);

    // order-sent screen is not a dead end: it offers menu navigation
    const lastEdit = edits[edits.length - 1]!;
    const lastKb = JSON.stringify(lastEdit.args[3]);
    expect(lastKb).toContain('cat:list');
    expect(lastKb).toContain('nav:menu');

    // second submit with same id = noop (stale draft)
    await bot.handleUpdate(cb(31, 'c14', 42, 10, `chk:submit:${data.checkout.checkoutId}`));
    const { orders } = await import('../src/db/schema.js');
    expect(await getDb().select().from(orders)).toHaveLength(1);
  });

  it('contact prompt shows phone example for tenant currency', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ currency: 'UZS' }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));

    const currencyEdits = port.getCallsForMethod('editMessageTextOrSend');
    expect(currencyEdits[currencyEdits.length - 1]!.args[2] as string).toContain('+998901234567');
  });

  it('phone-only contact asks for a name instead of dead-ending', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));
    await bot.handleUpdate(msg(22, 42, '+79991234567'));

    const nameEdits = port.getCallsForMethod('editMessageTextOrSend');
    expect(nameEdits[nameEdits.length - 1]!.args[2] as string).toContain('Теперь напишите имя');

    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('checkout.contact');
    expect(tenantId).toBeTruthy();
  });

  it('photo album counts every photo and keeps one screen', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const { sessions } = await import('../src/db/schema.js');
    await db.insert(sessions).values({
      tenantId,
      telegramId: 42,
      state: 'checkout.photos',
      data: {
        cart: { lines: [] },
        checkout: { checkoutId: 'chk-album', referenceFileIds: [], screenMessageId: 10 },
      },
      updatedAt: now,
    });
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    const sendsBefore = port.getCallsForMethod('sendMessage').length;
    for (let i = 0; i < 3; i++) {
      await bot.handleUpdate({
        update_id: 100 + i,
        message: {
          message_id: 200 + i,
          date: 1,
          chat: { id: 42, type: 'private' },
          from: { id: 42, is_bot: false, first_name: 'C' },
          photo: [{ file_id: 'pic' + i, file_unique_id: 'u' + i, width: 10, height: 10 }],
          media_group_id: 'album1',
        },
      } as never);
    }

    const rows = await getDb().select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { checkout: { referenceFileIds: { fileId: string }[] } };
    expect(data.checkout.referenceFileIds.map((f) => f.fileId)).toEqual(['pic0', 'pic1', 'pic2']);

    // no new bot messages: user photos deleted, screen edited in place
    expect(port.getCallsForMethod('sendMessage')).toHaveLength(sendsBefore);
    expect(port.getCallsForMethod('deleteMessage')).toHaveLength(3);
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2] as string).toContain('3/5');
  });

  it('overlong comment is rejected with guidance', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));
    await bot.handleUpdate(msg(22, 42, 'Иван, +79991234567'));
    await bot.handleUpdate(msg(23, 42, 'x'.repeat(501)));

    const nameEdits = port.getCallsForMethod('editMessageTextOrSend');
    expect(nameEdits[nameEdits.length - 1]!.args[2] as string).toContain('максимум 500');
    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.state).toBe('checkout.comment');
    expect(tenantId).toBeTruthy();
  });

  it('concurrent album photos all count, none lost to races', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const { sessions } = await import('../src/db/schema.js');
    await db.insert(sessions).values({
      tenantId,
      telegramId: 42,
      state: 'checkout.photos',
      data: {
        cart: { lines: [] },
        checkout: { checkoutId: 'chk-race', referenceFileIds: [], screenMessageId: 10 },
      },
      updatedAt: now,
    });
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        bot.handleUpdate({
          update_id: 300 + i,
          message: {
            message_id: 400 + i,
            date: 1,
            chat: { id: 42, type: 'private' },
            from: { id: 42, is_bot: false, first_name: 'C' },
            photo: [{ file_id: 'race' + i, file_unique_id: 'ru' + i, width: 10, height: 10 }],
            media_group_id: 'album9',
          },
        } as never)
      )
    );

    const rows = await getDb().select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { checkout: { referenceFileIds: { fileId: string }[] } };
    expect(data.checkout.referenceFileIds.map((f) => f.fileId).sort()).toEqual(
      ['race0', 'race1', 'race2', 'race3', 'race4'].sort()
    );
  });

  it('address step shows delivery terms when set', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    await db.update(tenants).set({ deliveryText: 'Зона 1 — 300' }).where(eq(tenants.id, tenantId));
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:delivery'));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits[edits.length - 1]!.args[2] as string).toContain('Зона 1 — 300');
  });

  it('reference documents are dropped, only photos attach', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await setupCartAndCheckout(port, bot);
    await bot.handleUpdate(msg(20, 42, 'к 15:00'));
    await bot.handleUpdate(cb(21, 'c8', 42, 10, 'chk:ful:pickup'));
    await bot.handleUpdate(msg(22, 42, 'Иван, +79991234567'));
    await bot.handleUpdate(msg(23, 42, 'без комментария'));
    // photos step: document must not attach
    await bot.handleUpdate({
      update_id: 24,
      message: {
        message_id: 24,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C' },
        document: { file_id: 'd1', file_unique_id: 'du1', file_name: 'ref.pdf' },
      },
    } as never);

    const rows = await getDb().select().from(sessions);
    const data = (
      typeof rows[0]!.data === 'string' ? JSON.parse(rows[0]!.data) : rows[0]!.data
    ) as { checkout: { referenceFileIds: unknown[] } };
    expect(data.checkout.referenceFileIds).toHaveLength(0);
  });

  it('confirm without draft shows stale hint and no dead submit button', async () => {
    const now = new Date();
    const { tenantId } = await seedDemo(appSecret, now);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    const { freeDate } = await setupCartAndCheckout(port, bot);
    void freeDate;

    // Simulate a lost draft (expired/reset session) while the state lingers.
    const db = getDb();
    const sessRows = await db.select().from(sessions);
    const data = (
      typeof sessRows[0]!.data === 'string' ? JSON.parse(sessRows[0]!.data) : sessRows[0]!.data
    ) as Record<string, unknown>;
    delete data.checkout;
    await db
      .update(sessions)
      .set({ data, state: 'checkout.confirm', updatedAt: now })
      .where(eq(sessions.tenantId, tenantId));

    await bot.handleUpdate(cb(50, 'c50', 42, 10, 'chk:photos:done'));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    const last = edits[edits.length - 1]!;
    expect(last.args[2] as string).toContain('устарел');
    const kb = JSON.stringify(last.args[3]);
    expect(kb).not.toContain('chk:submit:');

    // Tapping a draft-less submit is a no-op: no order, no crash.
    const ordersBefore = await db.select().from(orders);
    await bot.handleUpdate(cb(51, 'c51', 42, 10, 'chk:submit:'));
    const ordersAfter = await db.select().from(orders);
    expect(ordersAfter).toHaveLength(ordersBefore.length);
  });
});
