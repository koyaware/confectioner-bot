import { Bot, InlineKeyboard, InputFile } from 'grammy';
import {
  TelegramPort,
  SendOpts,
  SendMessageResult,
  TelegramError,
  InlineKeyboard as PortInlineKeyboard,
} from './port.js';
import { TelegramErrorCode } from '../types.js';

function toGrammyKeyboard(keyboard?: PortInlineKeyboard): InlineKeyboard | undefined {
  if (!keyboard) {
    return undefined;
  }

  const grammy = new InlineKeyboard();
  for (const row of keyboard.inline_keyboard) {
    for (const btn of row) {
      if (btn.callback_data) {
        grammy.text(btn.text, btn.callback_data);
      } else if (btn.url) {
        grammy.url(btn.text, btn.url);
      } else {
        grammy.text(btn.text);
      }
    }
    grammy.row();
  }

  return grammy;
}

function fromGrammyError(error: unknown): TelegramErrorCode {
  // Map grammy errors to our error codes
  const err = error as { description?: string; error_code?: number };
  const description = err?.description || '';
  const code = err?.error_code;

  if (description.includes('blocked') || description.includes('bot was blocked')) {
    return 'BLOCKED';
  }

  if (code === 429 || description.includes('Too Many Requests')) {
    return 'RATE_LIMIT';
  }

  if (code === 404 || description.includes('not found')) {
    return 'NOT_FOUND';
  }

  return 'OTHER';
}

export class GrammyPort implements TelegramPort {
  private bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<SendMessageResult> {
    try {
      const keyboard = toGrammyKeyboard(opts?.keyboard);
      const options: { reply_markup?: InlineKeyboard; parse_mode?: 'HTML' } = {};
      if (keyboard) {
        options.reply_markup = keyboard;
      }
      if (opts?.parseMode) {
        options.parse_mode = opts.parseMode;
      }

      const message = await this.bot.api.sendMessage(chatId, text, options);
      return { messageId: message.message_id };
    } catch (error) {
      throw new TelegramError(fromGrammyError(error), 'Failed to send message', error);
    }
  }

  async sendPhoto(
    chatId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult> {
    try {
      const keyboard = toGrammyKeyboard(opts?.keyboard);
      const options: { reply_markup?: InlineKeyboard; parse_mode?: 'HTML'; caption?: string } = {};
      if (keyboard) {
        options.reply_markup = keyboard;
      }
      if (opts?.parseMode) {
        options.parse_mode = opts.parseMode;
      }
      if (caption) {
        options.caption = caption;
      }

      const photoInput = typeof photo === 'string' ? photo : new InputFile(photo);
      const message = await this.bot.api.sendPhoto(chatId, photoInput, options);
      return { messageId: message.message_id };
    } catch (error) {
      throw new TelegramError(fromGrammyError(error), 'Failed to send photo', error);
    }
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: SendOpts
  ): Promise<void> {
    try {
      const keyboard = toGrammyKeyboard(opts?.keyboard);
      const options: {
        chat_id: number;
        message_id: number;
        reply_markup?: InlineKeyboard;
        parse_mode?: 'HTML';
      } = {
        chat_id: chatId,
        message_id: messageId,
      };
      if (keyboard) {
        options.reply_markup = keyboard;
      }
      if (opts?.parseMode) {
        options.parse_mode = opts.parseMode;
      }

      await this.bot.api.editMessageText(chatId, messageId, text, options);
    } catch (error) {
      throw new TelegramError(fromGrammyError(error), 'Failed to edit message', error);
    }
  }

  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await this.bot.api.answerCallbackQuery(callbackQueryId, { text });
    } catch (error) {
      throw new TelegramError(fromGrammyError(error), 'Failed to answer callback', error);
    }
  }

  async copyMessage(
    toChatId: number,
    fromChatId: number,
    messageId: number
  ): Promise<SendMessageResult> {
    try {
      const message = await this.bot.api.copyMessage(toChatId, fromChatId, messageId);
      return { messageId: message.message_id };
    } catch (error) {
      throw new TelegramError(fromGrammyError(error), 'Failed to copy message', error);
    }
  }

  /**
   * Get the underlying grammy bot instance (for runner integration)
   */
  getBot(): Bot {
    return this.bot;
  }
}
