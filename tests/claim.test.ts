import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenant } from '../src/services/tenants.js';
import { claimTenant } from '../src/services/tenants.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { hash } from '../src/lib/crypto.js';

describe('owner claim', () => {
  const testDbPath = './test-claim.db';
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

  async function createShopAndCode() {
    const created = await createTenant({
      slug: 'cakes',
      shopName: 'Cakes',
      botToken: '123:x',
      botId: 777,
      botUsername: 'cakes_bot',
      appSecret,
      now: new Date(),
    });
    if (!created.ok) throw new Error(created.error);
    return created.value;
  }

  it('claims tenant via code and clears claim fields', async () => {
    const shop = await createShopAndCode();
    const result = await claimTenant(shop.claimCode, 555, new Date());

    expect(result.ok).toBe(true);
    const rows = await getDb().select().from(tenants).where(eq(tenants.id, shop.id));
    expect(rows[0]!.ownerTelegramId).toBe(555);
    expect(rows[0]!.claimCodeHash).toBeNull();
    expect(rows[0]!.claimExpiresAt).toBeNull();
  });

  it('rejects reuse of the same code', async () => {
    const shop = await createShopAndCode();
    await claimTenant(shop.claimCode, 555, new Date());
    const second = await claimTenant(shop.claimCode, 666, new Date());
    expect(second).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('rejects an expired code', async () => {
    const shop = await createShopAndCode();
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const result = await claimTenant(shop.claimCode, 555, later);
    expect(result).toEqual({ ok: false, error: 'EXPIRED' });
  });

  it('rejects unknown code', async () => {
    await createShopAndCode();
    const result = await claimTenant('nope', 555, new Date());
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('stores only the hash of the claim code', async () => {
    const shop = await createShopAndCode();
    const rows = await getDb().select().from(tenants);
    expect(rows[0]!.claimCodeHash).toBe(hash(`claim_${shop.claimCode}`));
    expect(rows[0]!.claimCodeHash).not.toContain(shop.claimCode);
  });

  it('flow: /start with claim_ sets owner and /menu shows owner menu', async () => {
    const shop = await createShopAndCode();
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', shop.id, 'cakes', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'Owner' },
        text: `/start claim_${shop.claimCode}`,
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);

    const tenantRows = await getDb().select().from(tenants);
    expect(tenantRows[0]!.ownerTelegramId).toBe(555);

    const sentTexts = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sentTexts.some((t) => t.includes('владелец'))).toBe(true);
    expect(sentTexts.some((t) => t.includes('Меню владельца'))).toBe(true);

    const { customers, funnelEvents } = await import('../src/db/schema.js');
    expect(await getDb().select().from(customers)).toHaveLength(0);
    expect(await getDb().select().from(funnelEvents)).toHaveLength(0);

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'Owner' },
        text: '/menu',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    } as never);

    const sentTexts2 = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sentTexts2.some((t) => t.includes('Меню владельца'))).toBe(true);
  });

  it('non-owner gets customer menu from /menu', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'C' },
        text: '/menu',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    } as never);

    const sentTexts = port.getCallsForMethod('sendMessage').map((c) => c.args[1] as string);
    expect(sentTexts.some((t) => t.includes('Главное меню'))).toBe(true);
    expect(sentTexts.some((t) => t.includes('Меню владельца'))).toBe(false);
  });
});
