import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { TelegramError } from '../../telegram/port.js';

function scrubSecrets(message: string): string {
  let out = message;
  const appSecret = process.env.APP_SECRET;
  if (appSecret) {
    out = out.split(appSecret).join('[redacted]');
  }
  return out.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, '[redacted-bot-token]');
}

async function notifyUser(ctx: BotContextWithSession): Promise<void> {
  if (ctx.port && ctx.chat) {
    try {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.common.error);
      return;
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
  try {
    await ctx.reply(ctx.t.common.error);
  } catch (sendError) {
    console.error('Failed to send error message:', sendError);
  }
}

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
        await ctx.port.sendMessage(
          superadminId,
          `Ошибка бота: ${scrubSecrets(message).slice(0, 4000)}`
        );
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
      await notifyUser(ctx);
      return;
    }

    // Handle unexpected errors
    await notifyUser(ctx);
  }
};
