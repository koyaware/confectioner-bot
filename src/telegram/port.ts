import { TelegramErrorCode } from '../types.js';

export interface ReplyKeyboardButton {
  text: string;
  requestContact?: boolean;
}

export interface ReplyKeyboardMarkup {
  keyboard: { text: string; request_contact?: boolean }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true;
}

export interface SendOpts {
  keyboard?: InlineKeyboard;
  parseMode?: 'HTML';
  /** Reply keyboard (e.g. a request-contact button). Not combinable with keyboard. */
  replyKeyboard?: ReplyKeyboardButton[][];
  /** Hide the reply keyboard. Not combinable with keyboard/replyKeyboard. */
  removeKeyboard?: boolean;
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
   * Edit message text, or send new if original was photo/document (no text to edit)
   */
  editMessageTextOrSend(
    chatId: number,
    messageId: number,
    text: string,
    opts?: SendOpts
  ): Promise<SendMessageResult>;

  /**
   * Replace the media of a photo message in place (one API call instead of
   * delete + sendPhoto). Caption follows the same 1024-char limit.
   */
  editMessageMedia(
    chatId: number,
    messageId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult>;

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
