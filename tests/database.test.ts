import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, getDb, getSqliteDb, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';

describe('database', () => {
  const testDbPath = './test-db.db';

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal');
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm');
    }
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal');
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm');
    }
  });

  describe('initialization', () => {
    it('initializes database in WAL mode', () => {
      initDatabase(testDbPath);
      const db = getSqliteDb();

      const result = db.pragma('journal_mode', { simple: true }) as string;
      expect(result).toBe('wal');
    });

    it('enables foreign keys', () => {
      initDatabase(testDbPath);
      const db = getSqliteDb();

      const result = db.pragma('foreign_keys', { simple: true }) as number;
      expect(result).toBe(1);
    });

    it('throws when initializing twice', () => {
      initDatabase(testDbPath);
      expect(() => initDatabase(testDbPath)).toThrow('Database already initialized');
    });

    it('throws when getting db before initialization', () => {
      expect(() => getDb()).toThrow('Database not initialized');
    });
  });

  describe('migrations', () => {
    it('applies migrations on empty database', () => {
      initDatabase(testDbPath);
      migrate();

      const db = getSqliteDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      // Check that all expected tables exist
      expect(tableNames).toContain('tenants');
      expect(tableNames).toContain('categories');
      expect(tableNames).toContain('products');
      expect(tableNames).toContain('orders');
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('__migrations');
    });

    it('does not reapply migrations', () => {
      initDatabase(testDbPath);
      migrate();

      const db = getSqliteDb();
      const countBefore = (
        db.prepare('SELECT COUNT(*) as count FROM __migrations').get() as { count: number }
      ).count;

      // Run migrations again
      migrate();

      const countAfter = (
        db.prepare('SELECT COUNT(*) as count FROM __migrations').get() as { count: number }
      ).count;

      expect(countAfter).toBe(countBefore);
    });

    it('creates migration tracking table', () => {
      initDatabase(testDbPath);
      migrate();

      const db = getSqliteDb();
      const migrations = db.prepare('SELECT name, applied_at FROM __migrations').all() as {
        name: string;
        applied_at: number;
      }[];

      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0]?.name).toMatch(/\.sql$/);
      expect(migrations[0]?.applied_at).toBeGreaterThan(0);
    });
  });

  describe('schema constraints', () => {
    beforeEach(() => {
      initDatabase(testDbPath);
      migrate();
    });

    it('enforces foreign key constraints', () => {
      const db = getSqliteDb();

      // Try to insert a category with non-existent tenant
      expect(() => {
        db.prepare(
          "INSERT INTO categories (id, tenant_id, title) VALUES ('cat1', 'nonexistent', 'Test')"
        ).run();
      }).toThrow();
    });

    it('enforces unique constraints', () => {
      const db = getSqliteDb();

      // Insert a tenant
      db.prepare(
        `INSERT INTO tenants (id, slug, bot_token_enc, bot_id, bot_username, shop_name, created_at)
         VALUES ('t1', 'shop1', 'encrypted', 123, 'testbot', 'Test Shop', ?)`
      ).run(Date.now());

      // Try to insert another tenant with same slug
      expect(() => {
        db.prepare(
          `INSERT INTO tenants (id, slug, bot_token_enc, bot_id, bot_username, shop_name, created_at)
           VALUES ('t2', 'shop1', 'encrypted', 456, 'testbot2', 'Test Shop 2', ?)`
        ).run(Date.now());
      }).toThrow();
    });
  });
});
