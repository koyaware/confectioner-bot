import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { getDateAvailability, DateAvailability } from '../../services/dates.js';
import { addDays } from '../../domain/dates.js';
import { InlineKeyboard } from '../../telegram/port.js';

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

export function calendarKeyboard(
  availability: DateAvailability,
  year: number,
  month: number // 1-12
): InlineKeyboard {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;

  const rows: InlineKeyboard['inline_keyboard'] = [];
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  rows.push(weekdays.map((w) => ({ text: w, callback_data: 'cart:noop' })));

  const [y, m, d] = firstDay.split('-').map(Number);
  const startDate = new Date(Date.UTC(y!, m! - 1, d));
  // Monday-first offset
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

export function registerCheckoutHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^chk:datepage:/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const m = /^chk:datepage:(\d{4})-(\d{2})$/.exec(ctx.callbackQuery.data);
    if (!m) return;
    const year = Number(m[1]);
    const month = Number(m[2]);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);

    const availability = await getDateAvailability(
      ctx.tenant.id,
      monthStart,
      monthEnd,
      ctx.session.cart,
      new Date()
    );

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

    // Re-validate availability before accepting the date
    const monthStart = `${iso.slice(0, 7)}-01`;
    const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
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
        { keyboard: calendarKeyboard(avail, Number(iso.slice(0, 4)), Number(iso.slice(5, 7))) }
      );
      return;
    }

    ctx.session.checkout = ctx.session.checkout ?? { checkoutId: '', referenceFileIds: [] };
    ctx.session.checkout.dueDate = iso;
    ctx.sessionState = 'checkout.time';

    await ctx.port.editMessageText(chatId, messageId, `${ru.checkout.dateSelected}: ${iso}`);
  });
}
