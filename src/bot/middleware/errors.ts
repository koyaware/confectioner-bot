import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { TelegramError } from '../../telegram/port.js';

/**
 * Error handling middleware
 */
export const errorMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  try {
    await next();
  } catch (error: unknown) {
    console.error('Bot error:', error);

    // Handle Telegram errors
    if (error instanceof TelegramError) {
      // Don't send messages for BLOCKED errors
      if (error.code === 'BLOCKED') {
        console.error(`Bot was blocked by user ${ctx.chat?.id}`);
        return;
      }

      // Send generic error message to user
      try {
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
      } catch (sendError) {
        console.error('Failed to send error message:', sendError);
      }
      return;
    }

    // Handle unexpected errors
    try {
      await ctx.reply('Произошла непредвиденная ошибка. Попробуйте позже.');
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
};
