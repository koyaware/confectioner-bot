import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { listFaq, getFaq } from '../../services/faq.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { trackFunnelEvent } from '../middleware/funnel.js';

export function registerFaqHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^faq:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'faq') return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (decoded.value.action === 'list') {
      await trackFunnelEvent(ctx, 'faq_view');
      const items = await listFaq(ctx.tenant.id);
      const rows: InlineKeyboard['inline_keyboard'] = items.map((f) => [
        { text: f.question, callback_data: `faq:view:${f.id}` },
      ]);
      const text = items.length > 0 ? ru.faq.title : ru.faq.empty;
      rows.push([{ text: ru.faq.ask, callback_data: 'rel:start' }]);
      rows.push([{ text: 'В меню', callback_data: 'nav:menu' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (decoded.value.action === 'view') {
      const item = await getFaq(ctx.tenant.id, decoded.value.arg);
      if (!item) {
        await ctx.port.editMessageTextOrSend(chatId, messageId, ru.faq.notFound, {
          keyboard: { inline_keyboard: [[{ text: ru.catalog.back, callback_data: 'faq:list' }]] },
        });
        return;
      }
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `<b>${escapeHtml(item.question)}</b>\n\n${escapeHtml(item.answer)}`,
        {
          keyboard: {
            inline_keyboard: [[{ text: ru.catalog.back, callback_data: 'faq:list' }]],
          },
          parseMode: 'HTML',
        }
      );
      return;
    }
  });
}
