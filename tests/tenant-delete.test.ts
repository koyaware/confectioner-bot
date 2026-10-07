import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, rmSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { categories, products, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { deleteTenantBySlug } from '../src/services/tenant-delete.js';

describe('tenant delete', () => {
  const testDbPath = './test-tenant-delete.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

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
    try {
      rmSync('./backups', { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns early for active tenant without force', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const result = await deleteTenantBySlug('demo', { force: false });
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe('ACTIVE_TENANT_REQUIRES_FORCE');

    const rows = await getDb().select().from(tenants);
    expect(rows[0]!.id).toBe(tenantId);
  });

  it('deletes related rows when forced', async () => {
    await seedDemo(appSecret, now);
    const result = await deleteTenantBySlug('demo', { force: true });
    expect(result.deleted).toBe(true);

    expect((await getDb().select().from(tenants)).length).toBe(0);
    expect((await getDb().select().from(categories)).length).toBe(0);
    expect((await getDb().select().from(products)).length).toBe(0);
  });
});
