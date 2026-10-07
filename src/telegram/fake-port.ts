import { TelegramPort, SendOpts, SendMessageResult, TelegramError } from './port.js';
import { TelegramErrorCode } from '../types.js';

export interface FakePortCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

export interface CallMatcher {
  (call: FakePortCall): boolean;
}

export interface ErrorInjectionRule {
  matcher: CallMatcher;
  error: TelegramError;
  count?: number; // How many times to trigger, undefined = always
  triggered: number; // Internal counter
}

/**
 * Fake TelegramPort for testing.
 * Records all calls and allows error injection.
 */
export class FakePort implements TelegramPort {
  private calls: FakePortCall[] = [];
  private messageCounter = 0;
  private errorRules: ErrorInjectionRule[] = [];

  constructor(private readonly shouldThrowNetworkError?: boolean) {}

  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('sendMessage', [chatId, text, opts]);
      this.checkErrorRules(call);

      // Validation
      if (!text.trim()) {
        throw new TelegramError('OTHER', 'Text must not be empty');
      }
      if (text.length > 4096) {
        throw new TelegramError('OTHER', 'Text too long (max 4096 chars)');
      }
      if (opts?.keyboard?.inline_keyboard) {
        for (const row of opts.keyboard.inline_keyboard) {
          for (const btn of row) {
            if (btn.callback_data && Buffer.byteLength(btn.callback_data, 'utf8') > 64) {
              throw new TelegramError('OTHER', 'Callback data too long (max 64 bytes)');
            }
          }
        }
      }

      const messageId = ++this.messageCounter;
      return { messageId };
    });
  }

  sendPhoto(
    chatId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('sendPhoto', [chatId, photo, caption, opts]);
      this.checkErrorRules(call);

      // Validate caption length
      if (caption && caption.length > 1024) {
        throw new TelegramError('OTHER', 'Caption too long (max 1024 chars)');
      }

      const messageId = ++this.messageCounter;
      return { messageId };
    });
  }

  editMessageText(chatId: number, messageId: number, text: string, opts?: SendOpts): Promise<void> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('editMessageText', [chatId, messageId, text, opts]);
      this.checkErrorRules(call);

      // Validation
      if (text.length > 4096) {
        throw new TelegramError('OTHER', 'Text too long (max 4096 chars)');
      }
    });
  }

  editMessageMedia(
    chatId: number,
    messageId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('editMessageMedia', [chatId, messageId, photo, caption, opts]);
      this.checkErrorRules(call);

      if (caption && caption.length > 1024) {
        throw new TelegramError('OTHER', 'Caption too long (max 1024 chars)');
      }

      return { messageId };
    });
  }

  answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('answerCallback', [callbackQueryId, text]);
      this.checkErrorRules(call);
    });
  }

  copyMessage(toChatId: number, fromChatId: number, messageId: number): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('copyMessage', [toChatId, fromChatId, messageId]);
      this.checkErrorRules(call);

      const copiedId = ++this.messageCounter;
      return { messageId: copiedId };
    });
  }

  deleteMessage(chatId: number, messageId: number): Promise<void> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('deleteMessage', [chatId, messageId]);
      this.checkErrorRules(call);
    });
  }

  editMessageTextOrSend(
    chatId: number,
    _messageId: number,
    text: string,
    opts?: SendOpts
  ): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('editMessageTextOrSend', [chatId, _messageId, text, opts]);
      this.checkErrorRules(call);

      if (text.length > 4096) {
        throw new TelegramError('OTHER', 'Text too long (max 4096 chars)');
      }

      const messageId = ++this.messageCounter;
      return { messageId };
    });
  }

  sendDocument(
    chatId: number,
    document: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<SendMessageResult> {
    return Promise.resolve().then(() => {
      const call = this.recordCall('sendDocument', [chatId, document, caption, opts]);
      this.checkErrorRules(call);

      if (caption && caption.length > 1024) {
        throw new TelegramError('OTHER', 'Caption too long (max 1024 chars)');
      }

      const messageId = ++this.messageCounter;
      return { messageId };
    });
  }

  /**
   * Add an error injection rule
   */
  addErrorRule(
    matcher: CallMatcher | string,
    code: TelegramErrorCode,
    message?: string,
    count?: number
  ): void {
    const matcherFn =
      typeof matcher === 'string' ? (call: FakePortCall) => call.method === matcher : matcher;

    this.errorRules.push({
      matcher: matcherFn,
      error: new TelegramError(code, message),
      count,
      triggered: 0,
    });
  }

  /**
   * Add a RATE_LIMIT error on the Nth call
   */
  addRateLimitOnNthCall(method: string, nth: number): void {
    let callCount = 0;
    this.addErrorRule(
      (call) => {
        if (call.method !== method) return false;
        callCount++;
        return callCount === nth;
      },
      'RATE_LIMIT',
      'Too Many Requests',
      1
    );
  }

  /**
   * Add a BLOCKED error on first call
   */
  addBlockedOnFirstCall(method: string): void {
    let first = true;
    this.addErrorRule(
      (call) => {
        if (call.method !== method) return false;
        if (first) {
          first = false;
          return true;
        }
        return false;
      },
      'BLOCKED',
      'Bot was blocked by the user'
    );
  }

  /**
   * Add a NETWORK error that always triggers
   */
  addNetworkError(method?: string): void {
    const matcher = method ? (call: FakePortCall) => call.method === method : () => true;
    this.addErrorRule(matcher, 'NETWORK', 'Network error');
  }

  /**
   * Clear all error rules
   */
  clearErrorRules(): void {
    this.errorRules = [];
  }

  /**
   * Get all recorded calls
   */
  getCalls(): FakePortCall[] {
    return [...this.calls];
  }

  /**
   * Get calls for a specific method
   */
  getCallsForMethod(method: string): FakePortCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /**
   * Get last call
   */
  getLastCall(): FakePortCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Simulate network error if configured
   */
  private maybeThrowNetworkError(): void {
    if (this.shouldThrowNetworkError) {
      throw new TelegramError('NETWORK', 'Simulated network error');
    }
  }

  private recordCall(method: string, args: unknown[]): FakePortCall {
    const call: FakePortCall = {
      method,
      args,
      timestamp: Date.now(),
    };
    this.calls.push(call);
    return call;
  }

  private checkErrorRules(call: FakePortCall): void {
    this.maybeThrowNetworkError();

    for (const rule of this.errorRules) {
      if (rule.matcher(call)) {
        rule.triggered++;
        if (rule.count === undefined || rule.triggered <= rule.count) {
          throw rule.error;
        }
      }
    }
  }
}
