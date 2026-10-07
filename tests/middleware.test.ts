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

  describe('error middleware', () => {
    it('notifies the user through the port, not ctx.reply', async () => {
      const { errorMiddleware } = await import('../src/bot/middleware/errors.js');
      const { TelegramError } = await import('../src/telegram/port.js');

      const sent: unknown[][] = [];
      let replied = false;
      const ctx: any = {
        chat: { id: 42 },
        port: { sendMessage: async (...args: unknown[]) => void sent.push(args) },
        reply: async () => {
          replied = true;
        },
      };

      await errorMiddleware(ctx, async () => {
        throw new TelegramError('RATE_LIMIT', 'slow down');
      });

      expect(sent).toHaveLength(2);
      expect(sent[0]![0]).toBe(123456789);
      expect(sent[1]![0]).toBe(42);
      expect(replied).toBe(false);
    });
  });

  describe('tenant middleware', () => {
    it('blocks paused tenants for customers but allows superadmin', async () => {
      const { tenantMiddleware } = await import('../src/bot/middleware/tenant.js');
      const { seedDemo } = await import('../src/db/seed.js');
      const { tenants } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const { getDb } = await import('../src/db/client.js');

      const { tenantId } = await seedDemo('a'.repeat(32), new Date());
      await getDb().update(tenants).set({ status: 'paused' }).where(eq(tenants.id, tenantId));

      const sent: unknown[][] = [];
      const customerCtx: any = {
        from: { id: 42 },
        chat: { id: 42 },
        tenant: { id: tenantId },
        port: { sendMessage: async (...args: unknown[]) => void sent.push(args) },
      };
      let nextCalled = false;
      await tenantMiddleware(customerCtx, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(sent).toHaveLength(1);

      const adminCtx: any = {
        from: { id: 123456789 },
        chat: { id: 123456789 },
        tenant: { id: tenantId },
        port: { sendMessage: async (...args: unknown[]) => void sent.push(args) },
      };
      let adminNextCalled = false;
      await tenantMiddleware(adminCtx, async () => {
        adminNextCalled = true;
      });
      expect(adminNextCalled).toBe(true);
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

    it('answers dropped callbacks so the spinner does not hang', async () => {
      const { antispamMiddleware } = await import('../src/bot/middleware/antispam.js');

      const answered: string[] = [];
      const ctx: any = {
        from: { id: 123456 },
        role: 'customer',
        callbackQuery: { id: 'cb1' },
        port: { answerCallback: async (id: string) => void answered.push(id) },
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
      expect(answered).toEqual(['cb1']);
    });

    it('enforces 20/min then silence for 5 minutes', async () => {
      const { evaluateAntispam } = await import('../src/bot/middleware/antispam.js');

      let state = evaluateAntispam(undefined, 1000).next;
      for (let i = 1; i < 20; i++) {
        const decision = evaluateAntispam(state, 1000 + i);
        expect(decision.allowed).toBe(true);
        state = decision.next;
      }
      const blocked = evaluateAntispam(state, 1020);
      expect(blocked.allowed).toBe(false);
      expect(evaluateAntispam(blocked.next, 1020 + 299).allowed).toBe(false);
      expect(evaluateAntispam(blocked.next, 1020 + 300).allowed).toBe(true);
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
