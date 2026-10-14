import { run, RunnerHandle } from '@grammyjs/runner';
import { TenantBot } from './factory.js';
import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/crypto.js';

export class BotRunner {
  private bots: Map<string, TenantBot> = new Map();
  private handles: Map<string, RunnerHandle> = new Map();
  private tokens: Map<string, { slug: string; encryptedToken: string }> = new Map();

  constructor(
    private readonly appSecret: string = process.env.APP_SECRET || '',
    private readonly restartDelayMs = 60_000
  ) {}

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
    this.tokens.set(tenantId, { slug: tenantSlug, encryptedToken });

    // Start bot with runner
    const handle = run(tenantBot.bot);
    this.handles.set(tenantId, handle);
    this.watchTask(tenantId);

    console.log(`Started bot @${tenantBot.username} for tenant ${tenantSlug}`);
  }

  /**
   * A rejected runner task (401/409, or retries exhausted after a long
   * outage) must never kill the whole process: isolate the tenant,
   * tell the superadmin, and restart polling when a human cannot help.
   */
  private watchTask(tenantId: string): void {
    const handle = this.handles.get(tenantId);
    if (!handle) return;
    const task = handle.task();
    if (!task) return;
    task.then(
      () => {
        // Stopped cleanly via stopTenant.
      },
      (error: unknown) => {
        void this.onTenantDown(tenantId, error);
      }
    );
  }

  /** @internal exposed for tests */
  async onTenantDown(tenantId: string, error: unknown): Promise<void> {
    const meta = this.tokens.get(tenantId);
    const slug = meta?.slug ?? tenantId;
    this.handles.delete(tenantId);
    this.bots.delete(tenantId);
    const code =
      typeof error === 'object' && error !== null && 'error_code' in error
        ? (error as { error_code?: unknown }).error_code
        : undefined;
    if (code === 401 || code === 409) {
      // Needs a human: revoked token or a second process with the same token.
      const why =
        code === 401
          ? 'токен отозван (401)'
          : 'конфликт: токен уже используется другим процессом (409)';
      console.error(`Bot for tenant ${slug} stopped: ${why}`);
      await this.notifySuperadmin(
        `🛑 Бот магазина ${slug} остановлен: ${why}. Проверьте токен и перезапустите процесс.`
      );
      return;
    }
    console.error(`Bot for tenant ${slug} crashed, restarting:`, error);
    await this.notifySuperadmin(`⚠️ Бот магазина ${slug} упал, перезапуск через минуту.`);
    await new Promise((resolve) => setTimeout(resolve, this.restartDelayMs));
    const fresh = this.tokens.get(tenantId);
    if (!fresh) return;
    try {
      await this.startTenant(tenantId, slug, fresh.encryptedToken);
    } catch (restartError) {
      console.error(`Failed to restart bot for tenant ${slug}:`, restartError);
      await this.notifySuperadmin(`Не удалось перезапустить бота ${slug}, нужен человек.`);
    }
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
    this.tokens.delete(tenantId);
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
