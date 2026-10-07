import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';

export function registerMenuHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('menu', async (ctx) => {
    ctx.sessionState = 'idle';

    if (ctx.role === 'owner') {
      const s = ru.menu.ownerSections;
      const keyboard: InlineKeyboard = {
        inline_keyboard: [
          [{ text: s.orders, callback_data: 'adm:ord:list' }],
          [{ text: s.catalog, callback_data: 'adm:cat:list' }],
          [{ text: s.calendar, callback_data: 'adm:cal:list' }],
          [{ text: s.settings, callback_data: 'adm:set:list' }],
          [{ text: s.links, callback_data: 'adm:src:list' }],
          [{ text: s.stats, callback_data: 'adm:stats' }],
          [{ text: s.preview, callback_data: 'adm:preview' }],
        ],
      };
      await ctx.port.sendMessage(ctx.chat.id, ru.menu.ownerTitle, {
        keyboard,
        parseMode: 'HTML',
      });
      return;
    }

    const keyboard: InlineKeyboard = {
      inline_keyboard: [[{ text: ru.start.buttonCatalog, callback_data: 'cat:list' }]],
    };
    await ctx.port.sendMessage(ctx.chat.id, ru.menu.customerTitle, {
      keyboard,
      parseMode: 'HTML',
    });
  });
}
