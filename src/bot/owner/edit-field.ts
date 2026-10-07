import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import * as editor from '../../services/catalog-editor.js';
import { createFaq, updateFaq } from '../../services/faq.js';
import {
  validateSetting,
  updateTenantSetting,
  SettingsField,
  SETTINGS_FIELDS,
} from '../../services/settings.js';
import { getCapacityForDate, setCapacityForDate } from '../../services/calendar.js';

const tenantFieldCheck: Record<string, true> = Object.fromEntries(
  SETTINGS_FIELDS.map((f) => [f, true])
);

function parsePriceRubles(s: string): number | null {
  const m = /^(\d+)([.,](\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const rubles = Number(m[1]);
  const kopecks = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
  return rubles * 100 + kopecks;
}

export function registerEditFieldHandlers(bot: Bot<BotContextWithSession>): void {
  bot.on('message:text', async (ctx, next) => {
    if (
      ctx.role !== 'owner' ||
      ctx.sessionState !== 'owner.edit_field' ||
      !ctx.session.ownerDraft
    ) {
      await next();
      return;
    }
    const draft = ctx.session.ownerDraft;

    const text = ctx.message.text.trim();
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;

    switch (draft.kind) {
      case 'cat_add': {
        if (text.length === 0 || text.length > 64) {
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badTitle);
          return;
        }
        await editor.createCategory(ctx.tenant.id, text);
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'cat_rename': {
        if (draft.targetId && text.length > 0) {
          await editor.updateCategoryTitle(ctx.tenant.id, draft.targetId, text);
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'prd_add_title': {
        if (draft.targetId && text.length > 0) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = {
            kind: 'prd_add_price',
            targetId: draft.targetId,
            extra: { title: text },
          };
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.promptProductPrice);
          return;
        }
        return;
      }
      case 'prd_add_price': {
        const priceMinor = parsePriceRubles(text);
        if (priceMinor === null || priceMinor <= 0) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badPrice);
          return;
        }
        if (draft.targetId && draft.extra?.title) {
          await editor.createProduct(ctx.tenant.id, draft.targetId, draft.extra.title, priceMinor);
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        }
        return;
      }
      case 'prd_field': {
        const field = draft.extra?.field;
        if (draft.targetId && field) {
          if (field === 'title') {
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { title: text });
          } else if (field === 'description') {
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { description: text });
          } else if (field === 'price') {
            const priceMinor = parsePriceRubles(text);
            if (priceMinor === null || priceMinor <= 0) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badPrice);
              return;
            }
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { priceMinor });
          } else if (field === 'unit') {
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { unit: text });
          } else if (field === 'lead') {
            const days = Number(text);
            if (!Number.isInteger(days) || days < 0) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badNumber);
              return;
            }
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { leadDays: days });
          } else if (field === 'capacity') {
            const units = Number(text);
            if (!Number.isInteger(units) || units < 1) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badNumber);
              return;
            }
            await editor.updateProduct(ctx.tenant.id, draft.targetId, { capacityUnits: units });
          }
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'opt_add_group': {
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = {
          kind: 'opt_add_title',
          targetId: draft.targetId,
          extra: { group: text },
        };
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.promptOptionTitle);
        return;
      }
      case 'opt_add_title': {
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = {
          kind: 'opt_add_delta',
          targetId: draft.targetId,
          extra: { group: draft.extra!.group!, title: text },
        };
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.promptOptionDelta);
        return;
      }
      case 'opt_add_delta': {
        const d = parsePriceRubles(text);
        if (d === null || d < 0) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.badPrice);
          return;
        }
        if (draft.targetId && draft.extra?.group && draft.extra?.title) {
          await editor.addOption(draft.targetId, draft.extra.group, draft.extra.title, d);
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'faq_add_question': {
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = { kind: 'faq_add_answer', extra: { question: text } };
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerFaq.promptAnswer);
        return;
      }
      case 'faq_add_answer': {
        if (draft.extra?.question && text) {
          await createFaq(ctx.tenant.id, draft.extra.question, text);
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'faq_edit_q': {
        if (draft.targetId && text) {
          await updateFaq(ctx.tenant.id, draft.targetId, { question: text });
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'faq_edit_a': {
        if (draft.targetId && text) {
          await updateFaq(ctx.tenant.id, draft.targetId, { answer: text });
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        return;
      }
      case 'cal_capacity': {
        const n = Number(text);
        if (draft.targetId && Number.isInteger(n) && n >= 0) {
          const current = await getCapacityForDate(ctx.tenant.id, draft.targetId);
          const closed = current.isOverride ? current.isClosed : false;
          await setCapacityForDate(ctx.tenant.id, draft.targetId, n, closed);
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
        } else {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await ctx.port.sendMessage(ctx.chat.id, ru.ownerCalendar.badCapacity);
        }
        return;
      }
      case 'set_field': {
        const field = draft.extra?.field;
        if (field && field in tenantFieldCheck) {
          const result = validateSetting(field as SettingsField, text);
          if (!result.ok) {
            ctx.sessionState = 'owner.edit_field';
            ctx.session.ownerDraft = draft;
            await ctx.port.sendMessage(ctx.chat.id, ru.ownerSettings.badValue);
            return;
          }
          await updateTenantSetting(ctx.tenant.id, field as SettingsField, result.value);
        }
        await ctx.port.sendMessage(ctx.chat.id, ru.ownerSettings.saved);
        return;
      }
    }
  });

  bot.on('message:photo', async (ctx, next) => {
    if (
      ctx.role !== 'owner' ||
      ctx.sessionState !== 'owner.edit_field' ||
      !ctx.session.ownerDraft
    ) {
      await next();
      return;
    }
    const draft = ctx.session.ownerDraft;
    if (!draft || draft.kind !== 'prd_field' || draft.extra?.field !== 'photo') {
      await next();
      return;
    }

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (photo && draft.targetId) {
      await editor.updateProduct(ctx.tenant.id, draft.targetId, { photoFileId: photo.file_id });
    }
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
  });

  bot.on('message:document', async (ctx, next) => {
    if (
      ctx.role !== 'owner' ||
      ctx.sessionState !== 'owner.edit_field' ||
      !ctx.session.ownerDraft
    ) {
      await next();
      return;
    }
    const draft = ctx.session.ownerDraft;
    if (!draft || draft.kind !== 'prd_field' || draft.extra?.field !== 'photo') {
      await next();
      return;
    }

    const doc = ctx.message.document;
    if (doc && draft.targetId) {
      await editor.updateProduct(ctx.tenant.id, draft.targetId, { photoFileId: doc.file_id });
    }
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    await ctx.port.sendMessage(ctx.chat.id, ru.ownerCatalog.saved);
  });
}
