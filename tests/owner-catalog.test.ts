import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import {
  listProducts,
  listActiveCategories,
  listCategoriesAll,
  listProductsAll,
  getProductById,
} from '../src/services/catalog.js';
import * as editor from '../src/services/catalog-editor.js';
import {
  orderItems,
  products,
  tenants,
  categories,
  orders,
  customers,
  sessions,
} from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('owner catalog editor', () => {
  const testDbPath = './test-ownercat.db';
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

  it('product edits are visible in customer catalog immediately', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const catId = (await listCategoriesAll(tenantId))[0]!.id;
    const productId = (await listProductsAll(tenantId, catId))[0]!.id;

    await editor.updateProduct(tenantId, productId, { title: 'Новый медовик', priceMinor: 175000 });

    const prods = await listProducts(tenantId, catId);
    expect(prods[0]!.title).toBe('Новый медовик');
    expect(prods[0]!.priceMinor).toBe(175000);
  });

  it('hidden category and product are not shown to customer', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const cats = await listCategoriesAll(tenantId);
    const catId = cats[0]!.id;
    const prodId = (await listProductsAll(tenantId, catId))[0]!.id;

    await editor.setCategoryActive(tenantId, catId, false);
    await editor.setProductActive(tenantId, prodId, false);

    expect(await listActiveCategories(tenantId)).toHaveLength(cats.length - 1);
    expect(await listProducts(tenantId, catId)).toHaveLength(0);
  });

  it('hidden category stays in owner list and can be restored', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const catId = (await listCategoriesAll(tenantId))[0]!.id;

    await editor.setCategoryActive(tenantId, catId, false);
    expect(await listCategoriesAll(tenantId)).toHaveLength(4);

    await editor.setCategoryActive(tenantId, catId, true);
    expect(await listActiveCategories(tenantId)).toHaveLength(4);
  });

  it('deleting a product keeps old order items intact', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const catId = (await listCategoriesAll(tenantId))[0]!.id;
    const prod = (await listProductsAll(tenantId, catId))[0]!;

    const now = new Date();
    await getDb().insert(customers).values({
      id: 'cust1',
      tenantId,
      telegramId: 42,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    await getDb().insert(orders).values({
      id: 'order1',
      tenantId,
      number: 1,
      customerId: 'cust1',
      status: 'completed',
      dueDate: '2026-10-05',
      fulfillment: 'pickup',
      contactName: 'A',
      contactPhone: '+7000',
      itemsTotalMinor: prod.priceMinor,
      totalMinor: prod.priceMinor,
      prepaymentMinor: 0,
      capacityUnits: 1,
      idempotencyKey: 'k1',
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(orderItems).values({
      id: 'oi1',
      orderId: 'order1',
      productId: prod.id,
      titleSnapshot: prod.title,
      optionsSnapshot: [],
      unitPriceMinor: prod.priceMinor,
      qty: 1,
      capacityUnits: 1,
    });

    await editor.deleteProduct(tenantId, prod.id);

    const items = await getDb().select().from(orderItems);
    expect(items).toHaveLength(1);
    expect(items[0]!.titleSnapshot).toBe(prod.title);
    expect(await getProductById(tenantId, prod.id)).toBeNull();
  });

  it('cannot delete a category that still has products', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const catId = (await listCategoriesAll(tenantId))[0]!.id;

    const res = await editor.deleteCategory(tenantId, catId);
    expect(res).toEqual({ ok: false, error: 'HAS_PRODUCTS' });
  });

  it('flow: owner adds a category via edit_field state', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    // owner opens add-category prompt
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 555, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 1, chat: { id: 555, type: 'private' } },
        data: 'adm:cat:add',
      },
    } as never);

    const catAddPrompts = port.getCallsForMethod('editMessageTextOrSend');
    expect(catAddPrompts).toHaveLength(1);

    // owner types the title
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'Сладости',
        entities: [],
      },
    } as never);

    expect((await listCategoriesAll(tenantId)).map((c) => c.title)).toContain('Сладости');

    const saved = port.getCallsForMethod('sendMessage').map((c) => c.args[1]);
    expect(saved.some((t) => (t as string).includes('Сохранено'))).toBe(true);
  });

  it('non-owner adm callback gets rejection and no state change', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb1',
        from: { id: 42, is_bot: false, first_name: 'C' },
        message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' } },
        data: 'adm:cat:add',
      },
    } as never);

    const answers = port.getCallsForMethod('answerCallback');
    expect(answers).toHaveLength(1);
    expect((answers[0]!.args[1] as string) ?? '').toContain('владелец');

    // session must stay in idle with empty cart
    const cats = await listCategoriesAll(tenantId);
    expect(cats).toHaveLength(4);
  });

  it('photo field rejects text and re-prompts for a photo', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const db = getDb();
    const cats = await listCategoriesAll(tenantId);
    const productId = (await listProductsAll(tenantId, cats[0]!.id))[0]!.id;
    await db.insert(sessions).values({
      tenantId,
      telegramId: 555,
      state: 'owner.edit_field',
      data: {
        cart: { lines: [] },
        ownerDraft: { kind: 'prd_field', targetId: productId, extra: { field: 'photo' } },
      },
      updatedAt: new Date(),
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: 'not a photo',
        entities: [],
      },
    } as never);

    const sent = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sent).toContain('Пришлите фото товара.');
    expect(sent).not.toContain('Сохранено.');
  });

  it('empty category rename is rejected with guidance', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    const db = getDb();
    const cats = await listCategoriesAll(tenantId);
    await db.insert(sessions).values({
      tenantId,
      telegramId: 555,
      state: 'owner.edit_field',
      data: {
        cart: { lines: [] },
        ownerDraft: { kind: 'cat_rename', targetId: cats[0]!.id },
      },
      updatedAt: new Date(),
    });

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'O' },
        text: '   ',
        entities: [],
      },
    } as never);

    const sent = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sent).toContain('Название не подходит.');
    expect((await listCategoriesAll(tenantId))[0]!.title).toBe(cats[0]!.title);
  });
});
