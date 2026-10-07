import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { getProductById, listProductOptions } from '../../services/catalog.js';
import { priceLine, priceOrder } from '../../domain/pricing.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { CartLine } from '../../types.js';
import { nanoid } from 'nanoid';
import { trackFunnelEvent } from '../middleware/funnel.js';
import { resolveSelections, renderProductCard } from './product-card.js';
import { getDateAvailability } from '../../services/dates.js';
import { calendarKeyboard } from './checkout.js';
import { addDays, toIsoDate } from '../../lib/time.js';

async function cartKeyboard(
  ctx: BotContextWithSession
): Promise<{ text: string; rows: InlineKeyboard['inline_keyboard'] }> {
  const lines = ctx.session.cart.lines;
  const rows: InlineKeyboard['inline_keyboard'] = [];

  const texts: string[] = [];
  let lineTotal = 0;

  for (const line of lines) {
    const product = await getProductById(ctx.tenant.id, line.productId);
    if (!product) continue;
    const options = await listProductOptions(line.productId);
    const selected = options.filter((o) => line.optionIds.includes(o.id));
    const price = priceLine(
      product.priceMinor,
      selected.map((o) => o.priceDeltaMinor),
      line.qty
    );
    lineTotal += price;
    const optionLabel =
      selected.length > 0 ? selected.map((o) => `${o.groupTitle}: ${o.title}`).join(', ') : '';
    texts.push(
      `• ${escapeHtml(product.title)}${optionLabel ? ` (${escapeHtml(optionLabel)})` : ''} × ${line.qty} — ${formatMinor(price, ctx.tenant.currency)}`
    );
    rows.push([
      { text: '−', callback_data: `cart:dec:${line.lineId}` },
      { text: String(line.qty), callback_data: `cart:open:${line.lineId}` },
      { text: '+', callback_data: `cart:inc:${line.lineId}` },
    ]);
  }

  if (lines.length === 0) {
    return { text: ru.cart.empty, rows: [[{ text: 'В меню', callback_data: 'nav:menu' }]] };
  }

  const order = priceOrder([lineTotal], 0, 0);
  texts.push('');
  texts.push(`${ru.cart.total}: ${formatMinor(order.items, ctx.tenant.currency)}`);
  rows.push([{ text: ru.cart.checkout, callback_data: 'chk:start' }]);
  rows.push([{ text: ru.cart.clear, callback_data: 'cart:clear' }]);
  return { text: texts.join('\n'), rows };
}

export function registerCartHandlers(bot: Bot<BotContextWithSession>): void {
  bot.command('cart', async (ctx) => {
    const { text, rows } = await cartKeyboard(ctx);
    await ctx.port.sendMessage(ctx.chat.id, text, {
      keyboard: { inline_keyboard: rows },
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^cart:(show|inc|dec|clear|noop|open)/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (data === 'cart:noop') return;

    if (data.startsWith('cart:open:')) {
      const lineId = data.slice('cart:open:'.length);
      const line = ctx.session.cart.lines.find((l) => l.lineId === lineId);
      if (!line) return;
      const product = await getProductById(ctx.tenant.id, line.productId);
      if (!product) return;
      const options = await listProductOptions(line.productId);
      ctx.session.selections = ctx.session.selections ?? {};
      ctx.session.selections[line.productId] = line.optionIds;
      await renderProductCard(ctx, product, options, chatId, messageId);
      return;
    }

    if (data === 'cart:show') {
      const { text, rows } = await cartKeyboard(ctx);
      await ctx.port.editMessageText(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
        parseMode: 'HTML',
      });
      return;
    }

    if (data.startsWith('cart:inc:')) {
      const lineId = data.slice('cart:inc:'.length);
      const line = ctx.session.cart.lines.find((l) => l.lineId === lineId);
      if (line) {
        const product = await getProductById(ctx.tenant.id, line.productId);
        line.qty = Math.min(line.qty + 1, product?.maxQty ?? 50);
      }
      const { text, rows } = await cartKeyboard(ctx);
      await ctx.port.editMessageText(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
        parseMode: 'HTML',
      });
      return;
    }

    if (data.startsWith('cart:dec:')) {
      const lineId = data.slice('cart:dec:'.length);
      const line = ctx.session.cart.lines.find((l) => l.lineId === lineId);
      if (line) {
        const product = await getProductById(ctx.tenant.id, line.productId);
        const minQty = product?.minQty ?? 1;
        line.qty -= 1;
        if (line.qty < minQty) {
          ctx.session.cart.lines = ctx.session.cart.lines.filter((l) => l.lineId !== lineId);
        }
      }
      const { text, rows } = await cartKeyboard(ctx);
      await ctx.port.editMessageText(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
        parseMode: 'HTML',
      });
      return;
    }

    if (data === 'cart:clear') {
      ctx.session.cart.lines = [];
      const { text, rows } = await cartKeyboard(ctx);
      await ctx.port.editMessageText(chatId, messageId, text, {
        keyboard: { inline_keyboard: rows },
        parseMode: 'HTML',
      });
      return;
    }
  });

  bot.callbackQuery(/^prd:add:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id, ru.cart.added);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok) return;

    const match = /^prd:add:(.+)$/.exec(ctx.callbackQuery.data);
    const productId = match?.[1];
    if (!productId) return;

    const product = await getProductById(ctx.tenant.id, productId);
    if (!product) return;

    const options = await listProductOptions(productId);
    const selectedOptionIds = resolveSelections(ctx.session.selections?.[productId], options);

    const line: CartLine = {
      lineId: nanoid(10),
      productId,
      qty: product.minQty,
      optionIds: selectedOptionIds,
    };
    ctx.session.cart.lines.push(line);
    delete ctx.session.selections?.[productId];

    await trackFunnelEvent(ctx, 'cart_add');
  });

  bot.callbackQuery(/^prd:qty:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    const match = /^prd:qty:(inc|dec):(.+)$/.exec(ctx.callbackQuery.data);
    if (!match) return;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const delta = match[1] === 'inc' ? 1 : -1;
    const lineId = match[2]!;
    const line = ctx.session.cart.lines.find((l) => l.lineId === lineId);
    if (!line) return;

    const product = await getProductById(ctx.tenant.id, line.productId);
    if (!product) return;

    line.qty = Math.max(product.minQty, Math.min(product.maxQty ?? 50, line.qty + delta));
    const options = await listProductOptions(line.productId);
    ctx.session.selections = ctx.session.selections ?? {};
    ctx.session.selections[line.productId] = line.optionIds;
    await renderProductCard(ctx, product, options, chatId, messageId);
  });

  bot.callbackQuery(/^prd:opt:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const match = /^prd:opt:([^:]+):([^:]+)$/.exec(data);
    if (!match) return;
    const [, productId, optionId] = match;

    const product = await getProductById(ctx.tenant.id, productId!);
    if (!product) return;

    const options = await listProductOptions(productId!);
    const clicked = options.find((o) => o.id === optionId);
    if (!clicked) return;

    const current = ctx.session.selections?.[productId!] ?? [];
    const sameGroupIds = options
      .filter((o) => o.groupTitle === clicked.groupTitle)
      .map((o) => o.id);
    const next = current.filter((id) => !sameGroupIds.includes(id));
    next.push(optionId!);

    ctx.session.selections = ctx.session.selections ?? {};
    ctx.session.selections[productId!] = next;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await renderProductCard(ctx, product, options, chatId, messageId);
    }
  });

  bot.callbackQuery(/^chk:start$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    if (ctx.session.cart.lines.length === 0) {
      const chatId = ctx.callbackQuery.message?.chat.id;
      const messageId = ctx.callbackQuery.message?.message_id;
      if (chatId && messageId) {
        await ctx.port.editMessageText(chatId, messageId, ru.cart.empty, {
          keyboard: { inline_keyboard: [[{ text: 'В меню', callback_data: 'nav:menu' }]] },
        });
      }
      return;
    }

    if (!ctx.tenant.acceptOrders) {
      const chatId = ctx.callbackQuery.message?.chat.id;
      if (chatId) {
        await ctx.port.sendMessage(chatId, ctx.tenant.busyText ?? ru.checkout.busy, {
          keyboard: {
            inline_keyboard: [[{ text: 'Написать мастеру', callback_data: 'rel:start' }]],
          },
        });
      }
      return;
    }

    ctx.session.checkout = {
      checkoutId: nanoid(10),
      referenceFileIds: [],
    };
    ctx.sessionState = 'checkout.date';

    const chatId = ctx.callbackQuery.message!.chat.id;
    const today = toIsoDate(new Date(), ctx.tenant.timezone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
    const availability = await getDateAvailability(
      ctx.tenant.id,
      monthStart,
      monthEnd,
      ctx.session.cart,
      new Date()
    );
    await ctx.port.sendMessage(chatId, `${ru.checkout.dateTitle}\n${ru.checkout.dateLegend}`, {
      keyboard: calendarKeyboard(
        availability,
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7))
      ),
    });
  });
}
