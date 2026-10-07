import { run, RunnerHandle } from '@grammyjs/runner';
import { TenantBot } from './factory.js';
import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/crypto.js';

const APP_SECRET = process.env.APP_SECRET || '';

export class BotRunner {
  private bots: Map<string, TenantBot> = new Map();
  private handles: Map<string, RunnerHandle> = new Map();

  /**
   * Load all active tenants and start their bots
   */
  async startAll(): Promise<void> {
    const db = getDb();
    const allTenants = await db
      .select()
      .from(tenants)
      .where(eq(tenants.status, 'active'));

    for (const tenant of allTenants) {
      try {
        await this.startTenant(tenant.id, tenant.slug, tenant.botTokenEnc);
      } catch (error) {
        console.error(`Failed to start bot for tenant ${tenant.slug}:`, error);
      }
    }
  }

  /**
   * Start a specific tenant's bot
   */
  async startTenant(tenantId: string, tenantSlug: string, encryptedToken: string): Promise<void> {
    if (this.bots.has(tenantId)) {
      console.log(`Bot for tenant ${tenantSlug} already running`);
      return;
    }

    const botToken = decrypt(encryptedToken, APP_SECRET);
    const tenantBot = await import('./factory.js').then(m =>
      m.createTenantBot(botToken, tenantId, tenantSlug)
    );

    // Get bot info
    const botInfo = await tenantBot.bot.api.getMe();
    tenantBot.username = botInfo.username || '';

    // Store bot
    this.bots.set(tenantId, tenantBot);

    // Start bot with runner
    const handle = run(tenantBot.bot);
    this.handles.set(tenantId, handle);

    console.log(`Started bot @${tenantBot.username} for tenant ${tenantSlug}`);
  }

  /**
   * Stop a specific tenant's bot
   */
  async stopTenant(tenantId: string): Promise<void> {
    const handle = this.handles.get(tenantId);
    if (handle) {
      await handle.stop();
      this.handles.delete(tenantId);
    }

    this.bots.delete(tenantId);
    console.log(`Stopped bot for tenant ${tenantId}`);
  }

  /**
   * Stop all bots
   */
  async stopAll(): Promise<void> {
    for (const tenantId of this.bots.keys()) {
      await this.stopTenant(tenantId);
    }
  }

  /**
   * Get a bot by tenant ID
   */
  getBot(tenantId: string): TenantBot | undefined {
    return this.bots.get(tenantId);
  }

  /**
   * Get all running bots
   */
  getAllBots(): TenantBot[] {
    return Array.from(this.bots.values());
  }
}
