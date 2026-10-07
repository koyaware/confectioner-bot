import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { getDateAvailability, DateAvailability } from '../../services/dates.js';
import { createOrder, CreateOrderInput, getCustomerOrderNumber } from '../../services/orders.js';
import { buildOrderCardText, orderCardKeyboard } from '../owner/orders.js';
import { getDb } from '../../db/client.js';
import { customers } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { addDays, monthEndOf, toIsoDate } from '../../lib/time.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { getProductById, listProductOptions } from '../../services/catalog.js';
import { priceLine, priceOrder } from '../../domain/pricing.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { SessionState } from '../../types.js';

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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
  const text = await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency);
  if (!text) return;
  await ctx.port.sendMessage(ownerId, text, {
    keyboard: await orderCardKeyboard(orderId, 'new'),
    parseMode: 'HTML',
  });
}

export function calendarKeyboard(
  availability: DateAvailability,
  year: number,
  month: number
): InlineKeyboard {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const rows: InlineKeyboard['inline_keyboard'] = [];
  rows.push(WEEKDAYS.map((w) => ({ text: w, callback_data: 'cart:noop' })));

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
      cells.push({ text: `${day} ✕`, callback_data: 'cart:noop' });
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
    { text: `${MONTH_NAMES[month - 1]} ${year}`, callback_data: 'cart:noop' },
    { text: '»', callback_data: `chk:datepage:${next}` },
  ]);

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
  const text = `${ru.checkout.dateTitle}\n${ru.checkout.dateLegend}`;

  if (edit && chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, text, {
      keyboard: {
        inline_keyboard: [
          ...calendarKeyboard(availability, year, month).inline_keyboard,
          [{ text: 'Отмена', callback_data: 'chk:cancel' }],
        ],
      },
    });
  } else if (chatId) {
    await ctx.port.sendMessage(chatId, text, {
      keyboard: {
        inline_keyboard: [
          ...calendarKeyboard(availability, year, month).inline_keyboard,
          [{ text: 'Отмена', callback_data: 'chk:cancel' }],
        ],
      },
    });
  }
}

function stepKeyboard(opts?: { skip?: boolean; back?: boolean }): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (opts?.skip) rows.push([{ text: 'Пропустить', callback_data: 'chk:skip' }]);
  if (opts?.back !== false) rows.push([{ text: 'Назад', callback_data: 'chk:back' }]);
  rows.push([{ text: 'Отмена', callback_data: 'chk:cancel' }]);
  return { inline_keyboard: rows };
}

async function showCurrentStep(ctx: BotContextWithSession): Promise<void> {
  const state = ctx.sessionState;
  const draft = ctx.session.checkout;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (!chatId) return;

  switch (state) {
    case 'checkout.time': {
      const text = ru.checkout.timePrompt;
      const kb = stepKeyboard({ skip: true });
      if (messageId) {
        await ctx.port.editMessageText(chatId, messageId, text, { keyboard: kb });
      } else {
        await ctx.port.sendMessage(chatId, text, { keyboard: kb });
      }
      break;
    }
    case 'checkout.fulfillment': {
      const kb: InlineKeyboard = {
        inline_keyboard: [
          [{ text: 'Самовывоз', callback_data: 'chk:ful:pickup' }],
          [{ text: 'Доставка', callback_data: 'chk:ful:delivery' }],
          [{ text: 'Назад', callback_data: 'chk:back' }],
          [{ text: 'Отмена', callback_data: 'chk:cancel' }],
        ],
      };
      if (messageId) {
        await ctx.port.editMessageText(chatId, messageId, ru.checkout.fulfillmentPrompt, {
          keyboard: kb,
        });
      } else {
        await ctx.port.sendMessage(chatId, ru.checkout.fulfillmentPrompt, { keyboard: kb });
      }
      break;
    }
    case 'checkout.address': {
      const kb = stepKeyboard();
      await ctx.port.sendMessage(chatId, ru.checkout.addressPrompt, { keyboard: kb });
      break;
    }
    case 'checkout.contact': {
      const kb = stepKeyboard();
      await ctx.port.sendMessage(
        chatId,
        ru.checkout.contactPrompt(ru.checkout.phoneExample(ctx.tenant.currency)),
        { keyboard: kb }
      );
      break;
    }
    case 'checkout.comment': {
      const kb = stepKeyboard({ skip: true });
      await ctx.port.sendMessage(chatId, ru.checkout.commentPrompt, { keyboard: kb });
      break;
    }
    case 'checkout.photos': {
      const kb: InlineKeyboard = {
        inline_keyboard: [
          [{ text: 'Готово', callback_data: 'chk:photos:done' }],
          [{ text: 'Пропустить', callback_data: 'chk:skip' }],
          [{ text: 'Назад', callback_data: 'chk:back' }],
          [{ text: 'Отмена', callback_data: 'chk:cancel' }],
        ],
      };
      await ctx.port.sendMessage(chatId, ru.checkout.photosPrompt, { keyboard: kb });
      break;
    }
    case 'checkout.confirm': {
      const text = await buildConfirmText(ctx);
      const kb: InlineKeyboard = {
        inline_keyboard: [
          [{ text: 'Отправить заказ', callback_data: `chk:submit:${draft?.checkoutId ?? ''}` }],
          [{ text: 'Назад', callback_data: 'chk:back' }],
          [{ text: 'Отмена', callback_data: 'chk:cancel' }],
        ],
      };
      await ctx.port.sendMessage(chatId, text, { keyboard: kb, parseMode: 'HTML' });
      break;
    }
    default:
      break;
  }
}

async function buildConfirmText(ctx: BotContextWithSession): Promise<string> {
  const draft = ctx.session.checkout;
  const lines: string[] = [];
  lines.push('<b>Ваш заказ</b>');
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
  lines.push(`Дата: ${draft?.dueDate ?? '—'}`);
  if (draft?.dueTimeText) lines.push(`Время: ${escapeHtml(draft.dueTimeText)}`);
  lines.push(`Получение: ${draft?.fulfillment === 'delivery' ? 'доставка' : 'самовывоз'}`);
  if (draft?.address) lines.push(`Адрес: ${escapeHtml(draft.address)}`);
  if (draft?.contactName && draft?.contactPhone) {
    lines.push(`Контакт: ${escapeHtml(draft.contactName)}, ${escapeHtml(draft.contactPhone)}`);
  }
  if (draft?.comment) lines.push(`Комментарий: ${escapeHtml(draft.comment)}`);
  if (draft?.referenceFileIds?.length)
    lines.push(`Референсы: ${draft.referenceFileIds.length} шт.`);
  lines.push('');
  lines.push(`Товары: ${formatMinor(order.items, ctx.tenant.currency)}`);
  if (deliveryFee) lines.push(`Доставка: ${formatMinor(deliveryFee, ctx.tenant.currency)}`);
  lines.push(`Итого: ${formatMinor(order.total, ctx.tenant.currency)}`);
  lines.push(`Предоплата: ${formatMinor(order.prepayment, ctx.tenant.currency)}`);
  lines.push('');
  lines.push('Отправляя заказ, вы соглашаетесь на обработку данных для выполнения заказа.');
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
    await ctx.port.editMessageText(
      chatId,
      messageId,
      `${ru.checkout.dateTitle}\n${ru.checkout.dateLegend}`,
      { keyboard: calendarKeyboard(availability, year, month) }
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
      await ctx.port.editMessageText(
        chatId,
        messageId,
        `${ru.checkout.dateUnavailable}\n${ru.checkout.dateLegend}`,
        {
          keyboard: calendarKeyboard(avail, Number(iso.slice(0, 4)), Number(iso.slice(5, 7))),
        }
      );
      return;
    }

    ctx.session.checkout = ctx.session.checkout ?? { checkoutId: nanoid(10), referenceFileIds: [] };
    ctx.session.checkout.dueDate = iso;
    ctx.sessionState = 'checkout.time';
    await ctx.port.editMessageText(chatId, messageId, `${ru.checkout.dateSelected}: ${iso}`);
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
    advanceFromSkip(ctx);
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:back$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = resolveBack(ctx);
    if (ctx.sessionState === 'checkout.date') {
      await showCalendar(ctx, false);
      return;
    }
    await showCurrentStep(ctx);
  });

  bot.callbackQuery(/^chk:cancel$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);
    ctx.sessionState = 'idle';
    ctx.session.checkout = undefined;
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (chatId) {
      await ctx.port.sendMessage(chatId, ru.checkout.cancelled);
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
      await ctx.port.editMessageText(chatId, messageId, ru.checkout.staleSubmit, {});
      return;
    }
    if (
      !draft.dueDate ||
      !draft.fulfillment ||
      !draft.contactName ||
      !draft.contactPhone ||
      (draft.fulfillment === 'delivery' && !draft.address?.trim())
    ) {
      await ctx.port.editMessageText(chatId, messageId, ru.checkout.incomplete, {});
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
            ? ru.checkout.capacityExceeded
            : ru.checkout.dateTaken;
        await ctx.port.editMessageText(chatId, messageId, msg, {
          keyboard: calendarKeyboard(avail, Number(today.slice(0, 4)), Number(today.slice(5, 7))),
        });
        return;
      }
      const text =
        result.error === 'PRODUCT_INACTIVE'
          ? ru.checkout.productInactive
          : result.error === 'TENANT_BUSY'
            ? (ctx.tenant.busyText ?? ru.checkout.busy)
            : result.error === 'BAD_QTY'
              ? ru.checkout.badQty
              : result.error === 'BAD_ADDRESS' || result.error === 'BAD_OPTIONS'
                ? ru.checkout.incomplete
                : result.error === 'CUSTOMER_BLOCKED'
                  ? ru.cart.blocked
                  : ru.checkout.emptyCart;
      await ctx.port.editMessageText(chatId, messageId, text, {});
      return;
    }

    const order = result.value;
    ctx.session.cart.lines = [];
    ctx.session.checkout = undefined;
    ctx.sessionState = 'idle';

    await ctx.port.editMessageText(
      chatId,
      messageId,
      `${ru.checkout.orderSent((await getCustomerOrderNumber(order.id)) ?? order.number)} ${ctx.tenant.replySlaText}`,
      {}
    );

    await notifyOwnerOfOrder(ctx, order.id);
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
          await ctx.port.sendMessage(ctx.chat.id, ru.checkout.addressPrompt);
          return;
        }
        ctx.session.checkout!.address = text;
        ctx.sessionState = 'checkout.contact';
        await showCurrentStep(ctx);
        break;
      case 'checkout.contact': {
        const parsed = parseContact(text);
        if (!parsed) {
          await ctx.port.sendMessage(
            ctx.chat.id,
            ru.checkout.contactInvalid(ru.checkout.phoneExample(ctx.tenant.currency))
          );
          return;
        }
        if (!parsed.name) {
          await ctx.port.sendMessage(
            ctx.chat.id,
            ru.checkout.contactNameMissing(ru.checkout.phoneExample(ctx.tenant.currency))
          );
          return;
        }
        ctx.session.checkout!.contactName = parsed.name;
        ctx.session.checkout!.contactPhone = parsed.phone;
        ctx.sessionState = 'checkout.comment';
        await showCurrentStep(ctx);
        break;
      }
      case 'checkout.comment':
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
    if (contextHasPhone(contact)) {
      ctx.session.checkout!.contactName = `${contact.first_name}${contact.last_name ? ' ' + contact.last_name : ''}`;
      ctx.session.checkout!.contactPhone = contact.phone_number;
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
    const arr = ctx.session.checkout?.referenceFileIds ?? [];
    if (arr.length >= 5) {
      await ctx.port.sendMessage(ctx.chat.id, ru.checkout.photosLimit);
      return;
    }
    arr.push({ fileId: photo.file_id, fileType: 'photo' });
    ctx.session.checkout!.referenceFileIds = arr;
  });

  bot.on('message:document', async (ctx, next) => {
    if (ctx.sessionState !== 'checkout.photos') {
      await next();
      return;
    }
    const doc = ctx.message.document;
    if (!doc) return;
    const arr = ctx.session.checkout?.referenceFileIds ?? [];
    if (arr.length >= 5) {
      await ctx.port.sendMessage(ctx.chat.id, ru.checkout.photosLimit);
      return;
    }
    arr.push({ fileId: doc.file_id, fileType: 'document' });
    ctx.session.checkout!.referenceFileIds = arr;
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
