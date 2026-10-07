import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { InlineKeyboard } from '../../telegram/port.js';
import {
  createCategory,
  updateCategoryTitle,
  createProduct,
  updateProduct,
  addOption,
} from '../../services/catalog-editor.js';
import { createFaq, updateFaq } from '../../services/faq.js';
import {
  validateSetting,
  updateTenantSetting,
  SettingsField,
  SETTINGS_FIELDS,
} from '../../services/settings.js';
import { getCapacityForDate, setCapacityForDate } from '../../services/calendar.js';
import { showDateScreen } from './calendar.js';
import { addSource } from '../../services/sources.js';

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

function badText(text: string, max: number): boolean {
  return text.length === 0 || text.length > max;
}

export function beginOwnerDraft(
  ctx: BotContextWithSession,
  draft: NonNullable<BotContextWithSession['session']['ownerDraft']>
): void {
  const screenId = ctx.callbackQuery?.message?.message_id;
  ctx.sessionState = 'owner.edit_field';
  ctx.session.ownerDraft = {
    ...draft,
    extra: { ...(draft.extra ?? {}), ...(screenId ? { screen: String(screenId) } : {}) },
  };
}

type OwnerDraft = NonNullable<BotContextWithSession['session']['ownerDraft']>;

function draftScreen(
  ctx: BotContextWithSession,
  draft: OwnerDraft | undefined = ctx.session.ownerDraft
): number | null {
  const raw = draft?.extra?.screen;
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function editScreenOrSend(
  ctx: BotContextWithSession,
  draft: OwnerDraft | undefined,
  text: string,
  keyboard?: InlineKeyboard['inline_keyboard']
): Promise<number | null> {
  if (!ctx.chat) return null;
  const screenId = draftScreen(ctx, draft);
  if (screenId) {
    try {
      await ctx.port.editMessageTextOrSend(ctx.chat.id, screenId, text, {
        keyboard: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
      return screenId;
    } catch {
      // screen gone; fall through to a fresh message
    }
  }
  const sent = await ctx.port.sendMessage(
    ctx.chat.id,
    text,
    keyboard ? { keyboard: { inline_keyboard: keyboard } } : undefined
  );
  return sent.messageId;
}

function chainDraft(draft: OwnerDraft, kind: string, extra?: Record<string, string>): OwnerDraft {
  return {
    kind,
    targetId: draft.targetId,
    extra: {
      ...(extra ?? {}),
      ...(draft.extra?.screen ? { screen: draft.extra.screen } : {}),
    },
  };
}

function backTargetForDraft(draft: OwnerDraft): string | null {
  const id = draft.targetId;
  if (draft.kind === 'cat_rename' && id) return `adm:cat:edit:${id}`;
  if (draft.kind === 'prd_field' && id) return `adm:prd:edit:${id}`;
  if ((draft.kind === 'prd_add_title' || draft.kind === 'prd_add_price') && id) {
    return `adm:cat:edit:${id}`;
  }
  if (draft.kind.startsWith('opt_') && id) return `adm:prd:opt:${id}`;
  if ((draft.kind === 'faq_edit_q' || draft.kind === 'faq_edit_a') && id) {
    return `adm:faq:edit:${id}`;
  }
  if (draft.kind === 'cal_capacity' && id) return `adm:cal:day:${id}`;
  if (
    draft.kind.startsWith('cat_') ||
    draft.kind.startsWith('prd_') ||
    draft.kind.startsWith('opt_')
  ) {
    return 'adm:cat:list';
  }
  if (draft.kind.startsWith('faq_')) {
    return 'adm:faq:list';
  }
  if (draft.kind === 'src_add_label') {
    return 'adm:src:list';
  }
  if (draft.kind === 'set_field') {
    return 'adm:set:list';
  }

  return null;
}

async function sendSaved(
  ctx: BotContextWithSession,
  draft: OwnerDraft,
  text: string
): Promise<void> {
  if (!ctx.chat) return;
  const back = backTargetForDraft(draft);
  await editScreenOrSend(
    ctx,
    draft,
    text,
    back ? [[{ text: ctx.t.common.back, callback_data: back }]] : undefined
  );
}

export function registerEditFieldHandlers(bot: Bot<BotContextWithSession>): void {
  bot.on('message:text', async (ctx, next) => {
    if (
      !canAccessOwner(ctx) ||
      ctx.sessionState !== 'owner.edit_field' ||
      !ctx.session.ownerDraft
    ) {
      await next();
      return;
    }
    const draft = ctx.session.ownerDraft;

    const text = ctx.message.text.trim();
    const userMessageId = ctx.message.message_id;
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    try {
      await ctx.port.deleteMessage(ctx.chat.id, userMessageId);
    } catch {
      // already gone
    }

    switch (draft.kind) {
      case 'cat_add': {
        if (text.length === 0 || text.length > 64) {
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        await createCategory(ctx.tenant.id, text);
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'cat_rename': {
        if (!draft.targetId || badText(text, 64)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        await updateCategoryTitle(ctx.tenant.id, draft.targetId, text);
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'prd_add_title': {
        if (!draft.targetId || badText(text, 200)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = chainDraft(draft, 'prd_add_price', { title: text });
        await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.promptProductPrice);
        return;
      }
      case 'prd_add_price': {
        const priceMinor = parsePriceRubles(text);
        if (priceMinor === null || priceMinor <= 0) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badPrice);
          return;
        }
        if (draft.targetId && draft.extra?.title) {
          await createProduct(ctx.tenant.id, draft.targetId, draft.extra.title, priceMinor);
          await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        }
        return;
      }
      case 'prd_field': {
        const field = draft.extra?.field;
        if (draft.targetId && field) {
          if (field === 'photo') {
            ctx.sessionState = 'owner.edit_field';
            ctx.session.ownerDraft = draft;
            await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.promptPhoto);
            return;
          }
          if (field === 'title') {
            if (badText(text, 200)) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { title: text });
          } else if (field === 'description') {
            if (badText(text, 1000)) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.common.badText);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { description: text });
          } else if (field === 'price') {
            const priceMinor = parsePriceRubles(text);
            if (priceMinor === null || priceMinor <= 0) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badPrice);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { priceMinor });
          } else if (field === 'unit') {
            if (badText(text, 20)) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { unit: text });
          } else if (field === 'lead') {
            const days = Number(text);
            if (!Number.isInteger(days) || days < 0) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badNumber);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { leadDays: days });
          } else if (field === 'capacity') {
            const units = Number(text);
            if (!Number.isInteger(units) || units < 1) {
              ctx.sessionState = 'owner.edit_field';
              ctx.session.ownerDraft = draft;
              await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badNumber);
              return;
            }
            await updateProduct(ctx.tenant.id, draft.targetId, { capacityUnits: units });
          }
        }
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'opt_add_group': {
        if (badText(text, 100)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = chainDraft(draft, 'opt_add_title', { group: text });
        await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.promptOptionTitle);
        return;
      }
      case 'opt_add_title': {
        if (badText(text, 100)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = chainDraft(draft, 'opt_add_delta', {
          group: draft.extra!.group!,
          title: text,
        });
        await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.promptOptionDelta);
        return;
      }
      case 'opt_add_delta': {
        const d = parsePriceRubles(text);
        if (d === null || d < 0) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badPrice);
          return;
        }
        if (draft.targetId && draft.extra?.group && draft.extra?.title) {
          const added = await addOption(
            ctx.tenant.id,
            draft.targetId,
            draft.extra.group,
            draft.extra.title,
            d
          );
          if (!added.ok) {
            await editScreenOrSend(ctx, draft, ctx.t.product.notFound);
            return;
          }
        }
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'faq_add_question': {
        if (badText(text, 300)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = chainDraft(draft, 'faq_add_answer', { question: text });
        await editScreenOrSend(ctx, draft, ctx.t.ownerFaq.promptAnswer);
        return;
      }
      case 'faq_add_answer': {
        if (!draft.extra?.question || badText(text, 2000)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.common.badText);
          return;
        }
        await createFaq(ctx.tenant.id, draft.extra.question, text);
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'faq_edit_q': {
        if (!draft.targetId || badText(text, 300)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCatalog.badTitle);
          return;
        }
        await updateFaq(ctx.tenant.id, draft.targetId, { question: text });
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'faq_edit_a': {
        if (!draft.targetId || badText(text, 2000)) {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.common.badText);
          return;
        }
        await updateFaq(ctx.tenant.id, draft.targetId, { answer: text });
        await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
        return;
      }
      case 'cal_capacity': {
        const n = Number(text);
        const messageId = ctx.message?.message_id;
        if (messageId) {
          try {
            await ctx.port.deleteMessage(ctx.chat.id, messageId);
          } catch {
            // already gone
          }
        }
        if (draft.targetId && Number.isInteger(n) && n >= 0) {
          const current = await getCapacityForDate(ctx.tenant.id, draft.targetId);
          const closed = current.isOverride ? current.isClosed : false;
          await setCapacityForDate(ctx.tenant.id, draft.targetId, n, closed);
          ctx.sessionState = 'idle';
          ctx.session.ownerDraft = undefined;
          const sentId = await editScreenOrSend(ctx, draft, ctx.t.ownerCalendar.savedLimit);
          if (sentId) {
            await showDateScreen(ctx, draft.targetId, ctx.chat.id, sentId);
          }
        } else {
          ctx.sessionState = 'owner.edit_field';
          ctx.session.ownerDraft = draft;
          await editScreenOrSend(ctx, draft, ctx.t.ownerCalendar.badCapacity);
        }
        return;
      }
      case 'src_add_label': {
        const result = await addSource(ctx.tenant.id, text);
        if (result.ok) {
          await editScreenOrSend(ctx, draft, ctx.t.ownerLinks.labelCreated(result.code), [
            [{ text: ctx.t.common.back, callback_data: 'adm:src:list' }],
          ]);
        } else {
          await editScreenOrSend(ctx, draft, ctx.t.ownerLinks.badLabel);
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
            await editScreenOrSend(ctx, draft, ctx.t.ownerSettings.badValue);
            return;
          }
          await updateTenantSetting(ctx.tenant.id, field as SettingsField, result.value);
        }
        await sendSaved(ctx, draft, ctx.t.ownerSettings.saved);
        return;
      }
    }
  });

  bot.on('message:photo', async (ctx, next) => {
    if (
      !canAccessOwner(ctx) ||
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

    try {
      await ctx.port.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch {
      // already gone
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (photo && draft.targetId) {
      await updateProduct(ctx.tenant.id, draft.targetId, { photoFileId: photo.file_id });
    }
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
  });

  bot.on('message:document', async (ctx, next) => {
    if (
      !canAccessOwner(ctx) ||
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

    try {
      await ctx.port.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch {
      // already gone
    }
    const doc = ctx.message.document;
    if (doc && draft.targetId) {
      await updateProduct(ctx.tenant.id, draft.targetId, { photoFileId: doc.file_id });
    }
    ctx.sessionState = 'idle';
    ctx.session.ownerDraft = undefined;
    await sendSaved(ctx, draft, ctx.t.ownerCatalog.saved);
  });
}
