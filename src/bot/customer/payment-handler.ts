import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { getDb } from '../../db/client.js';
import { customers, orders, orderAttachments, tenants } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { applyOrderEvent, getCustomerOrderNumber } from '../../services/orders.js';
import { buildOrderCardText } from '../owner/orders.js';
import { formatMinor } from '../../lib/money.js';
import { TelegramPort } from '../../telegram/port.js';
import { stringsFor, localeFor } from '../../i18n/index.js';
import { escapeHtml } from '../../domain/escape.js';
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

  const t = stringsFor(tenant.language);
  const customerNumber = (await getCustomerOrderNumber(orderId)) ?? order.number;
  const deadline = order.paymentDueAt
    ? new Intl.DateTimeFormat(localeFor(tenant.language), {
        timeZone: tenant.timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(order.paymentDueAt))
    : '—';
  const card =
    t.payment.accepted(customerNumber) +
    '\n\n' +
    t.checkout.confirmPrepay(formatMinor(order.prepaymentMinor, tenant.currency)) +
    '\n\n' +
    `${tenant.paymentText ? escapeHtml(tenant.paymentText) : t.payment.noRequisites}` +
    '\n\n' +
    t.payment.payCall(t.payment.paidButton, deadline);

  await port.sendMessage(customer.telegramId, card, {
    keyboard: {
      inline_keyboard: [[{ text: t.payment.paidButton, callback_data: `pay:sent:${orderId}` }]],
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
      const messageId = ctx.callbackQuery.message?.message_id;
      if (chatId && messageId) {
        await ctx.port.editMessageTextOrSend(
          chatId,
          messageId,
          order.status === 'payment_review'
            ? ctx.t.payment.alreadyReview
            : ctx.t.payment.notAwaiting,
          {}
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
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.payment.promptReceipt, {});
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
        ctx.t.payment.invalidReceipt,
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
    await handleReceipt(ctx, photo.file_id);
  });

  bot.on('message:document', async (ctx, next) => {
    if (ctx.sessionState !== 'payment.await_receipt') {
      await next();
      return;
    }
    // Receipts are photo-only by contract (v1.30). Reference attachments
    // in checkout still accept documents.
    await deleteUserMessage(ctx);
    const screen = receiptScreen(ctx);
    if (screen) {
      await ctx.port.editMessageTextOrSend(
        screen.chatId,
        screen.messageId,
        ctx.t.payment.invalidReceipt,
        {}
      );
    }
  });

  bot.on('message', async (ctx, next) => {
    if (ctx.sessionState !== 'payment.await_receipt') {
      await next();
      return;
    }
    const m = ctx.message;
    // Text/photo/document/contact have dedicated handlers above; anything
    // else (sticker, voice, video, ...) is not a receipt either.
    if (!m || m.text || m.photo || m.document || m.contact) {
      await next();
      return;
    }
    await deleteUserMessage(ctx);
    const screen = receiptScreen(ctx);
    if (screen) {
      await ctx.port.editMessageTextOrSend(
        screen.chatId,
        screen.messageId,
        ctx.t.payment.invalidReceipt,
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

async function handleReceipt(ctx: BotContextWithSession, fileId: string): Promise<void> {
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
        ctx.t.payment.failed,
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
    fileType: ctx.message?.photo ? 'photo' : 'document',
    createdAt: new Date(),
  });

  await deleteUserMessage(ctx);
  const screen = receiptScreen(ctx);
  ctx.session.paymentScreenId = undefined;
  if (screen) {
    await ctx.port.editMessageTextOrSend(
      screen.chatId,
      screen.messageId,
      ctx.t.payment.receiptSent,
      {
        keyboard: {
          inline_keyboard: [[{ text: ctx.t.menu.customerTitle, callback_data: 'nav:menu' }]],
        },
      }
    );
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
    ? `${customer.firstName ?? ctx.t.orderCard.clientDefault}${customer.username ? ` (@${customer.username})` : ''}`
    : ctx.t.orderCard.clientDefault;

  // Get the original order card message ID
  const ownerCardMessageId = order.ownerCardMessageId;

  const receiptPhoto = ctx.message?.photo?.[ctx.message.photo.length - 1];
  if (!receiptPhoto) return;

  if (!ownerCardMessageId) {
    // Fallback: send new message if no stored message ID
    await ctx.port.sendPhoto(
      ownerId,
      receiptPhoto.file_id,
      ctx.t.payment.receiptToOwner(clientLabel, order.number, ctx.t.payment.kindPhoto),
      {
        keyboard: {
          inline_keyboard: [
            [{ text: ctx.t.ownerOrders.paid, callback_data: `adm:ord:paid:${order.id}` }],
            [{ text: ctx.t.ownerOrders.badpay, callback_data: `adm:ord:badpay:${order.id}` }],
          ],
        },
      }
    );
    return;
  }

  // Send the receipt photo to the owner with receipt info and paid/badpay buttons.
  // The photo forward and the card update are independent: send together.
  const receiptCaption = `${ctx.t.payment.receiptReceived(ctx.t.payment.kindPhoto)}\n\n${await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency, ctx.tenant.language)}`;
  const receiptKeyboard = {
    inline_keyboard: [
      [{ text: ctx.t.ownerOrders.paid, callback_data: `adm:ord:paid:${order.id}` }],
      [{ text: ctx.t.ownerOrders.badpay, callback_data: `adm:ord:badpay:${order.id}` }],
    ],
  };

  // Also update the original order card message to show receipt status
  const card = await buildOrderCardText(
    orderId,
    ctx.tenant.id,
    ctx.tenant.currency,
    ctx.tenant.language
  );
  const cardEdit = card
    ? ctx.port.editMessageTextOrSend(
        ownerId,
        ownerCardMessageId,
        `${card}\n\n${ctx.t.payment.receiptReceived(ctx.t.payment.kindPhoto)}`,
        { keyboard: receiptKeyboard, parseMode: 'HTML' }
      )
    : Promise.resolve();

  await Promise.all([
    ctx.port.sendPhoto(ownerId, receiptPhoto.file_id, receiptCaption, {
      keyboard: receiptKeyboard,
      parseMode: 'HTML',
    }),
    cardEdit,
  ]);
}
