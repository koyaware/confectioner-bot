import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderAttachments, tenants } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { applyOrderEvent, getCustomerOrderNumber } from '../../services/orders.js';
import { formatMinor } from '../../lib/money.js';
import { TelegramPort } from '../../telegram/port.js';
import { nanoid } from 'nanoid';

export async function sendPaymentCard(
  port: TelegramPort,
  tenantId: string,
  orderId: string
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return;
  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer || customer.botBlocked) return;

  const customerNumber = (await getCustomerOrderNumber(orderId)) ?? order.number;
  const deadline = order.paymentDueAt
    ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: tenant.timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(order.paymentDueAt))
    : '—';
  const card =
    `Заказ №${customerNumber} принят.\n\n` +
    `Предоплата: ${formatMinor(order.prepaymentMinor, tenant.currency)}\n\n` +
    `${tenant.paymentText ?? 'Реквизиты уточняйте у мастера'}\n\n` +
    `Оплатите и нажмите «Я оплатил». Срок: до ${deadline}`;

  await port.sendMessage(customer.telegramId, card, {
    keyboard: {
      inline_keyboard: [[{ text: 'Я оплатил', callback_data: `pay:sent:${orderId}` }]],
    },
  });
}

export function registerPaymentHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^pay:sent:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^pay:sent:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, m[1]!), eq(orders.tenantId, ctx.tenant.id)))
      .limit(1);
    const order = rows[0];
    if (!order) return;
    if (order.status !== 'awaiting_payment') {
      const chatId = ctx.callbackQuery.message?.chat.id;
      if (chatId) {
        await ctx.port.sendMessage(
          chatId,
          order.status === 'payment_review' ? ru.payment.alreadyReview : ru.payment.notAwaiting
        );
      }
      return;
    }

    // Verify customer owns the order
    const customerRows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, ctx.tenant.id)))
      .limit(1);
    if (!customerRows[0] || customerRows[0].telegramId !== ctx.from?.id) return;

    ctx.sessionState = 'payment.await_receipt';
    ctx.session.paymentOrderId = order.id;
    const screenMessageId = ctx.callbackQuery.message?.message_id;
    if (screenMessageId) ctx.session.paymentScreenId = screenMessageId;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.payment.promptReceipt, {});
    }
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.sessionState !== 'payment.await_receipt') {
      await next();
      return;
    }
    await deleteUserMessage(ctx);
    const screen = receiptScreen(ctx);
    if (screen) {
      await ctx.port.editMessageTextOrSend(
        screen.chatId,
        screen.messageId,
        ru.payment.invalidReceipt,
        {}
      );
    }
  });

  bot.on('message:photo', async (ctx, next) => {
    if (ctx.sessionState !== 'payment.await_receipt') {
      await next();
      return;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (!photo) return;
    await handleReceipt(ctx, photo.file_id, 'photo');
  });

  bot.on('message:document', async (ctx, next) => {
    if (ctx.sessionState !== 'payment.await_receipt') {
      await next();
      return;
    }
    await deleteUserMessage(ctx);
    const screen = receiptScreen(ctx);
    if (screen) {
      await ctx.port.editMessageTextOrSend(
        screen.chatId,
        screen.messageId,
        ru.payment.invalidReceipt,
        {}
      );
    }
  });
}

async function deleteUserMessage(ctx: BotContextWithSession): Promise<void> {
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;
  if (!messageId || !chatId) return;
  try {
    await ctx.port.deleteMessage(chatId, messageId);
  } catch {
    // already gone
  }
}

function receiptScreen(ctx: BotContextWithSession): { chatId: number; messageId: number } | null {
  const chatId = ctx.chat?.id;
  const messageId = ctx.session.paymentScreenId;
  if (!chatId || !messageId) return null;
  return { chatId, messageId };
}

async function handleReceipt(
  ctx: BotContextWithSession,
  fileId: string,
  fileType: 'photo' | 'document'
): Promise<void> {
  const orderId = ctx.session.paymentOrderId;
  if (!orderId) return;

  const result = await applyOrderEvent(orderId, 'receipt_uploaded', 'customer', new Date());

  ctx.sessionState = 'idle';
  ctx.session.paymentOrderId = undefined;

  if (!result.ok) {
    await deleteUserMessage(ctx);
    const failedScreen = receiptScreen(ctx);
    if (failedScreen) {
      await ctx.port.editMessageTextOrSend(
        failedScreen.chatId,
        failedScreen.messageId,
        ru.payment.failed,
        {}
      );
    }
    return;
  }

  const db = getDb();
  await db.insert(orderAttachments).values({
    id: nanoid(),
    orderId,
    kind: 'receipt',
    fileId,
    fileType,
    createdAt: new Date(),
  });

  await deleteUserMessage(ctx);
  const screen = receiptScreen(ctx);
  ctx.session.paymentScreenId = undefined;
  if (screen) {
    await ctx.port.editMessageTextOrSend(screen.chatId, screen.messageId, ru.payment.receiptSent, {
      keyboard: { inline_keyboard: [[{ text: ru.menu.customerTitle, callback_data: 'nav:menu' }]] },
    });
  }

  // Send receipt to owner
  const ownerId = ctx.tenant.ownerTelegramId;
  if (!ownerId) return;

  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;

  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];
  const clientLabel = customer
    ? `${customer.firstName ?? 'клиент'}${customer.username ? ` (@${customer.username})` : ''}`
    : 'клиент';

  if (fileType === 'photo') {
    await ctx.port.sendPhoto(
      ownerId,
      fileId,
      ru.payment.receiptToOwner(clientLabel, order.number, 'фото'),
      {
        keyboard: {
          inline_keyboard: [
            [{ text: ru.ownerOrders.paid, callback_data: `adm:ord:paid:${orderId}` }],
            [{ text: ru.ownerOrders.badpay, callback_data: `adm:ord:badpay:${orderId}` }],
          ],
        },
      }
    );
  } else {
    await ctx.port.sendDocument(
      ownerId,
      fileId,
      ru.payment.receiptToOwner(clientLabel, order.number, 'файл'),
      {
        keyboard: {
          inline_keyboard: [
            [{ text: ru.ownerOrders.paid, callback_data: `adm:ord:paid:${orderId}` }],
            [{ text: ru.ownerOrders.badpay, callback_data: `adm:ord:badpay:${orderId}` }],
          ],
        },
      }
    );
  }
}
