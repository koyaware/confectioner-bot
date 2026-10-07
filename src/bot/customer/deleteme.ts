import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { eraseCustomerData } from '../../services/privacy.js';

export function registerDeleteMeHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('deleteme', async (ctx) => {
    const erased = await eraseCustomerData(ctx.tenant.id, ctx.from!.id);
    await ctx.port.sendMessage(ctx.chat.id, erased ? ru.deleteme.done : ru.deleteme.notFound);
  });
}
