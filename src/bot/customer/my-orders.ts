import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { listCustomerOrders } from '../../services/orders.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderItems, orderAttachments } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { formatMinor } from '../../lib/money.js';
import { escapeHtml } from '../../domain/escape.js';
import { InlineKeyboard } from '../../telegram/port.js';
import {
  applyOrderEvent,
  getCustomerOrderNumber,
  acceptProposedDate,
} from '../../services/orders.js';
import { sendPaymentCard } from './payment.js';
import { customerMenuKeyboard } from '../owner/menu.js';

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

    // Clear dialog state if open
    if (ctx.sessionState === 'customer.dialog') {
      ctx.session.dialogHistory = undefined;
      ctx.session.dialogMessageId = undefined;
      ctx.sessionState = 'idle';
    }

    const list = await listCustomerOrders(ctx.tenant.id, ctx.from.id);
    const rows: InlineKeyboard['inline_keyboard'] = list.map((o) => [
      {
        text: `№${o.number} — ${STATUS_LABELS[o.status] ?? o.status}`,
        callback_data: `my:view:${o.id}`,
      },
    ]);
    const text = list.length > 0 ? ru.my.listTitle : ru.my.empty;
    rows.push([{ text: 'В меню', callback_data: 'nav:menu' }]);
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
      });
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
      .where(
        and(
          eq(orders.id, m[1]!),
          eq(orders.tenantId, ctx.tenant.id),
          eq(customers.telegramId, ctx.from.id),
          eq(customers.tenantId, ctx.tenant.id)
        )
      )
      .limit(1);
    const found = rows[0];

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (!found || found.order.status === 'cancelled') {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.my.notFound, {
        keyboard: { inline_keyboard: [[{ text: ru.catalog.back, callback_data: 'my:list' }]] },
      });
      return;
    }

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, found.order.id));
    const refs = await db
      .select()
      .from(orderAttachments)
      .where(
        and(eq(orderAttachments.orderId, found.order.id), eq(orderAttachments.kind, 'reference'))
      );
    const lines: string[] = [];
    lines.push(
      `<b>Заказ №${(await getCustomerOrderNumber(found.order.id)) ?? found.order.number}</b>`
    );
    lines.push(`Статус: ${STATUS_LABELS[found.order.status] ?? found.order.status}`);
    for (const it of items) {
      lines.push(
        `• ${escapeHtml(it.titleSnapshot)}${it.optionsSnapshot.length ? ` (${it.optionsSnapshot.map((o) => escapeHtml(o.title)).join(', ')})` : ''} × ${it.qty}`
      );
    }
    lines.push(
      `Дата: ${found.order.dueDate}${found.order.dueTimeText ? `, ${escapeHtml(found.order.dueTimeText)}` : ''}`
    );
    lines.push(`Получение: ${found.order.fulfillment === 'delivery' ? 'доставка' : 'самовывоз'}`);
    lines.push(`Итого: ${formatMinor(found.order.totalMinor, ctx.tenant.currency)}`);
    if (refs.length > 0) {
      lines.push(`Референсы: ${refs.length} шт.`);
    }

    const kbRows: InlineKeyboard['inline_keyboard'] = [];
    if (refs.length > 0) {
      kbRows.push([
        { text: `Референсы (${refs.length})`, callback_data: `my:refs:${found.order.id}` },
      ]);
    }
    if (found.order.status === 'new' || found.order.status === 'awaiting_payment') {
      kbRows.push([{ text: 'Отменить заказ', callback_data: `my:cancel:${found.order.id}` }]);
    }
    kbRows.push([{ text: ru.catalog.back, callback_data: 'my:list' }]);

    await ctx.port.editMessageTextOrSend(chatId, messageId, lines.join('\n'), {
      keyboard: { inline_keyboard: kbRows },
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^my:refs:(.+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:refs:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const db = getDb();
    const rows = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.id, m[1]!),
          eq(orders.tenantId, ctx.tenant.id),
          eq(customers.telegramId, ctx.from.id),
          eq(customers.tenantId, ctx.tenant.id)
        )
      )
      .limit(1);
    const found = rows[0];
    if (!found) return;

    const refs = await db
      .select()
      .from(orderAttachments)
      .where(
        and(eq(orderAttachments.orderId, found.order.id), eq(orderAttachments.kind, 'reference'))
      );

    if (refs.length === 0) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, 'Референсов нет.', {});
      return;
    }

    const sentIds: number[] = [];
await ctx.port.editMessageTextOrSend(
      chatId,
      messageId,
      `Референсы заказа №${(await getCustomerOrderNumber(found.order.id)) ?? found.order.number} (${refs.length} шт.)`,
      { keyboard: { inline_keyboard: [[{ text: ru.catalog.back, callback_data: `my:view:${found.order.id}` }]] } }
    );
    for (const ref of refs) {
      if (ref.fileType === 'photo') {
        const sent = await ctx.port.sendPhoto(chatId, ref.fileId);
        sentIds.push(sent.messageId);
      } else {
        const sent = await ctx.port.sendDocument(chatId, ref.fileId);
        sentIds.push(sent.messageId);
      }
    }
    ctx.session.refsMessageIds = [...(ctx.session.refsMessageIds ?? []), ...sentIds];
  });

  async function doCustomerCancel(
    ctx: BotContextWithSession,
    orderId: string,
    reason: string | null,
    chatId: number,
    messageId: number
  ): Promise<void> {
    if (!ctx.from) return;
    const db = getDb();
    const rows = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(customers.telegramId, ctx.from.id),
          eq(customers.tenantId, ctx.tenant.id)
        )
      )
      .limit(1);
    const found = rows[0];

    if (!found) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.my.notFound, {
        keyboard: { inline_keyboard: [[{ text: ru.catalog.back, callback_data: 'my:list' }]] },
      });
      return;
    }

    const result = await applyOrderEvent(found.order.id, 'customer_cancel', 'customer', new Date());
    if (!result.ok) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.my.cancelFailed, {});
      return;
    }
    if (reason) {
      await db.update(orders).set({ cancelReason: reason }).where(eq(orders.id, found.order.id));
    }

    await ctx.port.editMessageTextOrSend(
      chatId,
      messageId,
      `Заказ №${(await getCustomerOrderNumber(found.order.id)) ?? found.order.number} отменён.`,
      { keyboard: customerMenuKeyboard() }
    );

    const ownerId = ctx.tenant.ownerTelegramId;
    if (ownerId) {
      await ctx.port.sendMessage(
        ownerId,
        `Заказ №${found.order.number} отменён клиентом${reason ? ': ' + reason : '.'}`
      );
    }
  }

  bot.callbackQuery(/^my:cancel:([^:]+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:cancel:([^:]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const orderId = m[1]!;
    const reasonRows: InlineKeyboard['inline_keyboard'] = Object.entries(ru.my.cancelReasons).map(
      ([code, label]) => [{ text: label, callback_data: `my:cancelreason:${orderId}:${code}` }]
    );
    reasonRows.push([{ text: ru.my.cancelSkip, callback_data: `my:cancelskip:${orderId}` }]);
    reasonRows.push([{ text: ru.catalog.back, callback_data: `my:view:${orderId}` }]);
    await ctx.port.editMessageTextOrSend(chatId, messageId, ru.my.cancelTitle, {
      keyboard: { inline_keyboard: reasonRows },
    });
  });

  bot.callbackQuery(/^my:cancelreason:([^:]+):([a-z]+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:cancelreason:([^:]+):([a-z]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const reason = ru.my.cancelReasons[m[2]!] ?? m[2]!;
    await doCustomerCancel(ctx, m[1]!, reason, chatId, messageId);
  });

  bot.callbackQuery(/^my:cancelskip:([^:]+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^my:cancelskip:([^:]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    await doCustomerCancel(ctx, m[1]!, null, chatId, messageId);
  });

  bot.callbackQuery(/^pd:(yes|no):(.+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^pd:(yes|no):(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const db = getDb();
    const rows = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.id, m[2]!),
          eq(orders.tenantId, ctx.tenant.id),
          eq(customers.telegramId, ctx.from.id),
          eq(customers.tenantId, ctx.tenant.id)
        )
      )
      .limit(1);
    const found = rows[0];
    if (
      !found ||
      found.order.tenantId !== ctx.tenant.id ||
      found.order.status !== 'new' ||
      !found.order.proposedDate
    ) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.my.notFound, {
        keyboard: { inline_keyboard: [[{ text: ru.catalog.back, callback_data: 'my:list' }]] },
      });
      return;
    }

    const action = m[1]!;
    if (action === 'no') {
      await db.update(orders).set({ proposedDate: null }).where(eq(orders.id, found.order.id));
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        'Хорошо, ждём нового предложения от мастера.',
        {}
      );
      const ownerId = ctx.tenant.ownerTelegramId;
      if (ownerId) {
        await ctx.port.sendMessage(
          ownerId,
          `Клиент отклонил предложенную дату по заказу №${found.order.number}.`
        );
      }
      return;
    }

    // pd:yes — availability re-check and date swap happen atomically in the service
    const accepted = await acceptProposedDate(
      found.order.id,
      ctx.tenant.id,
      ctx.from.id,
      new Date()
    );
    if (!accepted.ok) {
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        accepted.error === 'DATE_UNAVAILABLE'
          ? 'Эта дата уже недоступна. Попросите мастера предложить другую.'
          : ru.my.actionFailed,
        {}
      );
      return;
    }

    if (accepted.value.status === 'awaiting_payment') {
      await sendPaymentCard(ctx.port, ctx.tenant.id, found.order.id);
    } else {
      await ctx.port.sendMessage(
        chatId,
        `Заказ №${(await getCustomerOrderNumber(found.order.id)) ?? found.order.number} принят в работу.`
      );
    }

    await ctx.port.editMessageTextOrSend(
      chatId,
      messageId,
      `Заказ №${(await getCustomerOrderNumber(found.order.id)) ?? found.order.number} перенесён на ${accepted.value.dueDate}.`,
      {}
    );
  });
}
