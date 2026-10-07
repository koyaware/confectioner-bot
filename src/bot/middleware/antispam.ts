import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

const ANTISPAM_WINDOW_SECONDS = 60;
const ANTISPAM_MAX_MESSAGES = 20;
const ANTISPAM_BLOCK_SECONDS = 300; // 5 minutes

/**
 * Antispam middleware - limits message rate per user.
 * Not blocked: count messages in a 60s window. count > 20 marks a 300s block
 * (windowStart is moved to the block start). While blocked, windowStart + 300
 * is in the future, so messages are ignored. After 300s the state resets.
 */
export const antispamMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  if (!ctx.from) {
    return next();
  }

  // Skip antispam for owners and superadmins
  if (ctx.role === 'owner' || ctx.role === 'superadmin') {
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  const antispam = ctx.session.antispam;

  if (!antispam) {
    ctx.session.antispam = { windowStart: now, count: 1 };
    return next();
  }

  // Blocked state: count exceeded the limit
  if (antispam.count > ANTISPAM_MAX_MESSAGES) {
    if (now < antispam.windowStart + ANTISPAM_BLOCK_SECONDS) {
      return;
    }
    ctx.session.antispam = { windowStart: now, count: 1 };
    return next();
  }

  if (now < antispam.windowStart + ANTISPAM_WINDOW_SECONDS) {
    antispam.count++;
    if (antispam.count > ANTISPAM_MAX_MESSAGES) {
      ctx.session.antispam = { windowStart: now, count: antispam.count };
      return;
    }
    return next();
  }

  ctx.session.antispam = { windowStart: now, count: 1 };
  return next();
};
