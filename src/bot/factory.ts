import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { BotContextWithSession } from './context.js';
import { GrammyPort } from '../telegram/grammy-port.js';
import { TelegramPort } from '../telegram/port.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { roleMiddleware } from './middleware/role.js';
import { sessionMiddleware } from './middleware/session.js';
import { antispamMiddleware } from './middleware/antispam.js';
import { funnelMiddleware } from './middleware/funnel.js';
import { errorMiddleware } from './middleware/errors.js';
import { registerStartHandler } from './customer/start.js';
import { registerCatalogHandlers } from './customer/catalog.js';
import { registerMenuHandler } from './owner/menu.js';
import { registerOwnerCatalogHandlers } from './owner/catalog-editor.js';
import { registerFaqHandlers } from './customer/faq.js';
import { registerOwnerFaqHandlers } from './owner/faq-editor.js';
import { registerEditFieldHandlers } from './owner/edit-field.js';
import { registerSettingsHandlers } from './owner/settings.js';

export interface TenantBot {
  tenantId: string;
  bot: Bot<BotContextWithSession>;
  port: TelegramPort;
  username: string;
}

/**
 * Creates a bot instance for a specific tenant
 */
export function createTenantBot(
  botToken: string,
  tenantId: string,
  tenantSlug: string,
  portOverride?: TelegramPort
): TenantBot {
  const bot = new Bot<BotContextWithSession>(botToken, {
    botInfo: {
      id: 0,
      is_bot: true,
      first_name: tenantSlug,
      username: tenantSlug,
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });

  // Enable auto-retry for rate limits
  bot.api.config.use(autoRetry());

  // Store tenant info in context
  bot.use(async (ctx, next) => {
    ctx.tenant = {
      id: tenantId,
      slug: tenantSlug,
      botUsername: '', // Will be filled when bot starts
      ownerTelegramId: null,
      shopName: '',
      currency: '₽',
      timezone: 'Europe/Moscow',
      status: 'active',
      acceptOrders: true,
      greetingText: null,
      aboutText: null,
      contactsText: null,
      deliveryText: null,
      paymentText: null,
      busyText: null,
      replySlaText: 'в течение нескольких часов',
      prepaymentPercent: 50,
      minLeadDays: 2,
      maxAdvanceDays: 60,
      defaultDailyCapacity: 5,
      paymentDeadlineHours: 24,
      deliveryFeeMinor: 0,
      digestHour: 9,
    };
    ctx.role = 'customer'; // Will be overridden by role middleware

    const port = portOverride ?? new GrammyPort(botToken);
    ctx.port = port;
    ctx.sessionState = 'idle';

    await next();
  });

  // Middleware chain
  bot.use(errorMiddleware);
  bot.use(tenantMiddleware);
  bot.use(roleMiddleware);
  bot.use(sessionMiddleware);
  bot.use(antispamMiddleware);
  bot.use(funnelMiddleware);

  const port = portOverride ?? new GrammyPort(botToken);

  registerStartHandler(bot);
  registerCatalogHandlers(bot);
  registerMenuHandler(bot);
  registerOwnerCatalogHandlers(bot);
  registerFaqHandlers(bot);
  registerOwnerFaqHandlers(bot);
  registerEditFieldHandlers(bot);
  registerSettingsHandlers(bot);

  return {
    tenantId,
    bot,
    port,
    username: '', // Will be filled when bot starts
  };
}
