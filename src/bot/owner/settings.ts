import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { escapeHtml } from '../../domain/escape.js';
import { SETTINGS_FIELDS, isSettingsField } from '../../services/settings.js';
import { stringsFor, isLang, currencyForCode, type Strings } from '../../i18n/index.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from '../../telegram/port.js';
import { beginOwnerDraft } from './edit-field.js';

function currencyCodeForSymbol(symbol: string): 'rub' | 'kzt' | 'uzs' | null {
  if (symbol === '₽') return 'rub';
  if (symbol === '₸') return 'kzt';
  if (symbol === 'UZS') return 'uzs';
  return null;
}

async function showSettingsList(
  ctx: BotContextWithSession,
  chatId: number,
  messageId: number,
  t: Strings = ctx.t
): Promise<void> {
  const curCode = currencyCodeForSymbol(ctx.tenant.currency);
  const rows: InlineKeyboard['inline_keyboard'] = SETTINGS_FIELDS.map((f) => [
    { text: t.ownerSettings.fields[f], callback_data: `adm:set:edit:${f}` },
  ]);
  rows.push([
    {
      text: `${t.ownerSettings.langTitle}: ${t.ownerSettings.langNames[ctx.tenant.language] ?? ctx.tenant.language}`,
      callback_data: 'adm:set:lang',
    },
  ]);
  rows.push([
    {
      text: `${t.ownerSettings.curTitle}: ${curCode ? t.ownerSettings.curNames[curCode] : ctx.tenant.currency}`,
      callback_data: 'adm:set:cur',
    },
  ]);
  rows.push([
    {
      text: ctx.tenant.acceptOrders
        ? t.ownerSettings.overloadDisable
        : t.ownerSettings.overloadEnable,
      callback_data: 'adm:set:edit:toggle_accept',
    },
  ]);
  rows.push([{ text: t.common.back, callback_data: 'adm:menu' }]);
  await ctx.port.editMessageTextOrSend(chatId, messageId, t.ownerSettings.title, {
    keyboard: { inline_keyboard: rows },
  });
}

export function registerSettingsHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:set:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
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
      await showSettingsList(ctx, chatId, messageId);
      return;
    }

    if (action === 'lang' && !arg) {
      const rows: InlineKeyboard['inline_keyboard'] = (['ru', 'uz'] as const).map((code) => [
        {
          text: `${ctx.tenant.language === code ? '✅ ' : ''}${ctx.t.ownerSettings.langNames[code]}`,
          callback_data: `adm:set:lang:${code}`,
        },
      ]);
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:set:list' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerSettings.langTitle, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (action === 'lang' && arg && isLang(arg)) {
      await getDb().update(tenants).set({ language: arg }).where(eq(tenants.id, ctx.tenant.id));
      ctx.tenant.language = arg;
      // ctx.t is stale (resolved from the old language): render with fresh strings.
      await showSettingsList(ctx, chatId, messageId, stringsFor(arg));
      return;
    }

    if (action === 'cur' && !arg) {
      const curCode = currencyCodeForSymbol(ctx.tenant.currency);
      const rows: InlineKeyboard['inline_keyboard'] = (['rub', 'kzt', 'uzs'] as const).map(
        (code) => [
          {
            text: `${curCode === code ? '✅ ' : ''}${ctx.t.ownerSettings.curNames[code]}`,
            callback_data: `adm:set:cur:${code}`,
          },
        ]
      );
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:set:list' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerSettings.curTitle, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }

    if (action === 'cur' && arg) {
      const symbol = currencyForCode(arg);
      if (symbol) {
        await getDb()
          .update(tenants)
          .set({ currency: symbol })
          .where(eq(tenants.id, ctx.tenant.id));
        ctx.tenant.currency = symbol;
      }
      await showSettingsList(ctx, chatId, messageId);
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
          nowAccept ? ctx.t.ownerSettings.overloadOn : ctx.t.ownerSettings.overloadOff,
          {
            keyboard: {
              inline_keyboard: [[{ text: ctx.t.common.back, callback_data: 'adm:set:list' }]],
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
        `${ctx.t.ownerSettings.prompt}: ${ctx.t.ownerSettings.fields[arg]}\nТекущее значение: ${escapeHtml(currentText)}\n\n${ctx.t.ownerSettings.hint}`,
        {
          keyboard: {
            inline_keyboard: [[{ text: ctx.t.common.back, callback_data: 'adm:set:list' }]],
          },
        }
      );
      return;
    }
  });
}
