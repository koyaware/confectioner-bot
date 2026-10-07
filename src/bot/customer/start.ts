import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { claimTenant } from '../../services/tenants.js';
import { customerMenuKeyboard, ownerMenuKeyboard } from '../owner/menu.js';

export function registerStartHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('start', async (ctx) => {
    ctx.sessionState = 'idle';
    ctx.session.cart = ctx.session.cart ?? { lines: [] };
    ctx.session.checkout = undefined;
    ctx.session.paymentOrderId = undefined;
    ctx.session.ownerDraft = undefined;
    ctx.session.selections = undefined;

    const param = ctx.message?.text?.split(' ')[1];

    if (param && param.startsWith('claim_')) {
      const code = param.slice('claim_'.length);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimInvalid);
        return;
      }
      const result = await claimTenant(code, ctx.from!.id, new Date());
      if (result.ok) {
        ctx.role = 'owner';
        ctx.tenant.ownerTelegramId = ctx.from!.id;
        await ctx.port.sendMessage(ctx.chat.id, ru.start.claimSuccess(result.value.shopName));
        await ctx.port.sendMessage(ctx.chat.id, ru.menu.ownerTitle, {
          keyboard: ownerMenuKeyboard(),
          parseMode: 'HTML',
        });
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

    await ctx.port.sendMessage(ctx.chat.id, greeting, {
      keyboard: customerMenuKeyboard(),
      parseMode: 'HTML',
    });
  });
}
