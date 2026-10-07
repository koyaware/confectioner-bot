import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { canAccessOwner } from '../permissions.js';
import { InlineKeyboard } from '../../telegram/port.js';
import { clearContactKeyboard } from '../customer/contact-keyboard.js';
import { escapeHtml } from '../../domain/escape.js';

export function ownerMenuKeyboard(ctx: BotContextWithSession): InlineKeyboard {
  const s = ctx.t.menu.ownerSections;
  return {
    inline_keyboard: [
      [
        { text: s.orders, callback_data: 'adm:ord:list' },
        { text: s.catalog, callback_data: 'adm:cat:list' },
      ],
      [
        { text: s.faq, callback_data: 'adm:faq:list' },
        { text: s.calendar, callback_data: 'adm:cal:list' },
      ],
      [
        { text: s.settings, callback_data: 'adm:set:list' },
        { text: s.links, callback_data: 'adm:src:list' },
      ],
      [
        { text: s.stats, callback_data: 'adm:stats' },
        { text: s.preview, callback_data: 'adm:preview' },
      ],
    ],
  };
}

export function customerMenuKeyboard(ctx: BotContextWithSession): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: ctx.t.start.buttonCatalog, callback_data: 'cat:list' }],
      [
        { text: ctx.t.cart.button, callback_data: 'cart:show' },
        { text: ctx.t.my.button, callback_data: 'my:list' },
      ],
      [{ text: ctx.t.faq.button, callback_data: 'faq:list' }],
      [{ text: ctx.t.contacts.button, callback_data: 'cnt:show' }],
    ],
  };
}

export function registerMenuHandler(bot: Bot<BotContextWithSession>): void {
  bot.command('menu', async (ctx) => {
    await clearContactKeyboard(ctx);
    ctx.sessionState = 'idle';
    ctx.session.cart = ctx.session.cart ?? { lines: [] };
    ctx.session.checkout = undefined;
    ctx.session.paymentOrderId = undefined;
    ctx.session.ownerDraft = undefined;
    ctx.session.selections = undefined;

    const isOwner = canAccessOwner(ctx);

    if (isOwner) {
      await ctx.port.sendMessage(ctx.chat.id, ctx.t.menu.ownerTitle, {
        keyboard: ownerMenuKeyboard(ctx),
        parseMode: 'HTML',
      });
      return;
    }

    await ctx.port.sendMessage(ctx.chat.id, ctx.t.menu.customerTitle, {
      keyboard: customerMenuKeyboard(ctx),
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^nav:menu$/, async (ctx) => {
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    await clearContactKeyboard(ctx);
    ctx.sessionState = 'idle';
    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    if (canAccessOwner(ctx)) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.menu.ownerTitle, {
        keyboard: ownerMenuKeyboard(ctx),
        parseMode: 'HTML',
      });
      return;
    }

    await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.menu.customerTitle, {
      keyboard: customerMenuKeyboard(ctx),
      parseMode: 'HTML',
    });
  });

  bot.callbackQuery(/^adm:preview$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const userName = escapeHtml(ctx.from?.first_name ?? ctx.t.common.guest);
    const greeting = ctx.tenant.greetingText
      ? escapeHtml(ctx.tenant.greetingText)
      : ctx.t.start.greeting(escapeHtml(ctx.tenant.shopName), userName);
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [{ text: ctx.t.start.buttonCatalog, callback_data: 'cat:list' }],
        [
          { text: ctx.t.cart.button, callback_data: 'cart:show' },
          { text: ctx.t.my.button, callback_data: 'my:list' },
        ],
        [{ text: ctx.t.faq.button, callback_data: 'faq:list' }],
        [{ text: ctx.t.common.back, callback_data: 'adm:menu' }],
      ],
    };

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageTextOrSend(
        chatId,
        messageId,
        `${ctx.t.menu.clientPreview}\n\n${greeting}`,
        {
          keyboard,
          parseMode: 'HTML',
        }
      );
    }
  });

  bot.callbackQuery(/^adm:menu$/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const chatId = ctx.callbackQuery.message?.chat.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !messageId) return;

    await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.menu.ownerTitle, {
      keyboard: ownerMenuKeyboard(ctx),
      parseMode: 'HTML',
    });
  });
}
