import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { claimTenant } from '../../services/tenants.js';

export function registerStartHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('start', async (ctx) => {
    ctx.sessionState = 'idle';
    ctx.session.cart = ctx.session.cart ?? { lines: [] };

    const param = ctx.message?.text?.split(' ')[1];

    if (param && param.startsWith('claim_')) {
      const result = await claimTenant(param.slice('claim_'.length), ctx.from!.id, new Date());
      if (result.ok) {
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimSuccess(result.value.shopName));
      } else if (result.error === 'EXPIRED') {
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimExpired);
      } else if (result.error === 'ALREADY_CLAIMED') {
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimUsed);
      } else {
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimInvalid);
      }
      return;
    }

    const greeting = ctx.tenant.greetingText ?? ru.start.greeting(ctx.tenant.shopName);

    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [{ text: ru.start.buttonCatalog, callback_data: 'cat:list' }],
        [
          { text: ru.cart.button, callback_data: 'cart:show' },
          { text: ru.my.button, callback_data: 'my:list' },
        ],
        [{ text: ru.faq.button, callback_data: 'faq:list' }],
      ],
    };

    await ctx.port.sendMessage(ctx.chat.id, greeting, {
      keyboard,
      parseMode: 'HTML',
    });
  });
}
