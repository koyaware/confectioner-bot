import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { computeStats } from '../../services/stats.js';
import { formatMinor } from '../../lib/money.js';
import { escapeHtml } from '../../domain/escape.js';

export function registerStatsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:stats(:(7|30))?$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const daysStr = /^adm:stats:(\d+)$/.exec(data)?.[1] ?? '7';
    const days = Number(daysStr);

    const stats = await computeStats(ctx.tenant.id, days, new Date());

    const FUNNEL_ORDER = [
      'start',
      'catalog_view',
      'product_view',
      'cart_add',
      'checkout_start',
      'order_submit',
      'faq_view',
    ];
    const STATUS_ORDER = [
      'new',
      'awaiting_payment',
      'payment_review',
      'confirmed',
      'ready',
      'completed',
      'rejected',
      'cancelled',
      'expired',
    ];
    const orderIndex = (order: string[], value: string) => {
      const i = order.indexOf(value);
      return i === -1 ? order.length : i;
    };

    const lines: string[] = [];
    lines.push(ctx.t.stats.title(days));
    lines.push('');
    lines.push(`${ctx.t.stats.newCustomers}: ${stats.newCustomersTotal}`);
    for (const s of stats.newCustomersBySource) {
      lines.push(`  • ${escapeHtml(s.source ?? ctx.t.stats.unknownSource)}: ${s.count}`);
    }
    lines.push('');
    lines.push(ctx.t.stats.funnelTitle);
    const funnel = [...stats.funnel]
      .filter((f) => f.type !== 'free_text')
      .sort((a, b) => orderIndex(FUNNEL_ORDER, a.type) - orderIndex(FUNNEL_ORDER, b.type));
    for (const f of funnel) {
      lines.push(`  • ${ctx.t.funnel[f.type as keyof typeof ctx.t.funnel] ?? f.type}: ${f.count}`);
    }
    lines.push('');
    lines.push(ctx.t.stats.byStatusTitle);
    const byStatus = [...stats.ordersByStatus].sort(
      (a, b) => orderIndex(STATUS_ORDER, a.status) - orderIndex(STATUS_ORDER, b.status)
    );
    for (const o of byStatus) {
      lines.push(
        `  • ${ctx.t.orderStatuses[o.status as keyof typeof ctx.t.orderStatuses] ?? o.status}: ${o.count}`
      );
    }
    lines.push('');
    lines.push(
      ctx.t.stats.revenue(
        formatMinor(stats.revenueMinor, ctx.tenant.currency),
        stats.confirmedOrders
      )
    );
    lines.push(ctx.t.stats.avgDecision(stats.avgDecisionMinutes));
    lines.push(ctx.t.stats.botOnly(stats.botOnlyInteractions));

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const kb: InlineKeyboard = {
      inline_keyboard: [
        [
          { text: ctx.t.stats.days7, callback_data: 'adm:stats:7' },
          { text: ctx.t.stats.days30, callback_data: 'adm:stats:30' },
        ],
        [{ text: ctx.t.common.back, callback_data: 'adm:menu' }],
      ],
    };
    await ctx.port.editMessageTextOrSend(chatId, messageId, lines.join('\n'), {
      keyboard: kb,
      parseMode: 'HTML',
    });
  });
}
