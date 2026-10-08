import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { products } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

// Bug 24 regression: the product card must show the product photo when the
// owner uploaded one, and keep a single screen while toggling options.
describe('product photo on card', () => {
  const testDbPath = './test-productphoto.db';
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

  it('opens the card as a photo and keeps one screen on option toggle', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const db = getDb();
    const all = await db.select().from(products).limit(1);
    const product = all[0]!;
    await db
      .update(products)
      .set({ photoFileId: 'photo-file-1' })
      .where(eq(products.id, product.id));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `prd:open:${product.id}`));

    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    expect(photos[0]!.args[1]).toBe('photo-file-1');
    const caption = photos[0]!.args[2] as string;
    expect(caption).toContain(product.title);
    const deleted = port.getCallsForMethod('deleteMessage');
    expect(deleted.some((c) => c.args[1] === 10)).toBe(true);

    // Toggle an option: old photo screen is replaced, still a single screen.
    const { productOptions } = await import('../src/db/schema.js');
    const optionRows = await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, product.id));
    const other = optionRows.find((o) => o.groupTitle === optionRows[0]!.groupTitle);
    expect(other).toBeTruthy();
    // Toggle arrives from the photo screen: the callback message carries photo.
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'c2',
        from: { id: 42, is_bot: false, first_name: 'C' },
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private' },
          photo: [{ file_id: 'photo-file-1', file_unique_id: 'u1', width: 10, height: 10 }],
        },
        data: `prd:opt:${product.id}:${other!.id}`,
      },
    } as never);
    // Photo screen swaps media in place: one edit call, no delete+resend.
    const mediaEdits = port.getCallsForMethod('editMessageMedia');
    expect(mediaEdits).toHaveLength(1);
    expect(mediaEdits[0]!.args[2]).toBe('photo-file-1');
    expect(String(mediaEdits[0]!.args[3])).toContain(product.title);
    const photos2 = port.getCallsForMethod('sendPhoto');
    expect(photos2).toHaveLength(1);
    const deleted2 = port.getCallsForMethod('deleteMessage');
    expect(deleted2.some((c) => c.args[1] === 1)).toBe(false);
  });

  it('long description truncates caption instead of failing', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const db = getDb();
    const all = await db.select().from(products).limit(1);
    await db
      .update(products)
      .set({ photoFileId: 'photo-file-1', description: 'D'.repeat(2000) })
      .where(eq(products.id, all[0]!.id));

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `prd:open:${all[0]!.id}`));

    const photos = port.getCallsForMethod('sendPhoto');
    expect(photos).toHaveLength(1);
    expect(String(photos[0]!.args[2]).length).toBeLessThanOrEqual(1024);
    const sends = port.getCallsForMethod('sendMessage');
    expect(
      sends.some((c) => c.args[0] === 42 && String(c.args[1]).includes('Произошла ошибка'))
    ).toBe(false);
  });

  it('broken photo falls back to the text card without user error', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const db = getDb();
    const all = await db.select().from(products).limit(1);
    await db
      .update(products)
      .set({ photoFileId: 'photo-file-1' })
      .where(eq(products.id, all[0]!.id));

    const port = new FakePort();
    port.addErrorRule('sendPhoto', 'OTHER', 'bad file_id', 50);
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `prd:open:${all[0]!.id}`));

    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits.length).toBeGreaterThan(0);
    expect(String(edits[edits.length - 1]!.args[2])).toContain(all[0]!.title);
    const sends = port.getCallsForMethod('sendMessage');
    expect(sends.some((c) => String(c.args[1]).includes('Произошла ошибка'))).toBe(false);
  });

  it('card without photo stays a text screen', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const db = getDb();
    const all = await db.select().from(products).limit(1);
    const product = all[0]!;

    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 'c1', 42, 10, `prd:open:${product.id}`));

    expect(port.getCallsForMethod('sendPhoto')).toHaveLength(0);
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits.length).toBeGreaterThan(0);
  });
});
