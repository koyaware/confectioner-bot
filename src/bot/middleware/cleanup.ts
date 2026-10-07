import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';

/**
 * Removes transient bot messages (e.g. viewed reference photos) as soon as
 * the user presses any other button, keeping the chat on one screen.
 */
export const refsCleanupMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  const ids = ctx.session?.refsMessageIds;
  if (ids && ids.length > 0 && ctx.callbackQuery && ctx.chat) {
    ctx.session.refsMessageIds = [];
    for (const id of ids) {
      try {
        await ctx.port.deleteMessage(ctx.chat.id, id);
      } catch {
        // already gone
      }
    }
  }
  await next();
};
