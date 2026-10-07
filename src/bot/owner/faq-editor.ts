import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { escapeHtml } from '../../domain/escape.js';
import { listFaq, getFaq, deleteFaq } from '../../services/faq.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { beginOwnerDraft } from './edit-field.js';

export function registerOwnerFaqHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:faq:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'adm' || decoded.value.area !== 'faq') return;
    const { action, arg } = decoded.value;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (action === 'list') {
      const items = await listFaq(ctx.tenant.id);
      const rows: InlineKeyboard['inline_keyboard'] = items.map((f) => [
        { text: f.question, callback_data: `adm:faq:edit:${f.id}` },
      ]);
      rows.push([{ text: ctx.t.ownerFaq.add, callback_data: 'adm:faq:add' }]);
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:menu' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerFaq.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (action === 'add') {
      beginOwnerDraft(ctx, { kind: 'faq_add_question' });
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerFaq.promptQuestion);
      return;
    }

    if (action === 'edit' && arg) {
      const item = await getFaq(ctx.tenant.id, arg);
      if (!item) return;
      const rows: InlineKeyboard['inline_keyboard'] = [
        [{ text: ctx.t.ownerFaq.editQuestion, callback_data: `adm:faq:q:${arg}` }],
        [{ text: ctx.t.ownerFaq.editAnswer, callback_data: `adm:faq:a:${arg}` }],
        [{ text: ctx.t.ownerFaq.delete, callback_data: `adm:faq:del:${arg}` }],
        [{ text: ctx.t.catalog.back, callback_data: 'adm:faq:list' }],
      ];
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `<b>${escapeHtml(item.question)}</b>\n\n${escapeHtml(item.answer)}`,
        { keyboard: { inline_keyboard: rows }, parseMode: 'HTML' }
      );
      return;
    }

    if (action === 'q' && arg) {
      beginOwnerDraft(ctx, { kind: 'faq_edit_q', targetId: arg });
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerFaq.promptQuestion);
      return;
    }

    if (action === 'a' && arg) {
      beginOwnerDraft(ctx, { kind: 'faq_edit_a', targetId: arg });
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerFaq.promptAnswer);
      return;
    }

    if (action === 'del' && arg) {
      await deleteFaq(ctx.tenant.id, arg);
      const items = await listFaq(ctx.tenant.id);
      const rows: InlineKeyboard['inline_keyboard'] = items.map((f) => [
        { text: f.question, callback_data: `adm:faq:edit:${f.id}` },
      ]);
      rows.push([{ text: ctx.t.ownerFaq.add, callback_data: 'adm:faq:add' }]);
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:menu' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerFaq.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }
  });
}
