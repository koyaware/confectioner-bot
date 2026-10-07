import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { getDb } from '../../db/client.js';
import { customers, orders, relayMessages } from '../../db/schema.js';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { TelegramError } from '../../telegram/port.js';
import { trackFunnelEvent } from '../middleware/funnel.js';
import { nanoid } from 'nanoid';

const AUTO_REPLY_INTERVAL_S = 6 * 3600;
const TERMINAL_STATUSES = ['rejected', 'cancelled', 'expired', 'completed'] as const;

async function relayToOwner(ctx: BotContextWithSession): Promise<void> {
  const ownerId = ctx.tenant.ownerTelegramId;
  if (!ownerId) return;
  if (!ctx.from || canAccessOwner(ctx)) return;
  if (ctx.sessionState.startsWith('checkout.') || ctx.sessionState === 'payment.await_receipt')
    return;
  if (ctx.sessionState === 'owner.edit_field' || ctx.sessionState === 'owner.reply_to_customer')
    return;

  const wasCompose = ctx.sessionState === 'relay.compose';
  const db = getDb();
  let customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenant.id), eq(customers.telegramId, ctx.from.id)))
    .limit(1);
  if (customerRows.length === 0) {
    const id = nanoid();
    const now = new Date();
    await db.insert(customers).values({
      id,
      tenantId: ctx.tenant.id,
      telegramId: ctx.from.id,
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      source: null,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    customerRows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  }
  const customer = customerRows[0];
  if (!customer || customer.isBlocked) return;

  // Find active order for context
  const activeOrders = await db
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(customers.telegramId, ctx.from.id),
        eq(orders.tenantId, ctx.tenant.id),
        notInArray(orders.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  const orderLabel = activeOrders[0] ? `, заказ №${activeOrders[0].number}` : '';

  const headerText = `${customer.firstName ?? 'Гость'}${customer.username ? ` (@${customer.username})` : ''}${orderLabel}`;
  const headerKbRows: { text: string; callback_data: string }[][] = [];
  if (activeOrders[0]) {
    headerKbRows.push([
      { text: 'Ответить клиенту', callback_data: `adm:ord:msg:${activeOrders[0].id}` },
    ]);
  }
  headerKbRows.push([{ text: 'Заблокировать', callback_data: `adm:relay:block:${customer.id}` }]);
  const header = await ctx.port.sendMessage(ownerId, headerText, {
    keyboard: { inline_keyboard: headerKbRows },
  });
  const customerChatId = ctx.chat!.id;

  await db.insert(relayMessages).values({
    id: nanoid(),
    tenantId: ctx.tenant.id,
    customerId: customer.id,
    ownerChatId: ownerId,
    ownerMessageId: header.messageId,
    customerChatId,
    createdAt: new Date(),
  });

  const srcMessageId = ctx.message?.message_id;
  if (srcMessageId) {
    const copy = await ctx.port.copyMessage(ownerId, customerChatId, srcMessageId);
    await db.insert(relayMessages).values({
      id: nanoid(),
      tenantId: ctx.tenant.id,
      customerId: customer.id,
      ownerChatId: ownerId,
      ownerMessageId: copy.messageId,
      customerChatId,
      createdAt: new Date(),
    });
  }

  await trackFunnelEvent(ctx, 'free_text');

  if (wasCompose) {
    ctx.sessionState = 'idle';
    try {
      await ctx.port.sendMessage(customerChatId, ru.relay.willAnswerSoon);
    } catch (e) {
      if (e instanceof TelegramError && e.code === 'BLOCKED') {
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
      }
    }
    return;
  }

  // Auto-reply once per 6 hours
  const nowS = Math.floor(Date.now() / 1000);
  const shouldReply =
    !customer.lastSeenAt ||
    !ctx.session.lastAutoReplyAt ||
    nowS - ctx.session.lastAutoReplyAt >= AUTO_REPLY_INTERVAL_S;
  if (shouldReply) {
    ctx.session.lastAutoReplyAt = nowS;
    await db.update(customers).set({ lastSeenAt: new Date() }).where(eq(customers.id, customer.id));
    try {
      await ctx.port.sendMessage(customerChatId, ru.relay.forwarded(ctx.tenant.replySlaText), {
        keyboard: {
          inline_keyboard: [
            [{ text: 'Каталог', callback_data: 'cat:list' }],
            [{ text: 'Мои заказы', callback_data: 'my:list' }],
          ],
        },
      });
    } catch (e) {
      if (e instanceof TelegramError && e.code === 'BLOCKED') {
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
      }
    }
  }
}

export function registerRelayHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:relay:block:(.+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, 'Только владелец.');
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:relay:block:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const db = getDb();
    await db
      .update(customers)
      .set({ isBlocked: true })
      .where(and(eq(customers.id, m[1]!), eq(customers.tenantId, ctx.tenant.id)));

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageText(chatId, messageId, ru.relay.clientBlocked, {});
    }
  });

  bot.callbackQuery(/^rel:start$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = 'relay.compose';
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (chatId) {
      await ctx.port.sendMessage(chatId, ru.relay.composePrompt);
    }
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.sessionState.startsWith('checkout.')) {
      await next();
      return;
    }
    if (ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (canAccessOwner(ctx) && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (ctx.message?.text?.startsWith('/')) {
      await next();
      return;
    }
    if (canAccessOwner(ctx)) {
      await handleOwnerReply(ctx);
      return;
    }
    await relayToOwner(ctx);
  });

  bot.on('message:photo', async (ctx, next) => {
    if (ctx.sessionState === 'checkout.photos' || ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (canAccessOwner(ctx) && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (canAccessOwner(ctx)) {
      await handleOwnerReply(ctx);
      return;
    }
    await relayToOwner(ctx);
  });

  bot.on('message:voice', async (ctx, next) => {
    if (ctx.sessionState === 'checkout.photos' || ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (canAccessOwner(ctx) && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (canAccessOwner(ctx)) {
      await handleOwnerReply(ctx);
      return;
    }
    await relayToOwner(ctx);
  });

  bot.on('message:document', async (ctx, next) => {
    if (ctx.sessionState === 'checkout.photos' || ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (canAccessOwner(ctx) && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (canAccessOwner(ctx)) {
      await handleOwnerReply(ctx);
      return;
    }
    await relayToOwner(ctx);
  });
}

async function handleOwnerReply(ctx: BotContextWithSession): Promise<void> {
  if (
    ctx.sessionState === 'owner.reply_to_customer' &&
    ctx.session.ownerDraft?.kind === 'ord_msg'
  ) {
    const orderId = ctx.session.ownerDraft.targetId;
    if (!orderId) return;

    const db = getDb();
    const orderRows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenant.id)))
      .limit(1);
    const order = orderRows[0];
    if (!order) return;

    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);
    const customer = customerRows[0];
    if (!customer) return;

    const msg = ctx.message;
    const replyKb = {
      inline_keyboard: [[{ text: 'Ответить мастеру', callback_data: 'rel:start' }]],
    };
    if (msg?.text) {
      await ctx.port.sendMessage(customer.telegramId, msg.text, { keyboard: replyKb });
    } else if (msg?.photo?.length) {
      await ctx.port.sendPhoto(
        customer.telegramId,
        msg.photo[msg.photo.length - 1]!.file_id,
        msg.caption,
        { keyboard: replyKb }
      );
    } else if (msg?.document) {
      await ctx.port.sendDocument(customer.telegramId, msg.document.file_id, msg.caption, {
        keyboard: replyKb,
      });
    } else {
      await ctx.port.copyMessage(customer.telegramId, ctx.chat!.id, msg!.message_id);
    }

    await ctx.port.sendMessage(ctx.chat!.id, ru.relay.sentToClient, {
      keyboard: {
        inline_keyboard: [[{ text: 'Написать снова', callback_data: `adm:ord:msg:${orderId}` }]],
      },
    });

    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    return;
  }

  const reply = ctx.message?.reply_to_message;
  if (!reply) return;

  const db = getDb();
  const rows = await db
    .select()
    .from(relayMessages)
    .where(
      and(
        eq(relayMessages.tenantId, ctx.tenant.id),
        eq(relayMessages.ownerChatId, ctx.chat!.id),
        eq(relayMessages.ownerMessageId, reply.message_id)
      )
    )
    .limit(1);
  const relay = rows[0];
  if (!relay) return;

  await ctx.port.copyMessage(relay.customerChatId, ctx.chat!.id, ctx.message.message_id);
  await ctx.port.sendMessage(ctx.chat!.id, 'Отправлено клиенту.');
}
