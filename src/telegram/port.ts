import { TelegramErrorCode } from '../types.js';

export interface SendOpts {
  keyboard?: InlineKeyboard;
  parseMode?: 'HTML';
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageResult {
  messageId: number;
}

export class TelegramError extends Error {
  constructor(
    public readonly code: TelegramErrorCode,
    message?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

/**
 * Abstraction over Telegram Bot API.
 * All Telegram operations go through this interface.
 */
export interface TelegramPort {
  /**
   * Send a text message
   */
  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<SendMessageResult>;

  /**
   * Send a photo
   */
  sendPhoto(
    chatId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult>;

  /**
   * Edit message text
   */
  editMessageText(chatId: number, messageId: number, text: string, opts?: SendOpts): Promise<void>;

  /**
   * Answer a callback query
   */
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;

  /**
   * Copy a message from one chat to another
   */
  copyMessage(toChatId: number, fromChatId: number, messageId: number): Promise<SendMessageResult>;

  /**
   * Delete a message. Best effort: NOT_FOUND means it is already gone.
   */
  deleteMessage(chatId: number, messageId: number): Promise<void>;

  /**
   * Send a document
   */
  sendDocument(
    chatId: number,
    document: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult>;
}
