import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
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
  if (!ctx.from || ctx.role === 'owner') return;
  if (ctx.sessionState.startsWith('checkout.') || ctx.sessionState === 'payment.await_receipt')
    return;
  if (ctx.sessionState === 'owner.edit_field' || ctx.sessionState === 'owner.reply_to_customer')
    return;

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
    .select({ number: orders.number })
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
  const header = await ctx.port.sendMessage(ownerId, headerText);
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
      await ctx.port.sendMessage(
        customerChatId,
        `Передал мастеру, ответ придет сюда, обычно ${ctx.tenant.replySlaText}.`,
        {
          keyboard: {
            inline_keyboard: [
              [{ text: 'Каталог', callback_data: 'cat:list' }],
              [{ text: 'Мои заказы', callback_data: 'my:list' }],
            ],
          },
        }
      );
    } catch (e) {
      if (e instanceof TelegramError && e.code === 'BLOCKED') {
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
      }
    }
  }
}

export function registerRelayHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^rel:start$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = 'relay.compose';
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (chatId) {
      await ctx.port.sendMessage(chatId, 'Напишите ваш вопрос, передам мастеру.');
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
    if (ctx.role === 'owner' && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (ctx.role === 'owner') {
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
    if (ctx.role === 'owner' && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (ctx.role === 'owner') {
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
    if (ctx.role === 'owner' && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (ctx.role === 'owner') {
      await handleOwnerReply(ctx);
      return;
    }
    await relayToOwner(ctx);
  });
}

async function handleOwnerReply(ctx: BotContextWithSession): Promise<void> {
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
}
