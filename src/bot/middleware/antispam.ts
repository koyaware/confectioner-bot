import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

const ANTISPAM_WINDOW_SECONDS = 60;
const ANTISPAM_MAX_MESSAGES = 20;
const ANTISPAM_BLOCK_SECONDS = 300; // 5 minutes

export interface AntispamState {
  windowStart: number;
  count: number;
}

/**
 * Pure rate-limit decision, extracted so the 20/min + 5-min block rule
 * is unit-testable without mocking Date.now().
 */
export function evaluateAntispam(
  current: AntispamState | undefined,
  now: number
): { allowed: boolean; next: AntispamState } {
  if (!current) {
    return { allowed: true, next: { windowStart: now, count: 1 } };
  }

  if (current.count > ANTISPAM_MAX_MESSAGES) {
    if (now < current.windowStart + ANTISPAM_BLOCK_SECONDS) {
      return { allowed: false, next: current };
    }
    return { allowed: true, next: { windowStart: now, count: 1 } };
  }

  if (now < current.windowStart + ANTISPAM_WINDOW_SECONDS) {
    const count = current.count + 1;
    if (count > ANTISPAM_MAX_MESSAGES) {
      return { allowed: false, next: { windowStart: now, count } };
    }
    return { allowed: true, next: { windowStart: now, count } };
  }

  return { allowed: true, next: { windowStart: now, count: 1 } };
}
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
  const decision = evaluateAntispam(ctx.session.antispam, now);
  ctx.session.antispam = decision.next;
  if (!decision.allowed) {
    if (ctx.callbackQuery) {
      await ctx.port.answerCallback(ctx.callbackQuery.id);
    }
    return;
  }
  return next();
};
