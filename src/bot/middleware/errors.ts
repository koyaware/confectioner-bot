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

    const superadminId = parseInt(process.env.SUPERADMIN_TELEGRAM_ID || '0', 10);
    if (superadminId && ctx.port) {
      try {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.port.sendMessage(superadminId, `Ошибка бота: ${message.slice(0, 4000)}`);
      } catch (notifyError) {
        console.error('Failed to notify superadmin:', notifyError);
      }
    }

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
