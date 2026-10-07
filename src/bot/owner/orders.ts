import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { applyOrderEvent } from '../../services/orders.js';
import { sendPaymentCard } from '../customer/payment.js';
import { InlineKeyboard, TelegramPort } from '../../telegram/port.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderItems } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { addDays } from '../../domain/dates.js';
import { getDateAvailability } from '../../services/dates.js';

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
    rows.push([{ text: 'Другая дата', callback_data: `adm:ord:date:${orderId}` }]);
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
  if (['new', 'awaiting_payment', 'payment_review', 'confirmed', 'ready'].includes(status)) {
    rows.push([{ text: 'Написать клиенту', callback_data: `adm:ord:msg:${orderId}` }]);
  }
  rows.push([{ text: 'Назад', callback_data: 'adm:ord:list' }]);
  return { inline_keyboard: rows };
}

export function registerOrderHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:ord:list$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.tenantId, ctx.tenant.id))
      .orderBy(asc(orders.createdAt))
      .limit(30);

    if (rows.length === 0) {
      await ctx.port.editMessageText(chatId, messageId, 'Заказов пока нет.', {
        keyboard: { inline_keyboard: [[{ text: 'Назад', callback_data: 'adm:menu' }]] },
      });
      return;
    }

    const keyboardRows: InlineKeyboard['inline_keyboard'] = rows.slice(-15).map((order) => [
      {
        text: `№${order.number} ${order.status} · ${order.dueDate}`,
        callback_data: `adm:ord:view:${order.id}`,
      },
    ]);
    keyboardRows.push([{ text: 'Назад', callback_data: 'adm:menu' }]);

    await ctx.port.editMessageText(chatId, messageId, 'Последние заказы:', {
      keyboard: { inline_keyboard: keyboardRows },
    });
  });

  bot.callbackQuery(/^adm:ord:view:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:view:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const card = await buildOrderCardText(m[1]!, ctx.tenant.id, ctx.tenant.currency);
    if (!card) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, 'Заказ не найден.');
      return;
    }

    const rows = await getDb().select().from(orders).where(eq(orders.id, m[1]!)).limit(1);
    const status = rows[0]?.status ?? 'new';
    await ctx.port.editMessageText(chatId, messageId, card, {
      keyboard: orderCardKeyboard(m[1]!, status),
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^adm:ord:msg:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:msg:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    ctx.sessionState = 'owner.reply_to_customer';
    ctx.session.ownerDraft = { kind: 'ord_msg', targetId: m[1] };

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageText(chatId, messageId, 'Напишите сообщение клиенту.', {
        keyboard: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:ord:list' }]] },
      });
    }
  });

  bot.callbackQuery(
    /^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel|date|pd):/,
    async (ctx) => {
      if (!canAccessOwner(ctx)) {
        await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
        return;
      }
      await ctx.port.answerCallback(ctx.callbackQuery.id);

      const m = /^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel|date|pd):(.+)$/.exec(
        ctx.callbackQuery.data
      );
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

      if (action === 'date') {
        const orderId = rest;
        const db = getDb();
        const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const order = rows[0];
        if (!order || order.tenantId !== ctx.tenant.id || order.status !== 'new') return;

        const monthStart = `${order.dueDate.slice(0, 7)}-01`;
        const monthEndDate = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
        const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const cartLines = itemRows
          .filter((i) => i.productId !== null)
          .map((i, idx) => ({
            lineId: `l${idx}`,
            productId: i.productId!,
            qty: i.qty,
            optionIds: [] as string[],
          }));
        const avail = await getDateAvailability(
          ctx.tenant.id,
          monthStart,
          monthEndDate,
          { lines: cartLines },
          new Date()
        );

        const kbRows: InlineKeyboard['inline_keyboard'] = [];
        for (const [date, entry] of Object.entries(avail)) {
          if (entry.available) {
            kbRows.push([{ text: date, callback_data: `adm:ord:pd:${orderId}:${date}` }]);
          }
        }
        await ctx.port.editMessageText(
          chatId,
          messageId,
          `Предложите новую дату для заказа №${order.number}:`,
          { keyboard: { inline_keyboard: kbRows } }
        );
        return;
      }

      if (action === 'pd') {
        const parts = rest.split(':');
        const orderId = parts[0]!;
        const iso = parts[1]!;
        const db = getDb();
        const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const order = rows[0];
        if (!order || order.tenantId !== ctx.tenant.id || order.status !== 'new') return;

        await db.update(orders).set({ proposedDate: iso }).where(eq(orders.id, orderId));

        const crows = await db
          .select()
          .from(customers)
          .where(eq(customers.id, order.customerId))
          .limit(1);
        const cust = crows[0];
        if (cust && !cust.botBlocked) {
          await ctx.port.sendMessage(
            cust.telegramId,
            `Мастер предлагает сдвинуть заказ №${order.number} на ${iso}. Подходит?`,
            {
              keyboard: {
                inline_keyboard: [
                  [{ text: 'Подходит', callback_data: `pd:yes:${orderId}` }],
                  [{ text: 'Не подходит', callback_data: `pd:no:${orderId}` }],
                ],
              },
            }
          );
        }

        const card = await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, { parseMode: 'HTML' });
        }
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
    }
  );
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
