import { Bot } from 'grammy';
import { BotContextWithSession } from './context.js';
import { getDb } from '../db/client.js';
import { tenants, jobs } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import type { BotRunner } from './runner.js';

export function registerSuperadminCommands(
  bot: Bot<BotContextWithSession>,
  runner?: BotRunner
): void {
  bot.command('status', async (ctx) => {
    if (ctx.role !== 'superadmin') {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.forbidden);
      return;
    }

    const db = getDb();
    const activeTenants = await db.select().from(tenants).where(eq(tenants.status, 'active'));
    const pendingJobs = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(eq(jobs.status, 'pending'));
    const failedJobs = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(eq(jobs.status, 'failed'));

    const uptimeSeconds = Math.floor(process.uptime());
    const dbPath = process.env.DATABASE_PATH || './data.db';
    let dbSize = 'unknown';
    try {
      const { statSync } = await import('fs');
      dbSize = `${Math.round((statSync(dbPath).size / 1024 / 1024) * 100) / 100} MB`;
    } catch {
      // ignore
    }

    const runningBots = runner ? runner.getAllBots().length : activeTenants.length;
    const lines = [
      '<b>Статус</b>',
      `Аптайм: ${uptimeSeconds} с`,
      `Запущено ботов: ${runningBots}`,
      `Очередь джобов: ${pendingJobs[0]?.count ?? 0}`,
      `Ошибок джобов (failed): ${failedJobs[0]?.count ?? 0}`,
      `Размер БД: ${dbSize}`,
    ];
    await ctx.port.sendMessage(ctx.chat.id, lines.join('\n'), { parseMode: 'HTML' });
  });

  bot.command('tenants', async (ctx) => {
    if (ctx.role !== 'superadmin') {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.forbidden);
      return;
    }

    const db = getDb();
    const rows = await db.select().from(tenants).limit(50);
    const lines = rows.map((t) => `• ${t.slug} — ${t.status} — ${t.shopName}`);
    await ctx.port.sendMessage(ctx.chat.id, lines.join('\n') || ctx.t.admin.noTenants);
  });

  bot.command('pause', async (ctx) => {
    if (ctx.role !== 'superadmin') {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.forbidden);
      return;
    }

    const slug = ctx.message?.text?.split(' ')[1];
    if (!slug) {
      await ctx.port.sendMessage(ctx.chat.id, 'Использование: /pause <slug>');
      return;
    }

    const db = getDb();
    const row = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    const tenant = row[0];
    if (!tenant) {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.tenantNotFound);
      return;
    }

    await db.update(tenants).set({ status: 'paused' }).where(eq(tenants.id, tenant.id));
    await ctx.port.sendMessage(ctx.chat.id, `Магазин «${tenant.shopName}» приостановлен.`);
    if (runner) {
      await runner.stopTenant(tenant.id);
    }
  });

  bot.command('resume', async (ctx) => {
    if (ctx.role !== 'superadmin') {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.forbidden);
      return;
    }

    const slug = ctx.message?.text?.split(' ')[1];
    if (!slug) {
      await ctx.port.sendMessage(ctx.chat.id, 'Использование: /resume <slug>');
      return;
    }

    const db = getDb();
    const row = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    const tenant = row[0];
    if (!tenant) {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.admin.tenantNotFound);
      return;
    }

    await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenant.id));
    if (runner) {
      await runner.startTenant(tenant.id, tenant.slug, tenant.botTokenEnc);
    }
    await ctx.port.sendMessage(ctx.chat.id, `Магазин «${tenant.shopName}» возобновлён.`);
  });
}
