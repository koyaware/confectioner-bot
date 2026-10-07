import { BotContextWithSession } from '../context.js';

/**
 * Reply keyboard with a contact-share button for the checkout.contact step.
 * The keyboard lives on its own transient message (reply markups cannot be
 * edited, only sent). The message id is tracked in the session so every
 * exit path from the step removes both the message and the keyboard,
 * keeping the chat on a single screen.
 */
export async function sendContactKeyboard(ctx: BotContextWithSession): Promise<void> {
  if (ctx.session.contactKbMsgId !== undefined) return;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  if (!chatId) return;
  const sent = await ctx.port.sendMessage(chatId, ctx.t.checkout.contactKbHint, {
    replyKeyboard: [[{ text: ctx.t.checkout.shareContact, requestContact: true }]],
  });
  ctx.session.contactKbMsgId = sent.messageId;
}

export async function clearContactKeyboard(ctx: BotContextWithSession): Promise<void> {
  const kbId = ctx.session.contactKbMsgId;
  ctx.session.contactKbMsgId = undefined;
  if (kbId === undefined) return;
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  try {
    await ctx.port.deleteMessage(chatId, kbId);
  } catch {
    // already gone
  }
  // A deleted message does not hide the keyboard: remove it via a
  // transient marker that is deleted right away.
  try {
    const marker = await ctx.port.sendMessage(chatId, '.', { removeKeyboard: true });
    try {
      await ctx.port.deleteMessage(chatId, marker.messageId);
    } catch {
      // already gone
    }
  } catch {
    // best effort
  }
}
