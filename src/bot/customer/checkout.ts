import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { getDateAvailability, DateAvailability } from '../../services/dates.js';
import { createOrder, CreateOrderInput, getCustomerOrderNumber } from '../../services/orders.js';
import { buildOrderCardText, orderCardKeyboard } from '../owner/orders.js';
import { customerMenuKeyboard } from '../owner/menu.js';
import { getDb } from '../../db/client.js';
import { customers, orders } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { addDays, monthEndOf, toIsoDate } from '../../lib/time.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { getProductById, listProductOptions } from '../../services/catalog.js';
import { sendContactKeyboard, clearContactKeyboard } from './contact-keyboard.js';

// Stock DB default for tenants.replySlaText. Treated as "unset" so fresh
// shops get the SLA line in their own language (see orderSentSlaDefault).
const STOCK_RU_SLA = 'в течение нескольких часов';
import { priceLine, priceOrder } from '../../domain/pricing.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { SessionState } from '../../types.js';

async function findOrCreateCustomer(ctx: BotContextWithSession): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenant.id), eq(customers.telegramId, ctx.from!.id)));
  const found = rows[0];
  if (found) return found.id;
  const id = nanoid();
  const now = new Date();
  await db.insert(customers).values({
    id,
    tenantId: ctx.tenant.id,
    telegramId: ctx.from!.id,
    username: ctx.from?.username ?? null,
    firstName: ctx.from?.first_name ?? null,
    source: null,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  return id;
}

async function notifyOwnerOfOrder(ctx: BotContextWithSession, orderId: string): Promise<void> {
  const ownerId = ctx.tenant.ownerTelegramId;
  if (!ownerId) return;
  const text = await buildOrderCardText(
    orderId,
    ctx.tenant.id,
    ctx.tenant.currency,
    ctx.tenant.language
  );
  if (!text) return;
  const sent = await ctx.port.sendMessage(ownerId, text, {
    keyboard: await orderCardKeyboard(ctx, orderId, 'new'),
    parseMode: 'HTML',
  });
  // Store the owner's order card message ID for later updates
  const db = getDb();
  await db.update(orders).set({ ownerCardMessageId: sent.messageId }).where(eq(orders.id, orderId));
}

export function calendarKeyboard(
  ctx: BotContextWithSession,
  availability: DateAvailability,
  year: number,
  month: number
): InlineKeyboard {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const rows: InlineKeyboard['inline_keyboard'] = [];
  rows.push(ctx.t.date.weekdays.map((w) => ({ text: w, callback_data: 'cart:noop' })));

  const [y, m, d] = firstDay.split('-').map(Number);
  const startDate = new Date(Date.UTC(y!, m! - 1, d));
  const offset = (startDate.getUTCDay() + 6) % 7;

  const cells: { text: string; callback_data: string }[] = [];
  for (let i = 0; i < offset; i++) {
    cells.push({ text: ' ', callback_data: 'cart:noop' });
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const avail = availability[iso];
    if (avail && avail.available) {
      cells.push({ text: String(day), callback_data: `chk:date:${iso}` });
    } else {
      cells.push({ text: `${day} ✕`, callback_data: `chk:closed:${iso}` });
    }
  }
  while (cells.length % 7 !== 0) {
    cells.push({ text: ' ', callback_data: 'cart:noop' });
  }
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  const prev = addDays(firstDay, -1).slice(0, 7);
  const next = addDays(firstDay, 33).slice(0, 7);
  rows.push([
    { text: '«', callback_data: `chk:datepage:${prev}` },
    { text: `${ctx.t.date.months[month - 1]} ${year}`, callback_data: 'cart:noop' },
    { text: '»', callback_data: `chk:datepage:${next}` },
  ]);
  rows.push([{ text: ctx.t.checkout.btnCancel, callback_data: 'chk:cancel' }]);

  return { inline_keyboard: rows };
}

async function showCalendar(ctx: BotContextWithSession, edit: boolean): Promise<void> {
  const draft = ctx.session.checkout;
  const baseDate = draft?.dueDate ?? toIsoDate(new Date(), ctx.tenant.timezone);
  const year = Number(baseDate.slice(0, 4));
  const month = Number(baseDate.slice(5, 7));
  const monthStart = `${baseDate.slice(0, 7)}-01`;
  const monthEnd = monthEndOf(monthStart);
  const availability = await getDateAvailability(
    ctx.tenant.id,
    monthStart,
    monthEnd,
    ctx.session.cart,
    new Date()
  );

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const text = `${ctx.t.checkout.dateTitle}\n${ctx.t.checkout.dateLegend}`;

  if (edit && chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
      keyboard: calendarKeyboard(ctx, availability, year, month),
    });
  } else if (chatId) {
    await showScreen(ctx, text, calendarKeyboard(ctx, availability, year, month));
  }
}

function stepKeyboard(
  ctx: BotContextWithSession,
  opts?: { skip?: boolean; back?: boolean }
): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (opts?.skip) rows.push([{ text: ctx.t.checkout.btnSkip, callback_data: 'chk:skip' }]);
  if (opts?.back !== false) rows.push([{ text: ctx.t.common.back, callback_data: 'chk:back' }]);
  rows.push([{ text: ctx.t.checkout.btnCancel, callback_data: 'chk:cancel' }]);
  return { inline_keyboard: rows };
}

async function showScreen(
  ctx: BotContextWithSession,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  if (!chatId) return;
  const draft = ctx.session.checkout;
  let screenId = draft?.screenMessageId;
  if (!screenId && ctx.callbackQuery?.message?.message_id) {
    screenId = ctx.callbackQuery.message.message_id;
  }
  if (screenId) {
    try {
      await ctx.port.editMessageTextOrSend(chatId, screenId, text, { keyboard, parseMode });
      if (draft) draft.screenMessageId = screenId;
      return;
    } catch {
      // screen message is gone (deleted); fall through and send a fresh one
    }
  }
  const sent = await ctx.port.sendMessage(chatId, text, { keyboard, parseMode });
  if (draft) {
    draft.screenMessageId = sent.messageId;
  }
}

async function deleteUserMessage(ctx: BotContextWithSession): Promise<void> {
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;
  if (!messageId || !chatId) return;
  try {
    await ctx.port.deleteMessage(chatId, messageId);
  } catch {
    // already gone
  }
}

function photosKeyboard(ctx: BotContextWithSession): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: ctx.t.checkout.btnDone, callback_data: 'chk:photos:done' }],
      [{ text: ctx.t.checkout.btnSkip, callback_data: 'chk:skip' }],
      [{ text: ctx.t.common.back, callback_data: 'chk:back' }],
      [{ text: ctx.t.checkout.btnCancel, callback_data: 'chk:cancel' }],
    ],
  };
}

async function refreshPhotosScreen(ctx: BotContextWithSession): Promise<void> {
  await showScreen(ctx, photosPromptText(ctx), photosKeyboard(ctx));
}

async function showCurrentStep(ctx: BotContextWithSession): Promise<void> {
  const state = ctx.sessionState;
  const draft = ctx.session.checkout;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  if (!chatId) return;

  switch (state) {
    case 'checkout.time': {
      await showScreen(ctx, ctx.t.checkout.timePrompt, stepKeyboard(ctx, { skip: true }));
      break;
    }
    case 'checkout.fulfillment': {
      const kb: InlineKeyboard = {
        inline_keyboard: [
          [{ text: ctx.t.checkout.pickupBtn, callback_data: 'chk:ful:pickup' }],
          [{ text: ctx.t.checkout.deliveryBtn, callback_data: 'chk:ful:delivery' }],
          [{ text: ctx.t.common.back, callback_data: 'chk:back' }],
          [{ text: ctx.t.checkout.btnCancel, callback_data: 'chk:cancel' }],
        ],
      };
      await showScreen(ctx, ctx.t.checkout.fulfillmentPrompt, kb);
      break;
    }
    case 'checkout.address': {
      await showScreen(ctx, addressPromptText(ctx), stepKeyboard(ctx));
      break;
    }
    case 'checkout.contact': {
      await showScreen(
        ctx,
        ctx.t.checkout.contactPrompt(ctx.t.checkout.phoneExample(ctx.tenant.currency)),
        stepKeyboard(ctx)
      );
      await sendContactKeyboard(ctx);
      break;
    }
    case 'checkout.comment': {
      await showScreen(ctx, ctx.t.checkout.commentPrompt, stepKeyboard(ctx, { skip: true }));
      break;
    }
    case 'checkout.photos': {
      await refreshPhotosScreen(ctx);
      break;
    }
    case 'checkout.confirm': {
      if (!draft?.checkoutId) {
        // Draft lost (e.g. expired session): no dead submit button, guide back to start.
        await showScreen(ctx, ctx.t.checkout.staleSubmit, stepKeyboard(ctx));
        break;
      }
      const text = await buildConfirmText(ctx);
      const kb: InlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: ctx.t.checkout.btnSubmit,
              callback_data: `chk:submit:${draft.checkoutId}`,
            },
          ],
          [{ text: ctx.t.common.back, callback_data: 'chk:back' }],
          [{ text: ctx.t.checkout.btnCancel, callback_data: 'chk:cancel' }],
        ],
      };
      await showScreen(ctx, text, kb, 'HTML');
      break;
    }
    default:
      break;
  }
}

function addressPromptText(ctx: BotContextWithSession): string {
  const base = ctx.t.checkout.addressPrompt;
  const terms = ctx.tenant.deliveryText?.trim();
  return terms ? `${base}\n\n${escapeHtml(terms)}` : base;
}

function photosPromptText(ctx: BotContextWithSession): string {
  const count = ctx.session.checkout?.referenceFileIds.length ?? 0;
  const base = ctx.t.checkout.photosPrompt;
  if (count === 0) return base;
  if (count >= 5) return base + '\n\n' + ctx.t.checkout.photosAttachedMax;
  return base + '\n\n' + ctx.t.checkout.photosAttached(count);
}

async function buildConfirmText(ctx: BotContextWithSession): Promise<string> {
  const draft = ctx.session.checkout;
  const lines: string[] = [];
  lines.push(ctx.t.checkout.confirmTitle);
  let itemsTotal = 0;
  for (const line of ctx.session.cart.lines) {
    const product = await getProductById(ctx.tenant.id, line.productId);
    if (!product) continue;
    const options = await listProductOptions(line.productId);
    const selected = options.filter((o) => line.optionIds.includes(o.id));
    const price = priceLine(
      product.priceMinor,
      selected.map((o) => o.priceDeltaMinor),
      line.qty
    );
    itemsTotal += price;
    lines.push(
      `• ${escapeHtml(product.title)}${selected.length ? ` (${selected.map((o) => o.title).join(', ')})` : ''} × ${line.qty} — ${formatMinor(price, ctx.tenant.currency)}`
    );
  }
  const deliveryFee = draft?.fulfillment === 'delivery' ? ctx.tenant.deliveryFeeMinor : 0;
  const order = priceOrder([itemsTotal], deliveryFee, ctx.tenant.prepaymentPercent);
  lines.push('');
  lines.push(ctx.t.checkout.confirmDate(draft?.dueDate ?? '—'));
  if (draft?.dueTimeText) lines.push(ctx.t.checkout.confirmTime(escapeHtml(draft.dueTimeText)));
  lines.push(
    ctx.t.checkout.confirmFulfillment(
      draft?.fulfillment === 'delivery' ? ctx.t.orderCard.delivery : ctx.t.orderCard.pickup
    )
  );
  if (draft?.address) lines.push(ctx.t.checkout.confirmAddress(escapeHtml(draft.address)));
  if (draft?.contactName && draft?.contactPhone) {
    lines.push(
      ctx.t.checkout.confirmContact(escapeHtml(draft.contactName), escapeHtml(draft.contactPhone))
    );
  }
  if (draft?.comment) lines.push(ctx.t.checkout.confirmComment(escapeHtml(draft.comment)));
  if (draft?.referenceFileIds?.length)
    lines.push(ctx.t.checkout.confirmRefs(draft.referenceFileIds.length));
  lines.push('');
  lines.push(ctx.t.checkout.confirmItems(formatMinor(order.items, ctx.tenant.currency)));
  if (deliveryFee)
    lines.push(ctx.t.checkout.confirmDeliveryFee(formatMinor(deliveryFee, ctx.tenant.currency)));
  lines.push(ctx.t.checkout.confirmTotal(formatMinor(order.total, ctx.tenant.currency)));
  lines.push(ctx.t.checkout.confirmPrepay(formatMinor(order.prepayment, ctx.tenant.currency)));
  lines.push('');
  lines.push(ctx.t.checkout.confirmConsent);
  return lines.join('\n');
}

export function registerCheckoutHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^chk:datepage:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    const m = /^chk:datepage:(\d{4})-(\d{2})$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = monthEndOf(monthStart);
    const availability = await getDateAvailability(
      ctx.tenant.id,
      monthStart,
      monthEnd,
      ctx.session.cart,
      new Date()
    );
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;
    await ctx.port.editMessageTextOrSend(
      chatId,
      messageId,
      `${ctx.t.checkout.dateTitle}\n${ctx.t.checkout.dateLegend}`,
      { keyboard: calendarKeyboard(ctx, availability, year, month) }
    );
  });

  bot.callbackQuery(/^chk:closed:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const m = /^chk:closed:(\d{4}-\d{2}-\d{2})$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    const iso = m[1]!;
    const availability = await getDateAvailability(
      ctx.tenant.id,
      iso,
      iso,
      ctx.session.cart,
      new Date()
    );
    const reason = availability[iso]?.reason;
    // Toast explains why the day is off instead of a dead button.
    await ctx.port.answerCallback(
      ctx.callbackQuery.id,
      reason === 'FULL'
        ? ctx.t.checkout.capacityExceeded
        : reason === 'TOO_SOON'
          ? ctx.t.checkout.dateTooSoon
          : reason === 'TOO_FAR'
            ? ctx.t.checkout.dateTooFar
            : ctx.t.checkout.dateTaken
    );
  });

  bot.callbackQuery(/^chk:date:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    const m = /^chk:date:(\d{4}-\d{2}-\d{2})$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    const iso = m[1]!;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const monthStart = `${iso.slice(0, 7)}-01`;
    const monthEnd = monthEndOf(monthStart);
    const avail = await getDateAvailability(
      ctx.tenant.id,
      monthStart,
      monthEnd,
      ctx.session.cart,
      new Date()
    );
    const entry = avail[iso];
    if (!entry || !entry.available) {
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `${ctx.t.checkout.dateUnavailable}\n${ctx.t.checkout.dateLegend}`,
        {
          keyboard: calendarKeyboard(ctx, avail, Number(iso.slice(0, 4)), Number(iso.slice(5, 7))),
        }
      );
      return;
    }

    ctx.session.checkout = ctx.session.checkout ?? { checkoutId: nanoid(10), referenceFileIds: [] };
    ctx.session.checkout.dueDate = iso;
    ctx.sessionState = 'checkout.time';
    await ctx.port.editMessageTextOrSend(
      chatId,
      messageId,
      `${ctx.t.checkout.dateSelected}: ${iso}`
    );
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:ful:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    const m = /^chk:ful:(pickup|delivery)$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    ctx.session.checkout = ctx.session.checkout ?? { checkoutId: nanoid(10), referenceFileIds: [] };
    ctx.session.checkout.fulfillment = m[1] as 'pickup' | 'delivery';
    ctx.sessionState = m[1] === 'delivery' ? 'checkout.address' : 'checkout.contact';
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:skip$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    await clearContactKeyboard(ctx);
    advanceFromSkip(ctx);
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:back$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    await clearContactKeyboard(ctx);
    ctx.sessionState = resolveBack(ctx);
    if (ctx.sessionState === 'checkout.date') {
      await showCalendar(ctx, false);
      return;
    }
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:cancel$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    await clearContactKeyboard(ctx);
    ctx.sessionState = 'idle';
    ctx.session.checkout = undefined;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.checkout.cancelled, {
        keyboard: customerMenuKeyboard(ctx),
      });
    }
  });

  bot.callbackQuery(/^chk:photos:done$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = 'checkout.confirm';
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:submit:(.+)$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^chk:submit:(.+)$/.exec(ctx.callbackQuery.data);
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!m || !chatId || !messageId) return;
    const checkoutId = m[1]!;

    const draft = ctx.session.checkout;
    if (!draft || draft.checkoutId !== checkoutId) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.checkout.staleSubmit, {});
      return;
    }
    if (
      !draft.dueDate ||
      !draft.fulfillment ||
      !draft.contactName ||
      !draft.contactPhone ||
      (draft.fulfillment === 'delivery' && !draft.address?.trim())
    ) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.checkout.incomplete, {});
      return;
    }

    const customerId = await findOrCreateCustomer(ctx);
    const result = await createOrder({
      tenantId: ctx.tenant.id,
      customerId,
      cart: ctx.session.cart,
      checkout: draft as CreateOrderInput['checkout'],
      now: new Date(),
    });

    if (!result.ok) {
      if (result.error === 'CAPACITY_EXCEEDED' || result.error === 'DATE_UNAVAILABLE') {
        ctx.sessionState = 'checkout.date';
        draft.dueDate = undefined;
        const today = toIsoDate(new Date(), ctx.tenant.timezone);
        const monthStart = `${today.slice(0, 7)}-01`;
        const monthEnd = monthEndOf(monthStart);
        const avail = await getDateAvailability(
          ctx.tenant.id,
          monthStart,
          monthEnd,
          ctx.session.cart,
          new Date()
        );
        const msg =
          result.error === 'CAPACITY_EXCEEDED'
            ? ctx.t.checkout.capacityExceeded
            : ctx.t.checkout.dateTaken;
        await ctx.port.editMessageTextOrSend(chatId, messageId, msg, {
          keyboard: calendarKeyboard(
            ctx,
            avail,
            Number(today.slice(0, 4)),
            Number(today.slice(5, 7))
          ),
        });
        return;
      }
      const text =
        result.error === 'PRODUCT_INACTIVE'
          ? ctx.t.checkout.productInactive
          : result.error === 'TENANT_BUSY'
            ? ctx.tenant.busyText
              ? escapeHtml(ctx.tenant.busyText)
              : ctx.t.checkout.busy
            : result.error === 'BAD_QTY'
              ? ctx.t.checkout.badQty
              : result.error === 'BAD_ADDRESS' || result.error === 'BAD_OPTIONS'
                ? ctx.t.checkout.incomplete
                : result.error === 'CUSTOMER_BLOCKED'
                  ? ctx.t.cart.blocked
                  : ctx.t.checkout.emptyCart;
      await ctx.port.editMessageTextOrSend(chatId, messageId, text, {});
      return;
    }

    const order = result.value;
    ctx.session.cart.lines = [];
    ctx.session.checkout = undefined;
    ctx.sessionState = 'idle';

    // Stock Russian default reads as "unset": use the shop language instead.
    // (Unlike greeting/payment/contacts texts, replySlaText is NOT NULL.)
    const sla =
      ctx.tenant.replySlaText === STOCK_RU_SLA
        ? ctx.t.checkout.orderSentSlaDefault
        : escapeHtml(ctx.tenant.replySlaText);

    // Customer confirmation and owner notification are independent: send together.
    await Promise.all([
      ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `${ctx.t.checkout.orderSent((await getCustomerOrderNumber(order.id)) ?? order.number)} ${sla}`,
        {
          keyboard: {
            inline_keyboard: [
              [{ text: ctx.t.checkout.orderMore, callback_data: 'cat:list' }],
              [
                { text: ctx.t.cart.button, callback_data: 'cart:show' },
                { text: ctx.t.my.button, callback_data: 'my:list' },
              ],
              [{ text: ctx.t.common.toMenu, callback_data: 'nav:menu' }],
            ],
          },
        }
      ),
      notifyOwnerOfOrder(ctx, order.id),
    ]);
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.role === 'owner' && ctx.sessionState === 'owner.edit_field') {
      await next();
      return;
    }
    if (!ctx.sessionState.startsWith('checkout.')) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    await deleteUserMessage(ctx);

    switch (ctx.sessionState) {
      case 'checkout.time':
        ctx.session.checkout = ctx.session.checkout ?? {
          checkoutId: nanoid(10),
          referenceFileIds: [],
        };
        ctx.session.checkout.dueTimeText = text || undefined;
        ctx.sessionState = 'checkout.fulfillment';
        await showCurrentStep(ctx);
        break;
      case 'checkout.address':
        if (!text) {
          await showScreen(ctx, addressPromptText(ctx), stepKeyboard(ctx));
          return;
        }
        ctx.session.checkout!.address = text;
        ctx.sessionState = 'checkout.contact';
        await showCurrentStep(ctx);
        break;
      case 'checkout.contact': {
        const parsed = parseContact(text);
        if (!parsed) {
          await showScreen(
            ctx,
            ctx.t.checkout.contactInvalid(ctx.t.checkout.phoneExample(ctx.tenant.currency)),
            stepKeyboard(ctx)
          );
          return;
        }
        if (!parsed.name) {
          await showScreen(
            ctx,
            ctx.t.checkout.contactNameMissing(ctx.t.checkout.phoneExample(ctx.tenant.currency)),
            stepKeyboard(ctx)
          );
          return;
        }
        ctx.session.checkout!.contactName = parsed.name;
        ctx.session.checkout!.contactPhone = parsed.phone;
        await clearContactKeyboard(ctx);
        ctx.sessionState = 'checkout.comment';
        await showCurrentStep(ctx);
        break;
      }
      case 'checkout.comment':
        if (text.length > 500) {
          await showScreen(ctx, ctx.t.checkout.commentTooLong, stepKeyboard(ctx, { skip: true }));
          return;
        }
        ctx.session.checkout!.comment = text || undefined;
        ctx.sessionState = 'checkout.photos';
        await showCurrentStep(ctx);
        break;
      default:
        break;
    }
  });

  bot.on('message:contact', async (ctx, next) => {
    if (!ctx.sessionState.startsWith('checkout.') || ctx.sessionState !== 'checkout.contact') {
      await next();
      return;
    }
    const contact = ctx.message.contact;
    await deleteUserMessage(ctx);
    if (contextHasPhone(contact)) {
      ctx.session.checkout!.contactName = `${contact.first_name}${contact.last_name ? ' ' + contact.last_name : ''}`;
      ctx.session.checkout!.contactPhone = contact.phone_number;
      await clearContactKeyboard(ctx);
      ctx.sessionState = 'checkout.comment';
      await showCurrentStep(ctx);
    }
  });

  bot.on('message:photo', async (ctx, next) => {
    if (ctx.sessionState !== 'checkout.photos') {
      await next();
      return;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (!photo) return;
    await deleteUserMessage(ctx);
    const arr = ctx.session.checkout?.referenceFileIds ?? [];
    if (arr.length >= 5) {
      // Limit reached, silently ignore additional photos
      return;
    }
    arr.push({ fileId: photo.file_id, fileType: 'photo' });
    ctx.session.checkout!.referenceFileIds = arr;
    await refreshPhotosScreen(ctx);
  });

  bot.on('message:document', async (ctx, next) => {
    if (ctx.sessionState !== 'checkout.photos') {
      await next();
      return;
    }
    // References are photo-only by contract (v1.33): drop documents silently,
    // mirroring the over-limit path. The screen already prompts for photos.
    // Old document attachments still display in my:refs / adm:ord:refs.
    await deleteUserMessage(ctx);
  });
}

function contextHasPhone(contact: { phone_number?: string }): boolean {
  return typeof contact.phone_number === 'string' && contact.phone_number.length > 0;
}

function parseContact(text: string): { name: string; phone: string } | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const phone = parts[parts.length - 1]!;
    const name = parts.slice(0, -1).join(', ');
    if (/^\+?[\d\s()-]{7,}$/.test(phone) && name.length > 0) {
      return { name, phone };
    }
  }
  const phoneOnly = text.trim();
  if (/^\+?[\d\s()-]{7,}$/.test(phoneOnly)) {
    return { name: '', phone: phoneOnly };
  }
  return null;
}

function advanceFromSkip(ctx: BotContextWithSession): void {
  switch (ctx.sessionState) {
    case 'checkout.time':
      ctx.session.checkout!.dueTimeText = undefined;
      ctx.sessionState = 'checkout.fulfillment';
      break;
    case 'checkout.address':
      ctx.session.checkout!.address = undefined;
      ctx.sessionState = 'checkout.contact';
      break;
    case 'checkout.comment':
      ctx.session.checkout!.comment = undefined;
      ctx.sessionState = 'checkout.photos';
      break;
    case 'checkout.photos':
      ctx.session.checkout!.referenceFileIds = [];
      ctx.sessionState = 'checkout.confirm';
      break;
    default:
      break;
  }
}

function resolveBack(ctx: BotContextWithSession): SessionState {
  const draft = ctx.session.checkout;
  switch (ctx.sessionState) {
    case 'checkout.time':
      return 'checkout.date';
    case 'checkout.fulfillment':
      return 'checkout.time';
    case 'checkout.address':
      return 'checkout.fulfillment';
    case 'checkout.contact':
      return draft?.fulfillment === 'delivery' ? 'checkout.address' : 'checkout.fulfillment';
    case 'checkout.comment':
      return 'checkout.contact';
    case 'checkout.photos':
      return 'checkout.comment';
    case 'checkout.confirm':
      return 'checkout.photos';
    default:
      return 'idle';
  }
}
