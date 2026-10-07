import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { computeStats } from '../../services/stats.js';
import { formatMinor } from '../../lib/money.js';
import { escapeHtml } from '../../domain/escape.js';

const FUNNEL_LABELS: Record<string, string> = {
  start: 'Старт',
  catalog_view: 'Каталог',
  product_view: 'Товар',
  cart_add: 'Корзина',
  checkout_start: 'Оформление',
  order_submit: 'Заказ',
  faq_view: 'FAQ',
  free_text: 'Свободный вопрос',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  awaiting_payment: 'Ожидает оплаты',
  payment_review: 'Чек на проверке',
  confirmed: 'Подтверждён',
  ready: 'Готов',
  completed: 'Завершён',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
  expired: 'Истёк',
};

export function registerStatsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:stats(:(7|30))?$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const daysStr = /^adm:stats:(\d+)$/.exec(data)?.[1] ?? '7';
    const days = Number(daysStr);

    const stats = await computeStats(ctx.tenant.id, days, new Date());

    const lines: string[] = [];
    lines.push(`<b>Статистика за ${days} дней</b>`);
    lines.push('');
    lines.push(`Новые клиенты: ${stats.newCustomersTotal}`);
    for (const s of stats.newCustomersBySource) {
      lines.push(`  • ${escapeHtml(s.source)}: ${s.count}`);
    }
    lines.push('');
    lines.push('Воронка:');
    for (const f of stats.funnel) {
      lines.push(`  • ${FUNNEL_LABELS[f.type] ?? f.type}: ${f.count}`);
    }
    lines.push('');
    lines.push('Заказы по статусам:');
    for (const o of stats.ordersByStatus) {
      lines.push(`  • ${ORDER_STATUS_LABELS[o.status] ?? o.status}: ${o.count}`);
    }
    lines.push('');
    lines.push(
      `Выручка (подтверждённые): ${formatMinor(stats.revenueMinor, ctx.tenant.currency)} (${stats.confirmedOrders} шт.)`
    );
    lines.push(
      `Время до решения владельца: ${stats.avgDecisionMinutes === null ? '—' : `${stats.avgDecisionMinutes} мин`}`
    );
    lines.push(`Обрабатывал бот без владельца: ${stats.botOnlyInteractions} клиентов`);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const kb: InlineKeyboard = {
      inline_keyboard: [
        [
          { text: '7 дней', callback_data: 'adm:stats:7' },
          { text: '30 дней', callback_data: 'adm:stats:30' },
        ],
        [{ text: 'Назад', callback_data: 'adm:menu' }],
      ],
    };
    await ctx.port.editMessageTextOrSend(chatId, messageId, lines.join('\n'), {
      keyboard: kb,
      parseMode: 'HTML',
    });
  });
}
