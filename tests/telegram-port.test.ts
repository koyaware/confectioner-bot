import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramError, TelegramPort } from '../src/telegram/port.js';
import { FakePort } from '../src/telegram/fake-port.js';

describe('TelegramPort', () => {
  describe('TelegramError', () => {
    it('creates error with code and message', () => {
      const error = new TelegramError('RATE_LIMIT', 'Too many requests');
      expect(error.code).toBe('RATE_LIMIT');
      expect(error.message).toBe('Too many requests');
      expect(error.name).toBe('TelegramError');
    });

    it('can include cause', () => {
      const cause = new Error('Original error');
      const error = new TelegramError('NETWORK', 'Network failed', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('FakePort', () => {
    let fakePort: FakePort;

    beforeEach(() => {
      fakePort = new FakePort();
    });

    it('records sendMessage calls', async () => {
      await fakePort.sendMessage(123, 'Hello', {
        keyboard: {
          inline_keyboard: [[{ text: 'Button', callback_data: 'test' }]],
        },
      });

      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('sendMessage');
      expect(calls[0]?.args[0]).toBe(123);
      expect(calls[0]?.args[1]).toBe('Hello');
    });

    it('validates message text length', async () => {
      const longText = 'x'.repeat(5000);
      await expect(fakePort.sendMessage(123, longText)).rejects.toThrow('Text too long');
    });

    it('validates callback data length', async () => {
      const longCallback = 'x'.repeat(100);
      await expect(
        fakePort.sendMessage(123, 'Hello', {
          keyboard: {
            inline_keyboard: [[{ text: 'Button', callback_data: longCallback }]],
          },
        })
      ).rejects.toThrow('Callback data too long');
    });

    it('validates callback data length in bytes, not chars', async () => {
      const cyrillicCallback = 'я'.repeat(33); // 66 bytes in UTF-8
      await expect(
        fakePort.sendMessage(123, 'Hello', {
          keyboard: {
            inline_keyboard: [[{ text: 'Button', callback_data: cyrillicCallback }]],
          },
        })
      ).rejects.toThrow('Callback data too long');
    });

    it('records sendPhoto calls', async () => {
      await fakePort.sendPhoto(123, 'photo-url', 'Caption');
      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('sendPhoto');
      expect(calls[0]?.args[2]).toBe('Caption');
    });

    it('validates caption length', async () => {
      const longCaption = 'x'.repeat(2000);
      await expect(fakePort.sendPhoto(123, 'photo-url', longCaption)).rejects.toThrow(
        'Caption too long'
      );
    });

    it('records editMessageText calls', async () => {
      await fakePort.editMessageText(123, 456, 'Updated text');
      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('editMessageText');
      expect(calls[0]?.args[2]).toBe('Updated text');
    });

    it('records editMessageTextOrSend calls', async () => {
      const result = await fakePort.editMessageTextOrSend(123, 456, 'Updated text');
      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('editMessageTextOrSend');
      expect(calls[0]?.args[2]).toBe('Updated text');
      expect(result.messageId).toBeGreaterThan(0);
    });

    it('records answerCallback calls', async () => {
      await fakePort.answerCallback('callback-id', 'Answer');
      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('answerCallback');
      expect(calls[0]?.args[1]).toBe('Answer');
    });

    it('records copyMessage calls', async () => {
      await fakePort.copyMessage(123, 456, 789);
      const calls = fakePort.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('copyMessage');
      expect(calls[0]?.args[0]).toBe(123);
    });

    it('clears recorded calls', async () => {
      await fakePort.sendMessage(123, 'Hello');
      expect(fakePort.getCalls()).toHaveLength(1);
      fakePort.clearCalls();
      expect(fakePort.getCalls()).toHaveLength(0);
    });

    describe('error injection', () => {
      it('injects RATE_LIMIT on method call', async () => {
        fakePort.addErrorRule('sendMessage', 'RATE_LIMIT', 'Too Many Requests');
        await expect(fakePort.sendMessage(123, 'Hello')).rejects.toMatchObject({
          code: 'RATE_LIMIT',
          message: 'Too Many Requests',
        });
      });

      it('injects RATE_LIMIT on Nth call', async () => {
        fakePort.addRateLimitOnNthCall('sendMessage', 2);
        await fakePort.sendMessage(123, 'First'); // should succeed
        await expect(fakePort.sendMessage(123, 'Second')).rejects.toMatchObject({
          code: 'RATE_LIMIT',
        });
        await fakePort.sendMessage(123, 'Third'); // should succeed again
        expect(fakePort.getCalls()).toHaveLength(3);
      });

      it('injects BLOCKED on first call', async () => {
        fakePort.addBlockedOnFirstCall('sendMessage');
        await expect(fakePort.sendMessage(123, 'Hello')).rejects.toMatchObject({
          code: 'BLOCKED',
        });
        // Second call should succeed
        await fakePort.sendMessage(123, 'Hello');
        expect(fakePort.getCalls()).toHaveLength(2);
      });

      it('injects NETWORK error', async () => {
        fakePort.addNetworkError('sendMessage');
        await expect(fakePort.sendMessage(123, 'Hello')).rejects.toMatchObject({
          code: 'NETWORK',
        });
      });

      it('injects network error on all methods', async () => {
        const portWithNetwork = new FakePort(true);
        await expect(portWithNetwork.sendMessage(123, 'Hello')).rejects.toMatchObject({
          code: 'NETWORK',
        });
      });

      it('clears error rules', async () => {
        fakePort.addErrorRule('sendMessage', 'RATE_LIMIT');
        fakePort.clearErrorRules();
        await fakePort.sendMessage(123, 'Hello'); // Should succeed
        expect(fakePort.getCalls()).toHaveLength(1);
      });

      it('respects error count limit', async () => {
        fakePort.addErrorRule('sendMessage', 'RATE_LIMIT', 'Rate limited', 1);
        await expect(fakePort.sendMessage(123, 'First')).rejects.toMatchObject({
          code: 'RATE_LIMIT',
        });
        await fakePort.sendMessage(123, 'Second'); // Should succeed
        expect(fakePort.getCalls()).toHaveLength(2);
      });
    });

    describe('call filtering', () => {
      beforeEach(async () => {
        await fakePort.sendMessage(123, 'Hello');
        await fakePort.sendPhoto(456, 'photo', 'Caption');
        await fakePort.sendMessage(789, 'World');
      });

      it('filters calls by method', () => {
        const sendMessageCalls = fakePort.getCallsForMethod('sendMessage');
        expect(sendMessageCalls).toHaveLength(2);
        expect(sendMessageCalls[0]?.args[1]).toBe('Hello');
        expect(sendMessageCalls[1]?.args[1]).toBe('World');

        const photoCalls = fakePort.getCallsForMethod('sendPhoto');
        expect(photoCalls).toHaveLength(1);
        expect(photoCalls[0]?.args[2]).toBe('Caption');
      });

      it('gets last call', () => {
        const lastCall = fakePort.getLastCall();
        expect(lastCall?.method).toBe('sendMessage');
        expect(lastCall?.args[1]).toBe('World');
      });
    });
  });

  describe('contract validation', () => {
    let fakePort: FakePort;

    beforeEach(() => {
      fakePort = new FakePort();
    });

    it('rejects empty message text', async () => {
      await expect(fakePort.sendMessage(123, '')).rejects.toThrow('Text must not be empty');
    });

    it('rejects text with only whitespace', async () => {
      await expect(fakePort.sendMessage(123, '   ')).rejects.toThrow('Text must not be empty');
    });

    it('accepts valid callback data', async () => {
      await fakePort.sendMessage(123, 'Hello', {
        keyboard: {
          inline_keyboard: [[{ text: 'Button', callback_data: 'short' }]],
        },
      });
      expect(fakePort.getCalls()).toHaveLength(1);
    });

    it('returns increasing message IDs', async () => {
      const result1 = await fakePort.sendMessage(123, 'First');
      const result2 = await fakePort.sendMessage(456, 'Second');
      expect(result2.messageId).toBeGreaterThan(result1.messageId);
    });
  });
});
