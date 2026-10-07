import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { escapeHtml } from '../../domain/escape.js';
import {
  listActiveCategories,
  getCategoryIfActive,
  listProducts,
  getProductIfOwned,
  listProductOptions,
} from '../../services/catalog.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { trackFunnelEvent } from '../middleware/funnel.js';
import { renderProductCard } from './product-card.js';

export function registerCatalogHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^cat:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (decoded.value.ns === 'cat' && decoded.value.action === 'list') {
      await trackFunnelEvent(ctx, 'catalog_view');
      const cats = await listActiveCategories(ctx.tenant.id);
      const text = cats.length > 0 ? ctx.t.catalog.title : ctx.t.catalog.categoriesEmpty;
      const keyboard: InlineKeyboard = {
        inline_keyboard: [
          ...cats.map((c) => [{ text: c.title, callback_data: `cat:open:${c.id}` }]),
          [{ text: ctx.t.common.toMenu, callback_data: 'nav:menu' }],
        ],
      };
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
        keyboard,
        parseMode: 'HTML',
      });
      return;
    }

    if (decoded.value.ns === 'cat' && decoded.value.action === 'open') {
      const category = await getCategoryIfActive(ctx.tenant.id, decoded.value.arg);
      if (!category) {
        await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.catalog.categoriesEmpty, {
          keyboard: {
            inline_keyboard: [[{ text: ctx.t.catalog.back, callback_data: 'cat:list' }]],
          },
          parseMode: 'HTML',
        });
        return;
      }
      const prods = await listProducts(ctx.tenant.id, category.id);
      const text =
        prods.length > 0
          ? `${ctx.t.catalog.title}: ${escapeHtml(category.title)}`
          : ctx.t.catalog.productsEmpty;
      const rows = prods.map((p) => [{ text: p.title, callback_data: `prd:open:${p.id}` }]);
      rows.push([{ text: ctx.t.catalog.back, callback_data: 'cat:list' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
        parseMode: 'HTML',
      });
      return;
    }
  });

  bot.callbackQuery(/^prd:open:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'prd') return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const product = await getProductIfOwned(ctx.tenant.id, decoded.value.arg);
    if (!product) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.product.notFound, {
        keyboard: {
          inline_keyboard: [[{ text: ctx.t.common.toMenu, callback_data: 'nav:menu' }]],
        },
        parseMode: 'HTML',
      });
      return;
    }

    await trackFunnelEvent(ctx, 'product_view');

    const options = await listProductOptions(product.id);
    await renderProductCard(ctx, product, options, chatId, messageId);
  });
}
