import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { parseAdminTelegramIds } from '../../config.js';

export const roleMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  if (!ctx.from) {
    return next();
  }

  const userId = ctx.from.id;
  const superadminId = parseInt(process.env.SUPERADMIN_TELEGRAM_ID || '0', 10);
  const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS)[ctx.tenant.slug] ?? [];

  // Check if superadmin
  if (userId === superadminId) {
    ctx.role = 'superadmin';
    return next();
  }

  // Additional owner-level admins for ops edits
  if (adminIds.includes(userId)) {
    ctx.role = 'owner';
    return next();
  }

  // Check if owner
  if (ctx.tenant.ownerTelegramId === userId) {
    ctx.role = 'owner';
    return next();
  }

  // Otherwise, customer
  ctx.role = 'customer';

  await next();
};
