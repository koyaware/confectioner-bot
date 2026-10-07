import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { tenants, categories, products, productOptions, faqItems } from '../src/db/schema.js';
import { seedDemo } from '../src/db/seed.js';

describe('seedDemo', () => {
  const testDbPath = './test-seed.db';
  const appSecret = 's'.repeat(32);

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

  it('creates demo shop with categories, products, options and FAQ', async () => {
    const result = await seedDemo(appSecret, new Date());
    expect(result.created).toBe(true);

    const db = getDb();
    expect(await db.select().from(tenants)).toHaveLength(1);
    expect((await db.select().from(categories)).length).toBe(6);
    expect((await db.select().from(products)).length).toBe(22);
    expect((await db.select().from(productOptions)).length).toBe(35);
    expect((await db.select().from(faqItems)).length).toBe(9);
  });

  it('is idempotent', async () => {
    await seedDemo(appSecret, new Date());
    const second = await seedDemo(appSecret, new Date());

    expect(second.created).toBe(false);
    const db = getDb();
    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(products)).toHaveLength(22);
  });
});
