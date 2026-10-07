import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { listSources, deleteSource } from '../../services/sources.js';
import QRCode from 'qrcode';
import { beginOwnerDraft } from './edit-field.js';

export function registerLinksHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:src:/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (data === 'adm:src:list') {
      const items = await listSources(ctx.tenant.id);
      const rows: InlineKeyboard['inline_keyboard'] = items.map((s) => [
        { text: s.label, callback_data: `adm:src:view:${s.code}` },
      ]);
      rows.push([{ text: ctx.t.ownerLinks.add, callback_data: 'adm:src:add' }]);
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:menu' }]);
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        items.length > 0 ? ctx.t.ownerLinks.title : ctx.t.ownerLinks.empty,
        { keyboard: { inline_keyboard: rows } }
      );
      return;
    }

    if (data === 'adm:src:add') {
      beginOwnerDraft(ctx, { kind: 'src_add_label' });
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerLinks.promptLabel, {
        keyboard: {
          inline_keyboard: [[{ text: ctx.t.common.back, callback_data: 'adm:menu' }]],
        },
      });
      return;
    }

    const viewMatch = /^adm:src:view:([a-z0-9_-]+)$/.exec(data);
    if (viewMatch) {
      const code = viewMatch[1]!;
      const link = `https://t.me/${ctx.tenant.botUsername}?start=${code}`;
      const qr = await QRCode.toBuffer(link, { width: 320 });
      await ctx.port.sendPhoto(chatId, qr, `${code}\n${link}\n\n${ctx.t.ownerLinks.qrHint}`);
      await ctx.port.sendMessage(
        chatId,
        `${ctx.t.ownerLinks.linkCaption}\n\n${link}\n\n${ctx.t.ownerLinks.profileLabel}\n${ctx.t.ownerLinks.tplProfile(ctx.tenant.shopName, link)}\n\n${ctx.t.ownerLinks.commentLabel}\n${ctx.t.ownerLinks.tplComment(ctx.tenant.shopName, link)}\n\n${ctx.t.ownerLinks.autoLabel}\n${ctx.t.ownerLinks.tplAutoText(ctx.tenant.shopName, link)}`,
        {
          keyboard: {
            inline_keyboard: [
              [{ text: ctx.t.ownerCatalog.delete, callback_data: `adm:src:del:${code}` }],
              [{ text: ctx.t.common.back, callback_data: 'adm:src:list' }],
            ],
          },
        }
      );
      return;
    }

    const delMatch = /^adm:src:del:([a-z0-9_-]+)$/.exec(data);
    if (delMatch) {
      await deleteSource(ctx.tenant.id, delMatch[1]!);
      const items = await listSources(ctx.tenant.id);
      const rows: InlineKeyboard['inline_keyboard'] = items.map((s) => [
        { text: s.label, callback_data: `adm:src:view:${s.code}` },
      ]);
      rows.push([{ text: ctx.t.ownerLinks.add, callback_data: 'adm:src:add' }]);
      rows.push([{ text: ctx.t.common.back, callback_data: 'adm:menu' }]);
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerLinks.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }
  });
}
