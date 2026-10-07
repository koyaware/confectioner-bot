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
import { registerDialogHandlers } from './dialog.js';

const TERMINAL_STATUSES = ['rejected', 'cancelled', 'expired', 'completed'] as const;

async function relayToOwner(ctx: BotContextWithSession): Promise<void> {
  const ownerId = ctx.tenant.ownerTelegramId;
  if (!ownerId) return;
  if (!ctx.from || canAccessOwner(ctx)) return;
  if (ctx.sessionState.startsWith('checkout.') || ctx.sessionState === 'payment.await_receipt')
    return;
  if (ctx.sessionState === 'owner.edit_field' || ctx.sessionState === 'owner.reply_to_customer' || ctx.sessionState === 'owner.dialog')
    return;

  // Customers reach the owner only through an explicit dialog state
  // (rel:start / «Ответить мастеру»). Stray messages are removed with a hint.
  if (ctx.sessionState !== 'relay.compose' && ctx.sessionState !== 'customer.dialog') {
    const messageId = ctx.message?.message_id;
    if (messageId && !canAccessOwner(ctx)) {
      try {
        await ctx.port.deleteMessage(ctx.chat!.id, messageId);
      } catch {
        // already gone
      }
      await ctx.port.sendMessage(ctx.chat!.id, ru.relay.strayHint, {
        keyboard: {
          inline_keyboard: [[{ text: 'Написать мастеру', callback_data: 'rel:start' }]],
        },
      });
    }
    return;
  }

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
      { text: 'Ответить клиенту', callback_data: `adm:ord:dialog:${activeOrders[0].id}:${customer.id}` },
    ]);
  }
  headerKbRows.push([{ text: 'Заблокировать', callback_data: `adm:relay:block:${customer.id}` }]);

  const customerChatId = ctx.chat!.id;
  const text = ctx.message?.text;
  if (text) {
    const combined = await ctx.port.sendMessage(ownerId, `${headerText}\n\n${text}`, {
      keyboard: { inline_keyboard: headerKbRows },
    });
    await db.insert(relayMessages).values({
      id: nanoid(),
      tenantId: ctx.tenant.id,
      customerId: customer.id,
      ownerChatId: ownerId,
      ownerMessageId: combined.messageId,
      customerChatId,
      createdAt: new Date(),
    });
  } else {
    const header = await ctx.port.sendMessage(ownerId, headerText, {
      keyboard: { inline_keyboard: headerKbRows },
    });
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
  }

  await trackFunnelEvent(ctx, 'free_text');

  ctx.sessionState = 'idle';
  try {
    await ctx.port.sendMessage(customerChatId, ru.relay.willAnswerSoon);
  } catch (e) {
    if (e instanceof TelegramError && e.code === 'BLOCKED') {
      await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
    }
  }
}

export function registerRelayHandlers(bot: Bot<BotContextWithSession>): void {
  // Register new dialog handlers
  registerDialogHandlers(bot);

  // Legacy block handler
  bot.callbackQuery(/^adm:relay:block:(.+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
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
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.relay.clientBlocked, {});
    }
  });

  // Legacy relay.compose (fallback)
  bot.callbackQuery(/^rel:start$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = 'relay.compose';
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (chatId) {
      await ctx.port.sendMessage(chatId, ru.relay.composePrompt);
    }
  });

  // Handle legacy owner reply (reply to relay message)
  bot.on('message', async (ctx, next) => {
    if (ctx.sessionState.startsWith('checkout.')) {
      await next();
      return;
    }
    if (ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (canAccessOwner(ctx) && (ctx.sessionState === 'owner.edit_field' || ctx.sessionState === 'owner.reply_to_customer')) {
      await next();
      return;
    }
    if (ctx.message?.text?.startsWith('/')) {
      await next();
      return;
    }

    // Check if owner is replying to a relay message
    if (canAccessOwner(ctx)) {
      const reply = ctx.message?.reply_to_message;
      if (reply) {
        const db = getDb();
        const rows = await db
          .select()
          .from(relayMessages)
          .where(
            and(
              eq(relayMessages.tenantId, ctx.tenant.id),
              eq(relayMessages.ownerChatId, ctx.chat.id),
              eq(relayMessages.ownerMessageId, reply.message_id)
            )
          )
          .limit(1);
        const relay = rows[0];
        if (relay) {
          await ctx.port.copyMessage(relay.customerChatId, ctx.chat.id, ctx.message.message_id);
          await ctx.port.sendMessage(ctx.chat.id, 'Отправлено клиенту.');
          return;
        }
      }
    }

    // Stray customer messages (not in dialog) - delete with hint
    if (!canAccessOwner(ctx) && ctx.sessionState !== 'customer.dialog') {
      await relayToOwner(ctx);
      return;
    }

    await next();
  });
}