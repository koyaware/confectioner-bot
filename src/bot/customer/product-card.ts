import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
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
  lines.push(`Цена: ${formatMinor(basePrice, ctx.tenant.currency)}`);

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
  rows.push([{ text: ru.cart.addToCart, callback_data: `prd:add:${product.id}` }]);
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
  rows.push([{ text: 'Перейти в корзину', callback_data: 'cart:show' }]);
  rows.push([{ text: ru.catalog.back, callback_data: `cat:open:${product.categoryId}` }]);

  await ctx.port.editMessageText(chatId, messageId, lines.join('\n'), {
    keyboard: { inline_keyboard: rows },
    parseMode: 'HTML',
  });
}
