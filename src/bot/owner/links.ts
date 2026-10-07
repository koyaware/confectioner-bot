import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { ru } from '../../i18n/ru.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { listSources, deleteSource } from '../../services/sources.js';
import QRCode from 'qrcode';

export function registerLinksHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:src:/, async (ctx) => {
    if (ctx.role !== 'owner') {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
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
      rows.push([{ text: ru.ownerLinks.add, callback_data: 'adm:src:add' }]);
      await ctx.port.editMessageText(
        chatId,
        messageId,
        items.length > 0 ? ru.ownerLinks.title : ru.ownerLinks.empty,
        { keyboard: { inline_keyboard: rows } }
      );
      return;
    }

    if (data === 'adm:src:add') {
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'src_add_label' };
      await ctx.port.editMessageText(chatId, messageId, ru.ownerLinks.promptLabel);
      return;
    }

    const viewMatch = /^adm:src:view:([a-z0-9_-]+)$/.exec(data);
    if (viewMatch) {
      const code = viewMatch[1]!;
      const link = `https://t.me/${ctx.tenant.botUsername}?start=${code}`;
      const qr = await QRCode.toBuffer(link, { width: 320 });
      await ctx.port.sendPhoto(chatId, qr, ru.ownerLinks.qrHint);
      await ctx.port.sendMessage(
        chatId,
        `${ru.ownerLinks.linkCaption}\n\n${link}\n\nШапка профиля:\n${ru.ownerLinks.tplProfile(ctx.tenant.shopName, link)}\n\nЗакреп. комментарий:\n${ru.ownerLinks.tplComment(ctx.tenant.shopName, link)}\n\nАвтоответ директа:\n${ru.ownerLinks.tplAutoText(ctx.tenant.shopName, link)}`
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
      rows.push([{ text: ru.ownerLinks.add, callback_data: 'adm:src:add' }]);
      await ctx.port.editMessageText(chatId, messageId, ru.ownerLinks.title, {
        keyboard: { inline_keyboard: rows },
      });
      return;
    }
  });
}
