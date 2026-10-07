import { run, RunnerHandle } from '@grammyjs/runner';
import { TenantBot } from './factory.js';
import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/crypto.js';

export class BotRunner {
  private bots: Map<string, TenantBot> = new Map();
  private handles: Map<string, RunnerHandle> = new Map();

  constructor(private readonly appSecret: string = process.env.APP_SECRET || '') {}

  /**
   * Load all active tenants and start their bots
   */
  async startAll(): Promise<void> {
    const db = getDb();
    const allTenants = await db.select().from(tenants).where(eq(tenants.status, 'active'));

    for (const tenant of allTenants) {
      if (!tenant.botId) {
        console.log(`Skipping tenant ${tenant.slug}: placeholder bot token, nothing to run`);
        continue;
      }
      try {
        await this.startTenant(tenant.id, tenant.slug, tenant.botTokenEnc);
      } catch (error) {
        console.error(`Failed to start bot for tenant ${tenant.slug}:`, error);
        void this.notifySuperadmin(
          `Не удалось запустить бота для tenant ${tenant.slug}: ${error instanceof Error ? error.message : String(error)}`
        );
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

    const botToken = decrypt(encryptedToken, this.appSecret);
    const tenantBot = await import('./factory.js').then((m) =>
      m.createTenantBot(botToken, tenantId, tenantSlug, undefined, this)
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
   * Send a notification to superadmin via any running bot
   */
  async notifySuperadmin(text: string): Promise<void> {
    const superadminId = parseInt(process.env.SUPERADMIN_TELEGRAM_ID || '0', 10);
    if (!superadminId) {
      return;
    }

    const [firstBot] = this.getAllBots();
    if (!firstBot) {
      console.error(text);
      return;
    }

    try {
      await firstBot.port.sendMessage(superadminId, text.slice(0, 4000));
    } catch (error) {
      console.error('Failed to notify superadmin:', error);
    }
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
