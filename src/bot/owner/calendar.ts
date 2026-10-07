import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { addDays, monthEndOf } from '../../lib/time.js';
import { getCapacityForDate, setCapacityForDate } from '../../services/calendar.js';
import { getDateAvailability } from '../../services/dates.js';

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

function calendarGrid(year: number, month: number, marks: Map<string, string>): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  rows.push(
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => ({
      text: w,
      callback_data: 'cart:noop',
    }))
  );

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const [y, m, d] = firstDay.split('-').map(Number);
  const offset = (new Date(Date.UTC(y!, m! - 1, d)).getUTCDay() + 6) % 7;

  const cells: { text: string; callback_data: string }[] = [];
  for (let i = 0; i < offset; i++) cells.push({ text: ' ', callback_data: 'cart:noop' });

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ text: marks.get(iso) ?? String(day), callback_data: `adm:cal:day:${iso}` });
  }
  while (cells.length % 7 !== 0) cells.push({ text: ' ', callback_data: 'cart:noop' });
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const prev = addDays(firstDay, -1).slice(0, 7);
  const next = addDays(firstDay, 33).slice(0, 7);
  rows.push([
    { text: '«', callback_data: `adm:cal:page:${prev}` },
    { text: `${MONTH_NAMES[month - 1]} ${year}`, callback_data: 'cart:noop' },
    { text: '»', callback_data: `adm:cal:page:${next}` },
  ]);
  rows.push([{ text: 'Назад', callback_data: 'adm:menu' }]);
  return { inline_keyboard: rows };
}

export function registerCalendarHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:cal:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    const data = ctx.callbackQuery.data;

    if (data === 'adm:cal:list') {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const monthStart = `${today.slice(0, 7)}-01`;
      const monthEnd = monthEndOf(monthStart);
      const marks = new Map<string, string>();
      const availability = await getDateAvailability(
        ctx.tenant.id,
        monthStart,
        monthEnd,
        { lines: [] },
        now
      );
      for (const [date, entry] of Object.entries(availability)) {
        marks.set(
          date,
          entry.available ? String(Number(date.slice(8))) : `${Number(date.slice(8))} ✕`
        );
      }
      const kb = calendarGrid(Number(today.slice(0, 4)), Number(today.slice(5, 7)), marks);
      await ctx.port.editMessageText(chatId, messageId, ru.ownerCalendar.title, {
        keyboard: kb,
      });
      return;
    }

    const pageMatch = /^adm:cal:page:(\d{4}-\d{2})$/.exec(data);
    if (pageMatch) {
      const ym = pageMatch[1]!;
      const monthStart = `${ym}-01`;
      const monthEnd = monthEndOf(monthStart);
      const availability = await getDateAvailability(
        ctx.tenant.id,
        monthStart,
        monthEnd,
        { lines: [] },
        new Date()
      );
      const marks = new Map<string, string>();
      for (const [date, entry] of Object.entries(availability)) {
        marks.set(
          date,
          entry.available ? String(Number(date.slice(8))) : `${Number(date.slice(8))} ✕`
        );
      }
      const kb = calendarGrid(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), marks);
      await ctx.port.editMessageText(chatId, messageId, ru.ownerCalendar.title, {
        keyboard: kb,
      });
      return;
    }

    const dayMatch = /^adm:cal:day:(\d{4}-\d{2}-\d{2})$/.exec(data);
    if (dayMatch) {
      const date = dayMatch[1]!;
      const info = await getCapacityForDate(ctx.tenant.id, date);
      const current = info.isOverride ? info.capacity : ctx.tenant.defaultDailyCapacity;
      const closed = info.isOverride ? info.isClosed : false;
      const rows: InlineKeyboard['inline_keyboard'] = [
        [
          {
            text: closed ? ru.ownerCalendar.open : ru.ownerCalendar.close,
            callback_data: `adm:cal:toggle:${date}`,
          },
        ],
        [{ text: ru.ownerCalendar.setCapacity, callback_data: `adm:cal:setcap:${date}` }],
        [{ text: ru.catalog.back, callback_data: 'adm:cal:list' }],
      ];
      await ctx.port.editMessageText(
        chatId,
        messageId,
        `${date}\n${closed ? ru.ownerCalendar.closed : ru.ownerCalendar.openDay}\nЛимит: ${current}`,
        { keyboard: { inline_keyboard: rows } }
      );
      return;
    }

    const toggleMatch = /^adm:cal:toggle:(\d{4}-\d{2}-\d{2})$/.exec(data);
    if (toggleMatch) {
      const date = toggleMatch[1]!;
      const info = await getCapacityForDate(ctx.tenant.id, date);
      const capacity = info.isOverride ? info.capacity! : ctx.tenant.defaultDailyCapacity;
      await setCapacityForDate(ctx.tenant.id, date, capacity, !(info.isOverride && info.isClosed));
      // show date screen again
      await showDateScreen(ctx, date, chatId, messageId);
      return;
    }

    const setcapMatch = /^adm:cal:setcap:(\d{4}-\d{2}-\d{2})$/.exec(data);
    if (setcapMatch) {
      const date = setcapMatch[1]!;
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'cal_capacity', targetId: date };
      await ctx.port.editMessageText(chatId, messageId, ru.ownerCalendar.promptCapacity, {
        keyboard: { inline_keyboard: [[{ text: 'Назад', callback_data: `adm:cal:day:${date}` }]] },
      });
      return;
    }
  });
}

async function showDateScreen(
  ctx: BotContextWithSession,
  date: string,
  chatId: number,
  messageId: number
): Promise<void> {
  const info = await getCapacityForDate(ctx.tenant.id, date);
  const current = info.isOverride ? info.capacity : ctx.tenant.defaultDailyCapacity;
  const closed = info.isOverride ? info.isClosed : false;
  const rows: InlineKeyboard['inline_keyboard'] = [
    [
      {
        text: closed ? ru.ownerCalendar.open : ru.ownerCalendar.close,
        callback_data: `adm:cal:toggle:${date}`,
      },
    ],
    [{ text: ru.ownerCalendar.setCapacity, callback_data: `adm:cal:setcap:${date}` }],
    [{ text: ru.catalog.back, callback_data: 'adm:cal:list' }],
  ];
  await ctx.port.editMessageText(
    chatId,
    messageId,
    `${date}\n${closed ? ru.ownerCalendar.closed : ru.ownerCalendar.openDay}\nЛимит: ${current}`,
    { keyboard: { inline_keyboard: rows } }
  );
}
