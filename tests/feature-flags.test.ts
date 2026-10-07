import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  getFeatureFlag,
  isFeatureEnabled,
  setFeatureFlag,
  deleteFeatureFlag,
  listFeatureFlags,
} from '../src/services/feature-flags.js';

describe('feature flags', () => {
  const testDbPath = './test-feature-flags.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

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

  function cb(update_id: number, from: number, data: string) {
    return {
      update_id,
      callback_query: {
        id: `c-${update_id}`,
        from: { id: from, is_bot: false, first_name: 'O' },
        message: { message_id: 10, date: 1, chat: { id: from, type: 'private' } },
        data,
      },
    } as never;
  }

  it('creates, toggles, and deletes flags per tenant', async () => {
    const { tenantId } = await seedDemo(appSecret, now);

    expect(await getFeatureFlag(tenantId, 'daily_digest')).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await isFeatureEnabled(tenantId, 'daily_digest', true)).toBe(true);

    const created = await setFeatureFlag(tenantId, 'daily_digest', false);
    expect(created).toEqual({ ok: true, value: { name: 'daily_digest', enabled: false } });
    expect(await isFeatureEnabled(tenantId, 'daily_digest', true)).toBe(false);

    const flags = await listFeatureFlags(tenantId);
    expect(flags.map((f) => f.name)).toEqual(['daily_digest']);

    const deleted = await deleteFeatureFlag(tenantId, 'daily_digest');
    expect(deleted.ok).toBe(true);
    expect(await isFeatureEnabled(tenantId, 'daily_digest', true)).toBe(true);
  });

  it('flags are isolated between tenants', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    const { createTenant } = await import('../src/services/tenants.js');
    const created = await createTenant({
      slug: 'other',
      shopName: 'Other',
      botToken: '456:y',
      botId: 888,
      botUsername: 'other_bot',
      appSecret,
      now,
    });
    if (!created.ok) throw new Error(created.error);

    await setFeatureFlag(tenantId, 'daily_digest', false);
    expect(await isFeatureEnabled(created.value.id, 'daily_digest', true)).toBe(true);
  });

  it('owner toggles a flag from settings and digest respects it', async () => {
    const { tenantId } = await seedDemo(appSecret, now);
    await getDb().update(tenants).set({ ownerTelegramId: 555 }).where(eq(tenants.id, tenantId));
    await setFeatureFlag(tenantId, 'daily_digest', true);
    const port = new FakePort();
    const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

    await bot.handleUpdate(cb(1, 555, 'adm:set:edit:features'));
    const edits = port.getCallsForMethod('editMessageText');
    expect(JSON.stringify(edits[0]!.args[3])).toContain('adm:set:feat:daily_digest');

    await bot.handleUpdate(cb(2, 555, 'adm:set:feat:daily_digest'));
    expect(await isFeatureEnabled(tenantId, 'daily_digest', true)).toBe(false);

    const { ensureDailyDigestJobs } = await import('../src/services/digest.js');
    const { jobs } = await import('../src/db/schema.js');
    await ensureDailyDigestJobs(now);
    const all = await getDb().select().from(jobs);
    expect(all.filter((j) => j.type === 'owner.daily_digest')).toHaveLength(0);
  });
});
