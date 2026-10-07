import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';

export function registerStartHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('start', async (ctx) => {
    ctx.sessionState = 'idle';
    ctx.session.cart = ctx.session.cart ?? { lines: [] };

    const greeting = ctx.tenant.greetingText ?? ru.start.greeting(ctx.tenant.shopName);

    const keyboard: InlineKeyboard = {
      inline_keyboard: [[{ text: ru.start.buttonCatalog, callback_data: 'cat:list' }]],
    };

    await ctx.port.sendMessage(ctx.chat.id, greeting, {
      keyboard,
      parseMode: 'HTML',
    });
  });
}
