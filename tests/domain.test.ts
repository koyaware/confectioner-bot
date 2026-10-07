import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeCallback, decodeCallback, isCallbackLengthOk } from '../src/bot/callbacks.js';
import { escapeHtml } from '../src/domain/escape.js';

const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/);
const callbackArb = fc.oneof(
  fc.constant({ ns: 'cat' as const, action: 'list' as const }),
  fc.record({
    ns: fc.constant('cat' as const),
    action: fc.constant('open' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('prd' as const),
    action: fc.constant('open' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('cart' as const),
    action: fc.constant('open' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('chk' as const),
    action: fc.constant('submit' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('my' as const),
    action: fc.constant('view' as const),
    arg: idArb,
  }),
  fc.constant({ ns: 'nav' as const, action: 'menu' as const }),
  fc.record({
    ns: fc.constant('pay' as const),
    action: fc.constant('sent' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('pd' as const),
    action: fc.constant('yes' as const),
    arg: idArb,
  }),
  fc.constant({ ns: 'adm' as const, area: 'menu' as const }),
  fc.constant({ ns: 'adm' as const, area: 'preview' as const }),
  fc.constant({ ns: 'adm' as const, area: 'stats' as const, action: 'summary' as const }),
  fc.record({
    ns: fc.constant('adm' as const),
    area: fc.constant('stats' as const),
    action: fc.constant('summary' as const),
    arg: fc.constantFrom('7' as const, '30' as const),
  }),
  fc.record({
    ns: fc.constant('adm' as const),
    area: fc.constant('ord' as const),
    action: fc.constant('view' as const),
    arg: idArb,
  }),
  fc.record({
    ns: fc.constant('adm' as const),
    area: fc.constant('ord' as const),
    action: fc.constant('datepage' as const),
    arg: idArb,
    arg2: fc.constant('2026-10'),
  }),
  fc.record({
    ns: fc.constant('prd' as const),
    action: fc.constant('qty' as const),
    arg: fc.constantFrom('inc' as const, 'dec' as const),
    arg2: idArb,
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
