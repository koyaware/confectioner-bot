import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { canAccessOwner } from '../permissions.js';
import { ru } from '../../i18n/ru.js';
import { getDb } from '../../db/client.js';
import { orders, customers } from '../../db/schema.js';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { escapeHtml } from '../../domain/escape.js';
import { trackFunnelEvent } from '../middleware/funnel.js';
import { InlineKeyboard as PortInlineKeyboard } from '../../telegram/port.js';
import { nanoid } from 'nanoid';

const MAX_HISTORY = 20;
const TERMINAL_STATUSES = ['rejected', 'cancelled', 'expired', 'completed'] as const;

interface DialogMessage {
  who: 'owner' | 'customer';
  text: string;
  type?: 'text' | 'photo' | 'document';
  fileId?: string;
  fileName?: string;
}

function getDialogKey(orderId: string, customerId: string): string {
  return `${orderId}:${customerId}`;
}

function getOwnerDialog(ctx: BotContextWithSession, key: string) {
  if (!ctx.session.ownerDialogs) ctx.session.ownerDialogs = {};
  if (!ctx.session.ownerDialogs[key]) {
    ctx.session.ownerDialogs[key] = { messageId: undefined, history: [] };
  }
  return ctx.session.ownerDialogs[key];
}

function getCustomerDialog(ctx: BotContextWithSession) {
  if (!ctx.session.dialogHistory) ctx.session.dialogHistory = [];
  return ctx.session.dialogHistory;
}

function formatHistory(history: DialogMessage[]): string {
  if (history.length === 0) return '';
  return history
    .map((m) => {
      const prefix = m.who === 'owner' ? '👨‍🍳 Мастер' : '👤 Клиент';
      const typeLabel = m.type === 'photo' ? ' [фото]' : m.type === 'document' ? ` [файл: ${m.fileName}]` : '';
      return `${prefix}: ${escapeHtml(m.text)}${typeLabel}`;
    })
    .join('\n\n');
}

function dialogKeyboard(isOwner: boolean, orderId: string): PortInlineKeyboard {
  const backCallback = isOwner ? `adm:ord:view:${orderId}` : 'my:list';
  return {
    inline_keyboard: [
      [{ text: ru.common.back, callback_data: backCallback }],
    ],
  };
}

async function showDialogScreen(
  ctx: BotContextWithSession,
  text: string,
  keyboard: PortInlineKeyboard,
  isOwner: boolean,
  orderId: string
): Promise<number | null> {
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  if (!chatId) return null;

  let messageId: number | undefined;
  if (isOwner) {
    const key = getDialogKey(orderId, '');
    messageId = getOwnerDialog(ctx, key).messageId;
  } else {
    messageId = ctx.session.dialogMessageId;
  }

  if (messageId) {
    try {
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, { keyboard, parseMode: 'HTML' });
      return messageId;
    } catch {
      // message gone, send new
    }
  }

  const sent = await ctx.port.sendMessage(chatId, text, { keyboard, parseMode: 'HTML' });
  if (isOwner) {
    const key = getDialogKey(orderId, '');
    getOwnerDialog(ctx, key).messageId = sent.messageId;
  } else {
    ctx.session.dialogMessageId = sent.messageId;
  }
  return sent.messageId;
}

function appendToDialog(
  ctx: BotContextWithSession,
  orderId: string,
  customerId: string,
  message: DialogMessage,
  isOwner: boolean
): void {
  if (isOwner) {
    const key = getDialogKey(orderId, customerId);
    const dlg = getOwnerDialog(ctx, key);
    dlg.history.push(message);
    if (dlg.history.length > MAX_HISTORY) dlg.history.shift();
  } else {
    const history = getCustomerDialog(ctx);
    history.push(message);
    if (history.length > MAX_HISTORY) history.shift();
  }
}

async function updateOwnerDialogScreen(
  ctx: BotContextWithSession,
  orderId: string,
  customerId: string,
  customer: { firstName?: string | null; username?: string | null },
  order: { number: number }
): Promise<void> {
  const key = getDialogKey(orderId, customerId);
  const dlg = getOwnerDialog(ctx, key);
  const historyText = formatHistory(dlg.history);
  const header = `💬 Диалог с ${customer.firstName ?? 'Гость'}${customer.username ? ` (@${customer.username})` : ''}, заказ №${order.number}`;
  const text = `${header}\n\n${historyText}\n\n—\nНапишите сообщение:`;
  await showDialogScreen(ctx, text, dialogKeyboard(true, orderId), true, orderId);
}

async function updateCustomerDialogScreen(
  ctx: BotContextWithSession,
  orderId: string,
  orderNumber: number
): Promise<void> {
  const history = getCustomerDialog(ctx);
  const historyText = formatHistory(history);
  const header = `💬 Диалог по заказу №${orderNumber}`;
  const text = `${header}\n\n${historyText}\n\n—\nНапишите сообщение мастеру:`;
  await showDialogScreen(ctx, text, dialogKeyboard(false, orderId), false, orderId);
}

async function openOwnerDialog(
  ctx: BotContextWithSession,
  orderId: string,
  customerId: string
): Promise<void> {
  const db = getDb();
  const orderRows = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenant.id))).limit(1);
  const order = orderRows[0];
  if (!order) return;

  const customerRows = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  const customer = customerRows[0];
  if (!customer) return;

  const key = getDialogKey(orderId, customerId);
  const dlg = getOwnerDialog(ctx, key);

  const historyText = formatHistory(dlg.history);
  const header = `💬 Диалог с ${customer.firstName ?? 'Гость'}${customer.username ? ` (@${customer.username})` : ''}, заказ №${order.number}`;
  const text = historyText ? `${header}\n\n${historyText}\n\n—\nНапишите сообщение:` : `${header}\n\nНапишите сообщение:`;

  await showDialogScreen(ctx, text, dialogKeyboard(true, orderId), true, orderId);
  ctx.sessionState = 'owner.dialog';
  ctx.session.ownerDraft = { kind: 'ord_dialog', targetId: orderId, extra: { customerId } };
}

async function openCustomerDialog(
  ctx: BotContextWithSession,
  orderId: string
): Promise<void> {
  const db = getDb();
  const orderRows = await db
    .select({ order: orders, customer: customers })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenant.id)))
    .limit(1);
  const found = orderRows[0];
  if (!found) return;

  const history = getCustomerDialog(ctx);
  const historyText = formatHistory(history);
  const header = `💬 Диалог по заказу №${found.order.number}`;
  const text = historyText ? `${header}\n\n${historyText}\n\n—\nНапишите сообщение мастеру:` : `${header}\n\nНапишите сообщение мастеру:`;

  await showDialogScreen(ctx, text, dialogKeyboard(false, orderId), false, orderId);
  ctx.sessionState = 'customer.dialog';
}

async function handleOwnerDialogMessage(ctx: BotContextWithSession): Promise<boolean> {
  if (ctx.sessionState !== 'owner.dialog') return false;
  const draft = ctx.session.ownerDraft;
  if (!draft || draft.kind !== 'ord_dialog') return false;

  const orderId = draft.targetId;
  const customerId = draft.extra?.customerId;
  if (!orderId || !customerId) return false;

  const db = getDb();
  const orderRows = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenant.id))).limit(1);
  const order = orderRows[0];
  if (!order) return false;

  const customerRows = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  const customer = customerRows[0];
  if (!customer) return false;

  const msg = ctx.message;
  let message: DialogMessage;

  if (msg?.text) {
    message = { who: 'owner', text: msg.text, type: 'text' };
  } else if (msg?.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1]!;
    message = { who: 'owner', text: msg.caption ?? '', type: 'photo', fileId: photo.file_id };
  } else if (msg?.document) {
    message = { who: 'owner', text: msg.caption ?? '', type: 'document', fileId: msg.document.file_id, fileName: msg.document.file_name };
  } else {
    return false;
  }

  // Add to both owner's and customer's history
  appendToDialog(ctx, orderId, customerId, message, true);
  // Also add to customer's history if they have dialog open
  // We'll update customer's screen below

  // Update owner's dialog screen
  await updateOwnerDialogScreen(ctx, orderId, customerId, customer, order);

  // Update customer's dialog screen (single-screen: edit their dialog message)
  const replyKb = { inline_keyboard: [[{ text: 'Ответить мастеру', callback_data: `rel:dialog:${orderId}` }]] };
  try {
    // Send a notification to customer's chat, but also update their dialog screen
    const customerChatId = customer.telegramId;
    const history = getCustomerDialog(ctx);
    // Add owner's message to customer's history
    history.push(message);
    if (history.length > MAX_HISTORY) history.shift();

    const customerHistoryText = formatHistory(history);
    const customerHeader = `💬 Диалог по заказу №${order.number}`;
    const customerText = `${customerHeader}\n\n${customerHistoryText}\n\n—\nНапишите сообщение мастеру:`;

    // Update customer's dialog screen if they have one open
    if (customer.isBlocked || customer.botBlocked) {
      // Can't send message
      await ctx.port.sendMessage(ctx.chat!.id, '⚠️ Клиент заблокировал бота. Сообщение не доставлено.');
    } else {
      // Try to edit customer's dialog screen
      const customerDialogMsgId = ctx.session.dialogMessageId;
      let updated = false;
      if (customerDialogMsgId) {
        try {
          await ctx.port.editMessageTextOrSend(customerChatId, customerDialogMsgId, customerText, {
            keyboard: replyKb,
            parseMode: 'HTML',
          });
          updated = true;
        } catch {
          // dialog message not found or can't edit
        }
      }
      if (!updated) {
        // Send new dialog message to customer
        const sent = await ctx.port.sendMessage(customerChatId, customerText, {
          keyboard: replyKb,
          parseMode: 'HTML',
        });
        // Store the dialog message ID for future updates
        ctx.session.dialogMessageId = sent.messageId;
      }
    }
  } catch (e) {
    const err = e as { code?: string; description?: string };
    if (err.code === 'BLOCKED' || err.description?.includes('blocked')) {
      const db = getDb();
      await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
      await ctx.port.sendMessage(ctx.chat!.id, '⚠️ Клиент заблокировал бота.');
    }
  }

  await trackFunnelEvent(ctx, 'free_text');
  return true;
}

async function handleCustomerDialogMessage(ctx: BotContextWithSession): Promise<boolean> {
  if (ctx.sessionState !== 'customer.dialog') return false;

  // Get customer
  const db = getDb();
  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenant.id), eq(customers.telegramId, ctx.from!.id)))
    .limit(1);
  if (customerRows.length === 0) return false;
  const customer = customerRows[0]!;
  if (customer.isBlocked) return false;

  // Find active order (optional)
  const activeOrders = await db
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        eq(orders.tenantId, ctx.tenant.id),
        notInArray(orders.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  const order = activeOrders[0];

  const msg = ctx.message;
  let message: DialogMessage;

  if (msg?.text) {
    message = { who: 'customer', text: msg.text, type: 'text' };
  } else if (msg?.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1]!;
    message = { who: 'customer', text: msg.caption ?? '', type: 'photo', fileId: photo.file_id };
  } else if (msg?.document) {
    message = { who: 'customer', text: msg.caption ?? '', type: 'document', fileId: msg.document.file_id, fileName: msg.document.file_name };
  } else {
    return false;
  }

  const orderId = order?.id ?? '';
  appendToDialog(ctx, orderId, customer.id, message, false);

  // Update customer's dialog screen
  const orderNumber = order?.number ?? 0;
  await updateCustomerDialogScreen(ctx, orderId, orderNumber);

  // Send to owner (notification with reply button)
  const ownerId = ctx.tenant.ownerTelegramId;
  if (ownerId) {
    const headerText = order
      ? `${customer.firstName ?? 'Гость'}${customer.username ? ` (@${customer.username})` : ''}, заказ №${order.number}`
      : `${customer.firstName ?? 'Гость'}${customer.username ? ` (@${customer.username})` : ''} (нет активного заказа)`;
    const replyKb = order
      ? { inline_keyboard: [[{ text: 'Ответить клиенту', callback_data: `adm:ord:dialog:${order.id}:${customer.id}` }]] }
      : { inline_keyboard: [[{ text: 'Ответить клиенту', callback_data: `adm:ord:dialog::${customer.id}` }]] };
    try {
      if (message.type === 'text') {
        await ctx.port.sendMessage(ownerId, `${headerText}\n\n${message.text}`, { keyboard: replyKb });
      } else if (message.type === 'photo') {
        await ctx.port.sendPhoto(ownerId, message.fileId!, `${headerText}\n\n${message.text}`, { keyboard: replyKb });
      } else if (message.type === 'document') {
        await ctx.port.sendDocument(ownerId, message.fileId!, `${headerText}\n\n${message.text}`, { keyboard: replyKb });
      }
    } catch (e) {
      const err = e as { code?: string; description?: string };
      if (err.code === 'BLOCKED' || err.description?.includes('blocked')) {
        const db = getDb();
        await db.update(customers).set({ botBlocked: true }).where(eq(customers.id, customer.id));
      }
    }
  }

  await trackFunnelEvent(ctx, 'free_text');
  return true;
}

async function handleOwnerDialogCallback(ctx: BotContextWithSession): Promise<boolean> {
  if (!ctx.callbackQuery?.data || !ctx.callbackQuery.id) return false;
  const m = ctx.callbackQuery.data.match(/^adm:ord:dialog:([A-Za-z0-9_-]+):(.+)$/);
  if (!m) return false;

  await ctx.port.answerCallback(ctx.callbackQuery.id);
  const orderId = m[1]!;
  const customerId = m[2]!;
  await openOwnerDialog(ctx, orderId, customerId);
  return true;
}

async function handleCustomerDialogCallback(ctx: BotContextWithSession): Promise<boolean> {
  if (!ctx.callbackQuery?.data || !ctx.callbackQuery.id) return false;
  const m = ctx.callbackQuery.data.match(/^rel:dialog:([A-Za-z0-9_-]+)$/);
  if (!m) return false;

  await ctx.port.answerCallback(ctx.callbackQuery.id);
  const orderId = m[1]!;
  await openCustomerDialog(ctx, orderId);
  return true;
}

async function handleCustomerDialogStart(ctx: BotContextWithSession): Promise<boolean> {
  if (!ctx.callbackQuery?.data || !ctx.callbackQuery.id || ctx.callbackQuery.data !== 'rel:start') return false;
  if (!ctx.from) return false;

  await ctx.port.answerCallback(ctx.callbackQuery.id);

  // Get or create customer
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
  const customer = customerRows[0]!;
  if (customer.isBlocked) return false;

  // Find active order (optional)
  const activeOrders = await db
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        eq(orders.tenantId, ctx.tenant.id),
        notInArray(orders.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  const order = activeOrders[0];

  if (order) {
    await openCustomerDialog(ctx, order.id);
  } else {
    // Open dialog without order context
    const history = getCustomerDialog(ctx);
    const historyText = formatHistory(history);
    const header = `💬 Диалог с мастером`;
    const text = historyText ? `${header}\n\n${historyText}\n\n—\nНапишите сообщение мастеру:` : `${header}\n\nНапишите сообщение мастеру:`;
    await showDialogScreen(ctx, text, dialogKeyboard(false, ''), false, '');
    ctx.sessionState = 'customer.dialog';
  }
  return true;
}

function closeOwnerDialog(ctx: BotContextWithSession, orderId: string): void {
  const key = getDialogKey(orderId, '');
  if (ctx.session.ownerDialogs) {
    delete ctx.session.ownerDialogs[key];
  }
  ctx.sessionState = 'idle';
  ctx.session.ownerDraft = undefined;
}

function closeCustomerDialog(ctx: BotContextWithSession): void {
  ctx.session.dialogHistory = undefined;
  ctx.session.dialogMessageId = undefined;
  ctx.sessionState = 'idle';
}

export function registerDialogHandlers(bot: Bot<BotContextWithSession>): void {
  // Owner opens dialog from order card
  bot.callbackQuery(/^adm:ord:msg:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:msg:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const db = getDb();
    const orderRows = await db.select().from(orders).where(eq(orders.id, m[1]!)).limit(1);
    const order = orderRows[0];
    if (!order || order.tenantId !== ctx.tenant.id) return;

    await openOwnerDialog(ctx, order.id, order.customerId);
  });

  // Owner replies from notification (adm:ord:dialog:orderId:customerId)
  bot.callbackQuery(/^adm:ord:dialog:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await handleOwnerDialogCallback(ctx);
  });

  // Customer starts dialog via "Reply to master" button
  bot.callbackQuery(/^rel:start$/, async (ctx) => {
    await handleCustomerDialogStart(ctx);
  });

  // Customer opens dialog from notification (rel:dialog:orderId)
  bot.callbackQuery(/^rel:dialog:/, async (ctx) => {
    await handleCustomerDialogCallback(ctx);
  });

  // Owner sends message in dialog
  bot.on('message', async (ctx, next) => {
    if (canAccessOwner(ctx)) {
      const handled = await handleOwnerDialogMessage(ctx);
      if (handled) return;
    }
    await next();
  });

  // Customer sends message in dialog
  bot.on('message', async (ctx, next) => {
    if (!canAccessOwner(ctx)) {
      const handled = await handleCustomerDialogMessage(ctx);
      if (handled) return;
    }
    await next();
  });

  // Back button handlers
  bot.callbackQuery(/^adm:ord:view:/, (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const m = /^adm:ord:view:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (m && ctx.sessionState === 'owner.dialog') {
      closeOwnerDialog(ctx, m[1]!);
    }
  });

  bot.callbackQuery(/^my:list$/, (ctx) => {
    if (ctx.sessionState === 'customer.dialog') {
      closeCustomerDialog(ctx);
    }
  });
}

export { openOwnerDialog, openCustomerDialog, closeOwnerDialog, closeCustomerDialog };