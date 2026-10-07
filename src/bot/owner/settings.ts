import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { SETTINGS_FIELDS, isSettingsField, SettingsField } from '../../services/settings.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from '../../telegram/port.js';
import { beginOwnerDraft } from './edit-field.js';

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
  currency: 'Валюта',
};

export function registerSettingsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:set:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const decoded = decodeCallback(data);
    if (!decoded.ok || decoded.value.ns !== 'adm' || decoded.value.area !== 'set') return;
    const { action, arg } = decoded.value;

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (action === 'list') {
      const rows: InlineKeyboard['inline_keyboard'] = SETTINGS_FIELDS.map((f) => [
        { text: FIELD_LABELS[f], callback_data: `adm:set:edit:${f}` },
      ]);
      rows.push([
        {
          text: ctx.tenant.acceptOrders ? 'Перегруз: выключить приём' : 'Перегруз: включить приём',
          callback_data: 'adm:set:edit:toggle_accept',
        },
      ]);
      rows.push([{ text: ru.common.back, callback_data: 'adm:menu' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ru.ownerSettings.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (action === 'edit' && arg === 'toggle_accept') {
      const rows = await getDb()
        .select()
        .from(tenants)
        .where(eq(tenants.id, ctx.tenant.id))
        .limit(1);
      const t = rows[0];
      if (t) {
        await getDb()
          .update(tenants)
          .set({ acceptOrders: !t.acceptOrders })
          .where(eq(tenants.id, ctx.tenant.id));
      }
      const chatIdR = ctx.callbackQuery.message?.chat.id;
      const messageIdR = ctx.callbackQuery.message?.message_id;
      if (chatIdR && messageIdR) {
        const list = await getDb()
          .select()
          .from(tenants)
          .where(eq(tenants.id, ctx.tenant.id))
          .limit(1);
        const nowAccept = list[0]?.acceptOrders ?? true;
        await ctx.port.editMessageTextOrSend(
          chatIdR,
          messageIdR,
          nowAccept ? 'Приём заказов включён.' : 'Приём заказов выключен (режим «перегруз»).',
          {
            keyboard: {
              inline_keyboard: [[{ text: ru.common.back, callback_data: 'adm:set:list' }]],
            },
          }
        );
      }
      return;
    }

    if (action === 'edit' && arg && isSettingsField(arg)) {
      beginOwnerDraft(ctx, { kind: 'set_field', extra: { field: arg } });
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
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `${ru.ownerSettings.prompt}: ${FIELD_LABELS[arg]}\nТекущее значение: ${escapeHtml(currentText)}\n\n${ru.ownerSettings.hint}`,
        {
          keyboard: {
            inline_keyboard: [[{ text: ru.common.back, callback_data: 'adm:set:list' }]],
          },
        }
      );
      return;
    }
  });
}
