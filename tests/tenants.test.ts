import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { tenants } from '../src/db/schema.js';
import { createTenant } from '../src/services/tenants.js';
import { decrypt, hash } from '../src/lib/crypto.js';

describe('createTenant', () => {
  const testDbPath = './test-tenants.db';
  const appSecret = 's'.repeat(32);
  const fixedNow = new Date('2026-10-01T12:00:00Z');

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    process.env.APP_SECRET = appSecret;
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
  });

  const baseInput = {
    slug: 'cakeshop',
    shopName: 'Cake Shop',
    botToken: '123:abc',
    botId: 111,
    botUsername: 'cakeshop_bot',
    appSecret,
    now: fixedNow,
  };

  it('creates tenant with encrypted token and hashed claim code', async () => {
    const result = await createTenant(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await getDb().select().from(tenants);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.slug).toBe('cakeshop');
    expect(row.ownerTelegramId).toBeNull();
    expect(decrypt(row.botTokenEnc, appSecret)).toBe('123:abc');
    expect(row.claimCodeHash).toBe(hash(`claim_${result.value.claimCode}`));
    expect(row.claimCodeHash).not.toContain(result.value.claimCode);
    expect(result.value.claimLink).toBe(`https://t.me/cakeshop_bot?start=claim_${result.value.claimCode}`);
  });

  it('sets claim expiry to 24 hours from creation', async () => {
    const result = await createTenant(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimExpiresAt.getTime() - fixedNow.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects duplicate slug', async () => {
    await createTenant(baseInput);
    const second = await createTenant({ ...baseInput, botId: 222, slug: 'cakeshop' });
    expect(second).toEqual({ ok: false, error: 'SLUG_TAKEN' });
  });

  it('rejects duplicate bot id', async () => {
    await createTenant(baseInput);
    const second = await createTenant({ ...baseInput, slug: 'other', botId: 111 });
    expect(second).toEqual({ ok: false, error: 'BOT_ID_TAKEN' });
  });

  it('claim code matches source code format', async () => {
    const result = await createTenant(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimCode).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
