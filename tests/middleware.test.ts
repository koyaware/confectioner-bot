import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, getDb, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';

describe('middleware', () => {
  const testDbPath = './test-middleware.db';

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
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';
    process.env.APP_SECRET = 'a'.repeat(32);
    initDatabase(testDbPath);
    migrate();
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
    delete process.env.SUPERADMIN_TELEGRAM_ID;
    delete process.env.APP_SECRET;
  });

  describe('session middleware', () => {
    it('creates new session for new user', async () => {
      const { sessionMiddleware } = await import('../src/bot/middleware/session.js');
      const db = getDb();
      const { sessions } = await import('../src/db/schema.js');

      // Mock context
      const ctx: any = {
        from: { id: 987654321 },
        tenant: { id: 'tenant-1' },
        session: { cart: { lines: [] } },
        next: () => Promise.resolve(),
      };

      await sessionMiddleware(ctx, ctx.next);

      // Verify session was saved
      const results = await db.select().from(sessions);
      expect(results.length).toBe(1);
    });
  });

  describe('role middleware', () => {
    it('identifies superadmin', async () => {
      const { roleMiddleware } = await import('../src/bot/middleware/role.js');

      const ctx: any = {
        from: { id: 123456789 },
        tenant: { ownerTelegramId: 111111111 },
        role: 'customer',
        next: () => Promise.resolve(),
      };

      await roleMiddleware(ctx, ctx.next);
      expect(ctx.role).toBe('superadmin');
    });

    it('identifies owner', async () => {
      const { roleMiddleware } = await import('../src/bot/middleware/role.js');

      const ctx: any = {
        from: { id: 111111111 },
        tenant: { ownerTelegramId: 111111111 },
        role: 'customer',
        next: () => Promise.resolve(),
      };

      await roleMiddleware(ctx, ctx.next);
      expect(ctx.role).toBe('owner');
    });

    it('identifies customer', async () => {
      const { roleMiddleware } = await import('../src/bot/middleware/role.js');

      const ctx: any = {
        from: { id: 999999999 },
        tenant: { ownerTelegramId: 111111111 },
        role: 'customer',
        next: () => Promise.resolve(),
      };

      await roleMiddleware(ctx, ctx.next);
      expect(ctx.role).toBe('customer');
    });
  });

  describe('antispam middleware', () => {
    it('allows messages under limit', async () => {
      const { antispamMiddleware } = await import('../src/bot/middleware/antispam.js');

      const ctx: any = {
        from: { id: 123456 },
        role: 'customer',
        session: { cart: { lines: [] } },
        next: () => Promise.resolve(),
      };

      await antispamMiddleware(ctx, ctx.next);
      expect(ctx.session.antispam?.count).toBe(1);
    });

    it('blocks messages over limit', async () => {
      const { antispamMiddleware } = await import('../src/bot/middleware/antispam.js');

      const ctx: any = {
        from: { id: 123456 },
        role: 'customer',
        session: {
          cart: { lines: [] },
          antispam: {
            windowStart: Math.floor(Date.now() / 1000),
            count: 25,
          },
        },
        next: () => Promise.resolve(),
      };

      let nextCalled = false;
      await antispamMiddleware(ctx, () => {
        nextCalled = true;
        return Promise.resolve();
      });

      expect(nextCalled).toBe(false);
    });

    it('skips antispam for owners', async () => {
      const { antispamMiddleware } = await import('../src/bot/middleware/antispam.js');

      const ctx: any = {
        from: { id: 123456 },
        role: 'owner',
        session: { cart: { lines: [] } },
        next: () => Promise.resolve(),
      };

      let nextCalled = false;
      await antispamMiddleware(ctx, () => {
        nextCalled = true;
        return Promise.resolve();
      });

      expect(nextCalled).toBe(true);
    });
  });
});
