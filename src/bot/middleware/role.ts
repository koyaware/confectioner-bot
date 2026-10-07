import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

const SUPERADMIN_TELEGRAM_ID = parseInt(process.env.SUPERADMIN_TELEGRAM_ID || '0', 10);

/**
 * Role middleware - determines user role
 */
export const roleMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  if (!ctx.from) {
    return next();
  }

  const userId = ctx.from.id;

  // Check if superadmin
  if (userId === SUPERADMIN_TELEGRAM_ID) {
    ctx.role = 'superadmin';
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
