import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { listCustomerOrders } from '../../services/orders.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderItems } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { formatMinor } from '../../lib/money.js';
import { escapeHtml } from '../../domain/escape.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { applyOrderEvent } from '../../services/orders.js';

const STATUS_LABELS: Record<string, string> = {
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

export function registerMyOrdersHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^my:list$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const list = await listCustomerOrders(ctx.tenant.id, ctx.from.id);
    const rows: InlineKeyboard['inline_keyboard'] = list.map((o) => [
      { text: `№${o.number} — ${STATUS_LABELS[o.status] ?? o.status}`, callback_data: `my:view:${o.id}` },
    ]);
    const text = list.length > 0 ? ru.my.listTitle : ru.my.empty;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageText(chatId, messageId, text, { keyboard: { inline_keyboard: rows } });
    }
  });

  bot.callbackQuery(/^my:view:(.+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:view:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const db = getDb();
    const rows = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.id, m[1]!), eq(customers.telegramId, ctx.from.id)))
      .limit(1);
    const found = rows[0];

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (!found) {
      await ctx.port.editMessageText(chatId, messageId, ru.my.notFound, {});
      return;
    }

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, found.order.id));
    const lines: string[] = [];
    lines.push(`<b>Заказ №${found.order.number}</b>`);
    lines.push(`Статус: ${STATUS_LABELS[found.order.status] ?? found.order.status}`);
    for (const it of items) {
      lines.push(
        `• ${escapeHtml(it.titleSnapshot)}${it.optionsSnapshot.length ? ` (${it.optionsSnapshot.map((o) => o.title).join(', ')})` : ''} × ${it.qty}`
      );
    }
    lines.push(`Дата: ${found.order.dueDate}${found.order.dueTimeText ? `, ${found.order.dueTimeText}` : ''}`);
    lines.push(`Получение: ${found.order.fulfillment === 'delivery' ? 'доставка' : 'самовывоз'}`);
    lines.push(`Итого: ${formatMinor(found.order.totalMinor, ctx.tenant.currency)}`);

    const kbRows: InlineKeyboard['inline_keyboard'] = [];
    if (found.order.status === 'new' || found.order.status === 'awaiting_payment') {
      kbRows.push([{ text: 'Отменить заказ', callback_data: `my:cancel:${found.order.id}` }]);
    }
    kbRows.push([{ text: ru.catalog.back, callback_data: 'my:list' }]);

    await ctx.port.editMessageText(chatId, messageId, lines.join('\n'), {
      keyboard: { inline_keyboard: kbRows },
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^my:cancel:(.+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:cancel:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const db = getDb();
    const rows = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.id, m[1]!), eq(customers.telegramId, ctx.from.id)))
      .limit(1);
    const found = rows[0];

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (!found) {
      await ctx.port.editMessageText(chatId, messageId, ru.my.notFound, {});
      return;
    }

    const result = await applyOrderEvent(found.order.id, 'customer_cancel', 'customer', new Date());
    if (!result.ok) {
      await ctx.port.editMessageText(chatId, messageId, ru.my.cancelFailed, {});
      return;
    }

    await ctx.port.editMessageText(chatId, messageId, `Заказ №${found.order.number} отменён.`, {});

    const ownerId = ctx.tenant.ownerTelegramId;
    if (ownerId) {
      await ctx.port.sendMessage(ownerId, `Заказ №${found.order.number} отменён клиентом.`);
    }
  });
}
