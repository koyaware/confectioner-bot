import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { eraseCustomerData } from '../../services/privacy.js';

export function registerDeleteMeHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('deleteme', async (ctx) => {
    if (!ctx.from) return;
    const erased = await eraseCustomerData(ctx.tenant.id, ctx.from.id);
    await ctx.port.sendMessage(ctx.chat.id, erased ? ctx.t.deleteme.done : ctx.t.deleteme.notFound);
  });
}
