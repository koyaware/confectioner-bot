import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { SETTINGS_FIELDS, isSettingsField, SettingsField } from '../../services/settings.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from '../../telegram/port.js';

const FIELD_LABELS: Record<SettingsField, string> = {
  greetingText: 'Приветствие',
  aboutText: 'О нас',
  contactsText: 'Контакты',
  deliveryText: 'Доставка',
  paymentText: 'Реквизиты',
  busyText: 'Текст «перегруз»',
  replySlaText: 'SLA ответа',
  prepaymentPercent: 'Предоплата %',
  minLeadDays: 'Мин. срок, дней',
  maxAdvanceDays: 'Макс. горизонт, дней',
  defaultDailyCapacity: 'Лимит заказов в день',
  paymentDeadlineHours: 'Срок оплаты, часов',
  deliveryFeeMinor: 'Стоимость доставки, ₽',
  digestHour: 'Час сводки',
};

export function registerSettingsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:set:/, async (ctx) => {
    if (ctx.role !== 'owner') {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'adm' || decoded.value.area !== 'set') return;
    const { action, arg } = decoded.value;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (action === 'list') {
      const rows: InlineKeyboard['inline_keyboard'] = SETTINGS_FIELDS.map((f) => [
        { text: FIELD_LABELS[f], callback_data: `adm:set:edit:${f}` },
      ]);
      await ctx.port.editMessageText(chatId, messageId, ru.ownerSettings.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (action === 'edit' && arg && isSettingsField(arg)) {
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'set_field', extra: { field: arg } };
      const rows = await getDb()
        .select()
        .from(tenants)
        .where(eq(tenants.id, ctx.tenant.id))
        .limit(1);
      const tenantRow = rows[0];
      const current = tenantRow
        ? (tenantRow[arg as keyof typeof tenantRow] as string | number | null)
        : null;
      let currentText: string;
      if (arg === 'deliveryFeeMinor' && typeof current === 'number') {
        currentText = String(current / 100);
      } else {
        currentText = current === null || current === undefined ? '—' : String(current);
      }
      await ctx.port.editMessageText(
        chatId,
        messageId,
        `${ru.ownerSettings.prompt}: ${FIELD_LABELS[arg]}\nТекущее значение: ${escapeHtml(currentText)}\n\n${ru.ownerSettings.hint}`
      );
      return;
    }
  });
}
