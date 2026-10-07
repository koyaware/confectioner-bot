import { describe, it, expect } from 'vitest';
import { sessionDataSchema } from '../src/bot/middleware/session.js';
import type { SessionData } from '../src/types.js';

// Guards the type<->schema parity: every SessionData field must survive
// a store->load round trip (zod strips unknown keys by default, which once
// silently broke the contact keyboard cleanup).
describe('session schema parity', () => {
  it('preserves every SessionData field', () => {
    const full: SessionData = {
      cart: { lines: [{ lineId: 'l1', productId: 'p1', qty: 2, optionIds: ['o1'] }] },
      checkout: {
        checkoutId: 'c1',
        dueDate: '2026-10-12',
        dueTimeText: 'k 15:00',
        fulfillment: 'delivery',
        address: 'addr',
        contactName: 'Ivan',
        contactPhone: '+79990000000',
        comment: 'hi',
        referenceFileIds: [{ fileId: 'f1', fileType: 'photo' }],
        screenMessageId: 7,
      },
      ownerDraft: { kind: 'k', targetId: 't', extra: { a: 'b' } },
      paymentOrderId: 'o1',
      paymentScreenId: 8,
      contactKbMsgId: 9,
      lastAutoReplyAt: 10,
      refsMessageIds: [11],
      antispam: { windowStart: 12, count: 3 },
      selections: { p1: ['o1'] },
    };
    const parsed = sessionDataSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(full);
    }
  });
});
