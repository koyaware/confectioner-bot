import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

const ANTISPAM_WINDOW_SECONDS = 60;
const ANTISPAM_MAX_MESSAGES = 20;
const ANTISPAM_BLOCK_SECONDS = 300; // 5 minutes

/**
 * Antispam middleware - limits message rate per user
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

  if (antispam) {
    // Check if in block period
    if (antispam.windowStart + ANTISPAM_BLOCK_SECONDS > now) {
      // Still in block period, ignore message
      return;
    }

    // Check if within window
    if (antispam.windowStart + ANTISPAM_WINDOW_SECONDS > now) {
      // Within window, increment counter
      antispam.count++;

      if (antispam.count > ANTISPAM_MAX_MESSAGES) {
        // Exceeded limit, start block period
        ctx.session.antispam = {
          windowStart: now,
          count: antispam.count,
        };
        return;
      }
    } else {
      // Outside window, reset counter
      ctx.session.antispam = {
        windowStart: now,
        count: 1,
      };
    }
  } else {
    // No antispam data, create new
    ctx.session.antispam = {
      windowStart: now,
      count: 1,
    };
  }

  await next();
};
