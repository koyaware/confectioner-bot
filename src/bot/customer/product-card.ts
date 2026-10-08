import { BotContextWithSession } from '../context.js';
import { escapeHtml } from '../../domain/escape.js';
import { truncateText } from '../../domain/truncate.js';
import { formatMinor } from '../../lib/money.js';
import { getProductById, listProductOptions } from '../../services/catalog.js';
import { priceLine } from '../../domain/pricing.js';
import { InlineKeyboard } from '../../telegram/port.js';

export function resolveSelections(
  selected: string[] | undefined,
  options: { id: string; groupTitle: string; isActive: boolean }[]
): string[] {
  const byGroup = new Map<string, string[]>();
  for (const o of options) {
    if (!o.isActive) continue;
    const arr = byGroup.get(o.groupTitle) ?? [];
    arr.push(o.id);
    byGroup.set(o.groupTitle, arr);
  }
  const result: string[] = [];
  for (const ids of byGroup.values()) {
    const chosen = selected?.find((s) => ids.includes(s));
    result.push(chosen ?? ids[0]!);
  }
  return result;
}

export async function renderProductCard(
  ctx: BotContextWithSession,
  product: NonNullable<Awaited<ReturnType<typeof getProductById>>>,
  options: Awaited<ReturnType<typeof listProductOptions>>,
  chatId: number,
  messageId: number
): Promise<void> {
  const selected = resolveSelections(ctx.session.selections?.[product.id], options);
  const selectedOptions = options.filter((o) => selected.includes(o.id));

  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(product.title)}</b>`);
  if (product.description) lines.push(escapeHtml(product.description));
  const basePrice = priceLine(
    product.priceMinor,
    selectedOptions.map((o) => o.priceDeltaMinor),
    1
  );
  lines.push(ctx.t.product.price(formatMinor(basePrice, ctx.tenant.currency)));

  const rows: InlineKeyboard['inline_keyboard'] = [];
  const groups = new Map<string, typeof options>();
  for (const o of options) {
    const arr = groups.get(o.groupTitle) ?? [];
    arr.push(o);
    groups.set(o.groupTitle, arr);
  }
  for (const [groupTitle, opts] of groups) {
    rows.push([{ text: groupTitle, callback_data: 'cart:noop' }]);
    rows.push(
      opts.map((o) => ({
        text: `${selected.includes(o.id) ? '✅ ' : ''}${o.title}`,
        callback_data: `prd:opt:${product.id}:${o.id}`,
      }))
    );
  }
  rows.push([{ text: ctx.t.cart.addToCart, callback_data: `prd:add:${product.id}` }]);
  const cartLine = ctx.session.cart.lines.find(
    (line) =>
      line.productId === product.id &&
      line.optionIds.length === selected.length &&
      line.optionIds.every((id) => selected.includes(id))
  );
  if (cartLine) {
    rows.push([
      { text: '−', callback_data: `prd:qty:dec:${cartLine.lineId}` },
      { text: String(cartLine.qty), callback_data: 'cart:noop' },
      { text: '+', callback_data: `prd:qty:inc:${cartLine.lineId}` },
    ]);
  }
  rows.push([{ text: ctx.t.cart.goToCart, callback_data: 'cart:show' }]);
  rows.push([{ text: ctx.t.catalog.back, callback_data: `cat:open:${product.categoryId}` }]);

  const keyboard = { inline_keyboard: rows };
  const text = lines.join('\n');
  if (product.photoFileId) {
    const caption = truncateText(text, 1024);
    const screen = ctx.callbackQuery?.message;
    try {
      if (screen && 'photo' in screen) {
        // Already a photo screen: swap media in place (one API call).
        await ctx.port.editMessageMedia(chatId, messageId, product.photoFileId, caption, {
          keyboard,
          parseMode: 'HTML',
        });
      } else {
        // Text screen becomes a photo screen: send first so a media
        // failure still leaves the old screen intact for the fallback.
        await ctx.port.sendPhoto(chatId, product.photoFileId, caption, {
          keyboard,
          parseMode: 'HTML',
        });
        try {
          await ctx.port.deleteMessage(chatId, messageId);
        } catch {
          // already gone
        }
      }
      return;
    } catch {
      // Bad/expired file_id or oversized media: fall back to the text card
      // instead of surfacing an error on every card interaction.
    }
  }
  await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
    keyboard,
    parseMode: 'HTML',
  });
}
