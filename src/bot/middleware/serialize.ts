import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

const locks = new Map<string, Promise<void>>();

function lockKey(ctx: BotContextWithSession): string | undefined {
  if (ctx.chat?.id !== undefined) return `chat:${ctx.chat.id}`;
  if (ctx.from?.id !== undefined) return `user:${ctx.from.id}`;
  return undefined;
}

/**
 * Serializes update processing per chat.
 *
 * Long polling delivers album photos (and rapid taps) as separate updates
 * that the runner handles concurrently. Without this, two updates can
 * interleave between session load and session save, and the last writer
 * silently drops the other's changes (e.g. an album of 5 photos ends up
 * counted as 1). Must run before sessionMiddleware.
 */
export const serializeMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  const key = lockKey(ctx);
  if (!key) {
    await next();
    return;
  }
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  try {
    await previous;
    await next();
  } finally {
    if (locks.get(key) === current) {
      locks.delete(key);
    }
    release();
  }
};
