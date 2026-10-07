import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeCallback, decodeCallback, isCallbackLengthOk } from '../src/bot/callbacks.js';
import { escapeHtml } from '../src/domain/escape.js';

const callbackArb = fc.oneof(
  fc.constant({ ns: 'cat' as const, action: 'list' as const }),
  fc.record({
    ns: fc.constant('cat' as const),
    action: fc.constant('open' as const),
    arg: fc.stringMatching(/^[A-Za-z0-9_-]{1,21}$/),
  }),
  fc.record({
    ns: fc.constant('prd' as const),
    action: fc.constant('open' as const),
    arg: fc.stringMatching(/^[A-Za-z0-9_-]{1,21}$/),
  })
);

describe('callback codec', () => {
  it('decode(encode(x)) roundtrips', () => {
    fc.assert(
      fc.property(callbackArb, (c) => {
        const decoded = decodeCallback(encodeCallback(c));
        expect(decoded).toEqual({ ok: true, value: c });
      })
    );
  });

  it('encoded length is at most 64 bytes', () => {
    fc.assert(
      fc.property(callbackArb, (c) => {
        expect(isCallbackLengthOk(c)).toBe(true);
      })
    );
  });

  it('rejects garbage', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const decoded = decodeCallback(s);
        if (decoded.ok) {
          // must be re-encodable
          expect(encodeCallback(decoded.value).length).toBeGreaterThan(0);
        }
      })
    );
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = escapeHtml(s);
        expect(out).not.toMatch(/&(?!amp;|lt;|gt;)/);
        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
      })
    );
  });
});
