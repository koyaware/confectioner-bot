import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';

const POINTER_INTERVAL_S = 6 * 3600;

export function buildContactsText(ctx: BotContextWithSession): string {
  const body = ctx.tenant.contactsText?.trim() || ctx.t.contacts.empty;
  return `${ctx.t.contacts.title}\n\n${body}`;
}

export function registerContactsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^cnt:show$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;
    await ctx.port.editMessageTextOrSend(chatId, messageId, buildContactsText(ctx), {
      keyboard: {
        inline_keyboard: [[{ text: ctx.t.common.back, callback_data: 'nav:menu' }]],
      },
    });
  });

  // Free text outside any scenario: point to contacts, rate-limited.
  // There is no chat with the master in this bot (phone/PM only).
  bot.on('message', async (ctx, next) => {
    if (canAccessOwner(ctx)) {
      await next();
      return;
    }
    if (ctx.sessionState.startsWith('checkout.')) {
      await next();
      return;
    }
    if (ctx.sessionState === 'payment.await_receipt') {
      await next();
      return;
    }
    if (ctx.message?.text?.startsWith('/')) {
      await next();
      return;
    }
    const m = ctx.message;
    if (!m || (!m.text && !m.photo && !m.document && !m.voice && !m.video)) {
      await next();
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (now - (ctx.session.lastAutoReplyAt ?? 0) < POINTER_INTERVAL_S) return;
    ctx.session.lastAutoReplyAt = now;
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await ctx.port.sendMessage(chatId, buildContactsText(ctx), {
      keyboard: {
        inline_keyboard: [[{ text: ctx.t.common.toMenu, callback_data: 'nav:menu' }]],
      },
    });
  });
}
