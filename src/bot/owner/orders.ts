import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import { applyOrderEvent, getCustomerOrderNumber } from '../../services/orders.js';
import { sendPaymentCard } from '../customer/payment.js';
import { InlineKeyboard, TelegramPort } from '../../telegram/port.js';
import { getDb } from '../../db/client.js';
import {
  customers,
  orders,
  orderItems,
  orderAttachments,
  tenants,
  capacityOverrides,
} from '../../db/schema.js';
import { effectiveCapacity, OCCUPYING_STATUSES, usedUnits } from '../../domain/capacity.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { addDays, toIsoDate } from '../../lib/time.js';
import { getDateAvailability } from '../../services/dates.js';

export const REJECT_REASONS: Record<string, string> = ru.ownerOrders.rejectReasons;

export async function buildOrderCardText(
  orderId: string,
  tenantId: string,
  currency: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order || order.tenantId !== tenantId) return null;

  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const refs = await db
    .select()
    .from(orderAttachments)
    .where(and(eq(orderAttachments.orderId, orderId), eq(orderAttachments.kind, 'reference')));

  const lines: string[] = [];
  lines.push(`<b>Заказ №${order.number}</b>`);
  lines.push(`Статус: ${order.status}`);
  lines.push('');
  for (const item of items) {
    const opts = item.optionsSnapshot.map((o) => o.title).join(', ');
    lines.push(
      `• ${escapeHtml(item.titleSnapshot)}${opts ? ` (${escapeHtml(opts)})` : ''} × ${item.qty} — ${formatMinor(item.unitPriceMinor * item.qty, currency)}`
    );
  }
  lines.push('');
  lines.push(
    `Дата: ${order.dueDate}${order.dueTimeText ? `, ${escapeHtml(order.dueTimeText)}` : ''}`
  );
  lines.push(`Получение: ${order.fulfillment === 'delivery' ? 'доставка' : 'самовывоз'}`);
  if (order.address) lines.push(`Адрес: ${escapeHtml(order.address)}`);
  lines.push(`Контакт: ${escapeHtml(order.contactName)}, ${escapeHtml(order.contactPhone)}`);
  if (order.comment) lines.push(`Комментарий: ${escapeHtml(order.comment)}`);
  if (refs.length > 0) lines.push(`Референсы: ${refs.length} шт.`);
  lines.push('');
  lines.push(
    `Итого: ${formatMinor(order.totalMinor, currency)}, предоплата ${formatMinor(order.prepaymentMinor, currency)}`
  );
  if (order.source) {
    lines.push(`Источник: ${escapeHtml(order.source)}`);
  }
  if (customer) {
    const link = customer.username ? `@${customer.username}` : `id${customer.telegramId}`;
    lines.push(`Клиент: ${escapeHtml(customer.firstName ?? 'клиент')} (${link})`);
  }
  if (order.rejectReason) lines.push(`Причина отказа: ${escapeHtml(order.rejectReason)}`);
  if (order.cancelReason) lines.push(`Причина отмены клиентом: ${escapeHtml(order.cancelReason)}`);
  if (order.proposedDate) lines.push(`Предложенная дата: ${order.proposedDate}`);
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
  const timezone = tenantRows[0]?.timezone ?? 'Europe/Moscow';
  if (order.paymentDueAt) {
    lines.push(`Оплатить до: ${formatDue(order.paymentDueAt, timezone)}`);
  }
  lines.push(`Загрузка даты: ${await dateLoadLabel(order.tenantId, order.dueDate)}`);
  return lines.join('\n');
}

function formatDue(due: Date, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(due));
}

async function dateLoadLabel(tenantId: string, dueDate: string): Promise<string> {
  const db = getDb();
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return '—';
  const overrideRows = await db
    .select()
    .from(capacityOverrides)
    .where(and(eq(capacityOverrides.tenantId, tenantId), eq(capacityOverrides.date, dueDate)));
  const eff = effectiveCapacity(tenant.defaultDailyCapacity, overrideRows[0]);
  if (eff.closed) return 'день закрыт';
  // Note: cancelled/expired/rejected orders never occupy capacity —
  // OCCUPYING_STATUSES excludes them, so a cancelled order frees its date slot.
  const dayOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.dueDate, dueDate),
        inArray(orders.status, [...OCCUPYING_STATUSES])
      )
    );
  return `занято ${usedUnits(dayOrders)} из ${eff.capacity} (заказов: ${dayOrders.length})`;
}

export async function loadOwnedOrder(
  tenantId: string,
  orderId: string
): Promise<typeof orders.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function orderCardKeyboard(orderId: string, status: string): Promise<InlineKeyboard> {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (status === 'new') {
    rows.push([{ text: ru.ownerOrders.accept, callback_data: `adm:ord:accept:${orderId}` }]);
    rows.push([{ text: ru.ownerOrders.reject, callback_data: `adm:ord:reject:${orderId}` }]);
    rows.push([{ text: ru.ownerOrders.newDate, callback_data: `adm:ord:date:${orderId}` }]);
  }
  if (status === 'confirmed') {
    rows.push([{ text: ru.ownerOrders.ready, callback_data: `adm:ord:ready:${orderId}` }]);
    rows.push([{ text: ru.ownerOrders.cancel, callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  if (status === 'ready') {
    rows.push([{ text: ru.ownerOrders.done, callback_data: `adm:ord:done:${orderId}` }]);
    rows.push([{ text: ru.ownerOrders.cancel, callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  if (status === 'payment_review') {
    rows.push([{ text: ru.ownerOrders.paid, callback_data: `adm:ord:paid:${orderId}` }]);
    rows.push([{ text: ru.ownerOrders.badpay, callback_data: `adm:ord:badpay:${orderId}` }]);
  }
  if (status === 'payment_review' || status === 'awaiting_payment') {
    rows.push([{ text: ru.ownerOrders.cancel, callback_data: `adm:ord:cancel:${orderId}` }]);
  }
  if (['new', 'awaiting_payment', 'payment_review', 'confirmed', 'ready'].includes(status)) {
    rows.push([{ text: ru.ownerOrders.msg, callback_data: `adm:ord:msg:${orderId}` }]);
  }
  const refs = await getDb()
    .select()
    .from(orderAttachments)
    .where(and(eq(orderAttachments.orderId, orderId), eq(orderAttachments.kind, 'reference')));
  if (refs.length > 0) {
    rows.push([
      { text: `${ru.ownerOrders.refs} (${refs.length})`, callback_data: `adm:ord:refs:${orderId}` },
    ]);
  }
  rows.push([{ text: ru.common.back, callback_data: 'adm:ord:list' }]);
  return { inline_keyboard: rows };
}

const OWNER_MONTH_NAMES = [
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
const OWNER_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function orderDateKeyboard(
  availability: Record<string, { available: boolean }>,
  year: number,
  month: number,
  orderId: string
): InlineKeyboard {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const rows: InlineKeyboard['inline_keyboard'] = [];
  rows.push(OWNER_WEEKDAYS.map((w) => ({ text: w, callback_data: 'cart:noop' })));

  const [y, m] = firstDay.split('-').map(Number);
  const startDate = new Date(Date.UTC(y!, m! - 1, 1));
  const offset = (startDate.getUTCDay() + 6) % 7;

  const cells: { text: string; callback_data: string }[] = [];
  for (let i = 0; i < offset; i++) cells.push({ text: ' ', callback_data: 'cart:noop' });

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const avail = availability[iso];
    if (avail?.available) {
      cells.push({ text: String(day), callback_data: `adm:ord:pd:${orderId}:${iso}` });
    } else {
      cells.push({ text: `${day} ✕`, callback_data: 'cart:noop' });
    }
  }
  while (cells.length % 7 !== 0) cells.push({ text: ' ', callback_data: 'cart:noop' });
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  rows.push([
    {
      text: '«',
      callback_data: `adm:ord:datepage:${orderId}:${addDays(firstDay, -1).slice(0, 7)}`,
    },
    { text: `${OWNER_MONTH_NAMES[month - 1]} ${year}`, callback_data: 'cart:noop' },
    {
      text: '»',
      callback_data: `adm:ord:datepage:${orderId}:${addDays(firstDay, 33).slice(0, 7)}`,
    },
  ]);
  rows.push([{ text: ru.common.back, callback_data: 'adm:ord:list' }]);
  return { inline_keyboard: rows };
}

export function registerOrderHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:ord:list$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.tenantId, ctx.tenant.id))
      .orderBy(desc(orders.createdAt))
      .limit(50);

    if (rows.length === 0) {
      await ctx.port.editMessageText(chatId, messageId, 'Заказов пока нет.', {
        keyboard: { inline_keyboard: [[{ text: ru.common.back, callback_data: 'adm:menu' }]] },
      });
      return;
    }

    const todayIso = toIsoDate(new Date(), ctx.tenant.timezone);
    const tomorrowIso = addDays(todayIso, 1);
    const isWork = (s: string) =>
      s === 'awaiting_payment' || s === 'payment_review' || s === 'confirmed';
    const groups: { title: string; orders: typeof rows }[] = [
      { title: 'Новые', orders: rows.filter((o) => o.status === 'new') },
      { title: 'В работе', orders: rows.filter((o) => isWork(o.status)) },
      { title: 'Готовые', orders: rows.filter((o) => o.status === 'ready') },
      {
        title: 'На сегодня и завтра',
        orders: rows.filter((o) => o.dueDate === todayIso || o.dueDate === tomorrowIso),
      },
    ];

    const lines: string[] = ['Заказы:'];
    const keyboardRows: InlineKeyboard['inline_keyboard'] = [];
    const shown = new Set<string>();
    for (const g of groups) {
      if (g.orders.length === 0) continue;
      lines.push('', `<b>${g.title}</b>`);
      for (const order of g.orders.slice(0, 8)) {
        lines.push(`• №${order.number} · ${order.status} · ${order.dueDate}`);
        if (!shown.has(order.id)) {
          shown.add(order.id);
          keyboardRows.push([
            {
              text: `№${order.number}`,
              callback_data: `adm:ord:view:${order.id}`,
            },
          ]);
        }
      }
    }
    keyboardRows.push([{ text: ru.common.back, callback_data: 'adm:menu' }]);

    await ctx.port.editMessageText(chatId, messageId, lines.join('\n'), {
      keyboard: { inline_keyboard: keyboardRows },
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^adm:ord:view:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:view:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const card = await buildOrderCardText(m[1]!, ctx.tenant.id, ctx.tenant.currency);
    if (!card) {
      await ctx.port.editMessageText(chatId, messageId, ru.my.notFound, {});
      return;
    }

    const rows = await getDb().select().from(orders).where(eq(orders.id, m[1]!)).limit(1);
    const status = rows[0]?.status ?? 'new';
    await ctx.port.editMessageText(chatId, messageId, card, {
      keyboard: await orderCardKeyboard(m[1]!, status),
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^adm:ord:msg:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:msg:([A-Za-z0-9_-]+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    ctx.sessionState = 'owner.reply_to_customer';
    ctx.session.ownerDraft = { kind: 'ord_msg', targetId: m[1] };

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageText(chatId, messageId, 'Напишите сообщение клиенту.', {
        keyboard: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:ord:list' }]] },
      });
    }
  });

  bot.callbackQuery(/^adm:ord:refs:(.+)$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^adm:ord:refs:(.+)$/.exec(ctx.callbackQuery.data);
    if (!m) return;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const db = getDb();
    const rows = await db.select().from(orders).where(eq(orders.id, m[1]!)).limit(1);
    const order = rows[0];
    if (!order || order.tenantId !== ctx.tenant.id) {
      await ctx.port.editMessageText(chatId, messageId, ru.my.notFound, {});
      return;
    }

    const refs = await db
      .select()
      .from(orderAttachments)
      .where(and(eq(orderAttachments.orderId, order.id), eq(orderAttachments.kind, 'reference')));

    if (refs.length === 0) {
      await ctx.port.editMessageText(chatId, messageId, 'Референсов нет.', {});
      return;
    }

    for (const ref of refs) {
      if (ref.fileType === 'photo') {
        await ctx.port.sendPhoto(ctx.callbackQuery.message!.chat.id, ref.fileId);
      } else {
        await ctx.port.sendDocument(ctx.callbackQuery.message!.chat.id, ref.fileId);
      }
    }
  });

  bot.callbackQuery(
    /^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel|date|datepage|pd):/,
    async (ctx) => {
      if (!canAccessOwner(ctx)) {
        await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
        return;
      }
      await ctx.port.answerCallback(ctx.callbackQuery.id);

      const m =
        /^adm:ord:(accept|reject|rr|paid|badpay|ready|done|cancel|date|datepage|pd):(.+)$/.exec(
          ctx.callbackQuery.data
        );
      if (!m) return;
      const action = m[1]!;
      const rest = m[2]!;

      const chatId = ctx.callbackQuery.message?.chat.id;
      const messageId = ctx.callbackQuery.message?.message_id;
      if (!chatId || !messageId) return;

      if (['accept', 'rr', 'paid', 'badpay', 'ready', 'done', 'cancel'].includes(action)) {
        const targetId = rest.split(':')[0]!;
        if (!(await loadOwnedOrder(ctx.tenant.id, targetId))) {
          await ctx.port.editMessageText(chatId, messageId, ru.my.notFound, {});
          return;
        }
      }

      if (action === 'accept') {
        const result = await applyOrderEvent(rest, 'owner_accept', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        if (result.value.status === 'awaiting_payment') {
          await sendPaymentCard(ctx.port, ctx.tenant.id, rest);
        } else {
          await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} принят в работу.`);
        }
        return;
      }

      if (action === 'reject') {
        // show reason picker
        const rows: InlineKeyboard['inline_keyboard'] = Object.entries(REJECT_REASONS).map(
          ([code, label]) => [{ text: label, callback_data: `adm:ord:rr:${rest}:${code}` }]
        );
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, `${card}\n\nПричина отказа?`, {
            keyboard: { inline_keyboard: rows },
            parseMode: 'HTML',
          });
        }
        return;
      }

      if (action === 'paid') {
        const result = await applyOrderEvent(rest, 'payment_confirmed', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(ctx.port, rest, () => 'Оплата подтверждена. Заказ в работе.');
        return;
      }

      if (action === 'badpay') {
        const result = await applyOrderEvent(rest, 'payment_rejected', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(
          ctx.port,
          rest,
          () =>
            'Оплата не подтверждена. Нажмите «Я оплатил» в сообщении с реквизитами и пришлите другой чек.'
        );
        return;
      }

      if (action === 'ready') {
        const result = await applyOrderEvent(rest, 'mark_ready', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} готов!`);
        return;
      }

      if (action === 'done') {
        const result = await applyOrderEvent(rest, 'mark_completed', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} завершён. Спасибо!`);
        return;
      }

      if (action === 'cancel') {
        const result = await applyOrderEvent(rest, 'owner_cancel', 'owner', new Date());
        if (!result.ok) return;
        const card = await buildOrderCardText(rest, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(rest, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(ctx.port, rest, (n) => `Заказ №${n} отменён мастером.`);
        return;
      }

      if (action === 'datepage') {
        const [orderId, ym] = rest.split(':');
        if (!orderId || !ym) return;
        const db = getDb();
        const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const order = rows[0];
        if (!order || order.tenantId !== ctx.tenant.id || order.status !== 'new') return;

        const monthStart = `${ym}-01`;
        const monthEndDate = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
        const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const cartLines = itemRows
          .filter((i) => i.productId !== null)
          .map((i, idx) => ({
            lineId: `l${idx}`,
            productId: i.productId!,
            qty: i.qty,
            optionIds: [] as string[],
          }));
        const avail = await getDateAvailability(
          ctx.tenant.id,
          monthStart,
          monthEndDate,
          { lines: cartLines },
          new Date()
        );
        const kb = orderDateKeyboard(
          avail,
          Number(ym.slice(0, 4)),
          Number(ym.slice(5, 7)),
          orderId
        );
        await ctx.port.editMessageText(
          chatId,
          messageId,
          `Предложите новую дату для заказа №${order.number}:`,
          { keyboard: kb, parseMode: 'HTML' }
        );
        return;
      }

      if (action === 'date') {
        const orderId = rest;
        const db = getDb();
        const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const order = rows[0];
        if (!order || order.tenantId !== ctx.tenant.id || order.status !== 'new') return;

        const monthStart = `${order.dueDate.slice(0, 7)}-01`;
        const monthEndDate = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
        const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const cartLines = itemRows
          .filter((i) => i.productId !== null)
          .map((i, idx) => ({
            lineId: `l${idx}`,
            productId: i.productId!,
            qty: i.qty,
            optionIds: [] as string[],
          }));
        const avail = await getDateAvailability(
          ctx.tenant.id,
          monthStart,
          monthEndDate,
          { lines: cartLines },
          new Date()
        );

        const kb: InlineKeyboard = orderDateKeyboard(
          avail,
          Number(monthStart.slice(0, 4)),
          Number(monthStart.slice(5, 7)),
          orderId
        );
        await ctx.port.editMessageText(
          chatId,
          messageId,
          `Предложите новую дату для заказа №${order.number}:`,
          { keyboard: kb, parseMode: 'HTML' }
        );
        return;
      }

      if (action === 'pd') {
        const parts = rest.split(':');
        const orderId = parts[0]!;
        const iso = parts[1]!;
        const db = getDb();
        const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const order = rows[0];
        if (!order || order.tenantId !== ctx.tenant.id || order.status !== 'new') return;

        const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const cartLines = itemRows
          .filter((i) => i.productId !== null)
          .map((i, idx) => ({
            lineId: `l${idx}`,
            productId: i.productId!,
            qty: i.qty,
            optionIds: [] as string[],
          }));
        const avail = await getDateAvailability(
          ctx.tenant.id,
          iso,
          iso,
          { lines: cartLines },
          new Date()
        );
        if (!avail[iso]?.available) {
          await ctx.port.answerCallback(ctx.callbackQuery.id, 'Дата уже недоступна.');
          return;
        }

        await db.update(orders).set({ proposedDate: iso }).where(eq(orders.id, orderId));

        const crows = await db
          .select()
          .from(customers)
          .where(eq(customers.id, order.customerId))
          .limit(1);
        const cust = crows[0];
        if (cust && !cust.botBlocked) {
          await ctx.port.sendMessage(
            cust.telegramId,
            `Мастер предлагает сдвинуть заказ №${(await getCustomerOrderNumber(orderId)) ?? order.number} на ${iso}. Подходит?`,
            {
              keyboard: {
                inline_keyboard: [
                  [{ text: 'Подходит', callback_data: `pd:yes:${orderId}` }],
                  [{ text: 'Не подходит', callback_data: `pd:no:${orderId}` }],
                ],
              },
            }
          );
        }

        const card = await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, { parseMode: 'HTML' });
        }
        return;
      }

      if (action === 'rr') {
        const [orderId, code] = rest.split(':');
        const reason = REJECT_REASONS[code!];
        if (!orderId || !reason) return;
        const result = await applyOrderEvent(orderId, 'owner_reject', 'owner', new Date());
        if (!result.ok) return;
        // store reason text only if the rejection actually landed
        const db = getDb();
        await db
          .update(orders)
          .set({ rejectReason: reason })
          .where(and(eq(orders.id, orderId), eq(orders.status, 'rejected')));
        const card = await buildOrderCardText(orderId, ctx.tenant.id, ctx.tenant.currency);
        if (card) {
          await ctx.port.editMessageText(chatId, messageId, card, {
            keyboard: await orderCardKeyboard(orderId, result.value.status),
            parseMode: 'HTML',
          });
        }
        await notifyCustomer(ctx.port, orderId, (n) => `Заказ №${n} отклонён: ${reason}`);
        return;
      }
    }
  );
}

async function notifyCustomer(
  port: TelegramPort,
  orderId: string,
  text: (number: number, total: number) => string
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer || customer.botBlocked) return;
  const customerNumber = (await getCustomerOrderNumber(orderId)) ?? order.number;
  await port.sendMessage(customer.telegramId, text(customerNumber, order.totalMinor), {
    parseMode: 'HTML',
  });
}
