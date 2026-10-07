import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { applyOrderEvent } from '../../services/orders.js';
import { sendPaymentCard } from '../customer/payment.js';
import { InlineKeyboard, TelegramPort } from '../../telegram/port.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderItems } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export const REJECT_REASONS: Record<string, string> = {
  full: 'Нет мест на эту дату',
  busy: 'Много текущих заказов',
  date: 'Не подходит дата',
  other: 'Другая причина',
};

export async function buildOrderCardText(
  orderId: string,
  tenantId: string,
  currency: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order || order.tenantId !== tenantId) return null;

  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const lines: string[] = [];
  lines.push(`<b>Заказ №${order.number}</b>`);
  lines.push(`Статус: ${order.status}`);
  lines.push('');
  for (const item of items) {
    const opts = item.optionsSnapshot.map((o) => o.title).join(', ');
    lines.push(
      `• ${escapeHtml(item.titleSnapshot)}${opts ? ` (${escapeHtml(opts)})` : ''} × ${item.qty} — ${formatMinor(item.unitPriceMinor * item.qty, currency)}`
    );
  }
  lines.push('');
  lines.push(
    `Дата: ${order.dueDate}${order.dueTimeText ? `, ${escapeHtml(order.dueTimeText)}` : ''}`
  );
  lines.push(`Получение: ${order.fulfillment === 'delivery' ? 'доставка' : 'самовывоз'}`);
  if (order.address) lines.push(`Адрес: ${escapeHtml(order.address)}`);
  lines.push(`Контакт: ${escapeHtml(order.contactName)}, ${escapeHtml(order.contactPhone)}`);
  if (order.comment) lines.push(`Комментарий: ${escapeHtml(order.comment)}`);
  lines.push('');
  lines.push(
    `Итого: ${formatMinor(order.totalMinor, currency)}, предоплата ${formatMinor(order.prepaymentMinor, currency)}`
  );
  if (order.source) {
    lines.push(`Источник: ${escapeHtml(order.source)}`);
  }
  if (customer) {
    const link = customer.username ? `@${customer.username}` : `id${customer.telegramId}`;
    lines.push(`Клиент: ${escapeHtml(customer.firstName ?? 'клиент')} (${link})`);
  }
  return lines.join('\n');
}

export function orderCardKeyboard(orderId: string, status: string): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (status === 'new') {
    rows.push([{ text: 'Принять', callback_data: `adm:ord:accept:${orderId}` }]);
    rows.push([{ text: 'Отклонить', callback_data: `adm:ord:reject:${orderId}` }]);
  }
  if (status === 'confirmed') {
    rows.push([{ text: 'Готов', callback_data: `adm:ord:ready:${orderId}` }]);
    rows.push([{ text: 'Отменить', callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  if (status === 'ready') {
    rows.push([{ text: 'Завершён', callback_data: `adm:ord:done:${orderId}` }]);
    rows.push([{ text: 'Отменить', callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  if (status === 'payment_review' || status === 'awaiting_payment') {
    rows.push([{ text: 'Отменить', callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  return { inline_keyboard: rows };
}

export function registerOrderHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel):/, async (ctx) => {
    if (ctx.role !== 'owner') {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel):(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    const action = m[1]!;
    const rest = m[2]!;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (action === 'accept') {
      const result = await applyOrderEvent(rest, 'owner_accept', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, {
          keyboard: orderCardKeyboard(rest, result.value.status),
          parseMode: 'HTML',
        });
      }
      if (result.value.status === 'awaiting_payment') {
        await sendPaymentCard(ctx.port, ctx.tenant.id, rest);
      } else {
        await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} принят в работу.`);
      }
      return;
    }

    if (action === 'reject') {
      // show reason picker
      const rows: InlineKeyboard['inline_keyboard'] = Object.entries(REJECT_REASONS).map(
        ([code, label]) => [{ text: label, callback_data: `adm:ord:rr:${rest}:${code}` }]
      );
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, `${card}\n\nПричина отказа?`, {
          keyboard: { inline_keyboard: rows },
          parseMode: 'HTML',
        });
      }
      return;
    }

    if (action === 'paid') {
      const result = await applyOrderEvent(rest, 'payment_confirmed', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, {
          parseMode: 'HTML',
        });
      }
      await notifyCustomer(ctx.port, rest, () => 'Оплата подтверждена. Заказ в работе.');
      return;
    }

    if (action === 'badpay') {
      const result = await applyOrderEvent(rest, 'payment_rejected', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, {
          parseMode: 'HTML',
        });
      }
      await notifyCustomer(
        ctx.port,
        rest,
        () =>
          'Оплата не подтверждена. Нажмите «Я оплатил» в сообщении с реквизитами и пришлите другой чек.'
      );
      return;
    }

    if (action === 'ready') {
      const result = await applyOrderEvent(rest, 'mark_ready', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, {
          keyboard: orderCardKeyboard(rest, result.value.status),
          parseMode: 'HTML',
        });
      }
      await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} готов!`);
      return;
    }

    if (action === 'done') {
      const result = await applyOrderEvent(rest, 'mark_completed', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, { parseMode: 'HTML' });
      }
      await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} завершён. Спасибо!`);
      return;
    }

    if (action === 'cancel') {
      const result = await applyOrderEvent(rest, 'owner_cancel', 'owner', new Date());
      if (!result.ok) return;
      const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, { parseMode: 'HTML' });
      }
      await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} отменён мастером.`);
      return;
    }

    if (action === 'rr') {
      const [orderId, code] = rest.split(':');
      const reason = REJECT_REASONS[code!];
      if (!orderId || !reason) return;
      const result = await applyOrderEvent(orderId, 'owner_reject', 'owner', new Date());
      if (!result.ok) return;
      // store reason text
      const db = getDb();
      await db.update(orders).set({ rejectReason: reason }).where(eq(orders.id, orderId));
      const card = await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency);
      if (card) {
        await ctx.port.editMessageText(chatId, messageId, card, {
          keyboard: orderCardKeyboard(orderId, result.value.status),
          parseMode: 'HTML',
        });
      }
      await notifyCustomer(ctx.port, orderId, (n) => `Заказ №${n} отклонён: ${reason}`);
      return;
    }
  });
}

async function notifyCustomer(
  port: TelegramPort,
  orderId: string,
  text: (number: number, total: number) => string
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer || customer.botBlocked) return;
  await port.sendMessage(customer.telegramId, text(order.number, order.totalMinor), {
    parseMode: 'HTML',
  });
}
