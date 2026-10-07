import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { priceLine, priceOrder, requiredLeadDays } from '../src/domain/pricing.js';

describe('pricing invariants', () => {
  it('priceOrder total equals items + delivery, prepayment within [0, total]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 50 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100 }),
        (lines, deliveryFee, percent) => {
          const r = priceOrder(lines, deliveryFee, percent);
          expect(r.total).toBe(r.items + deliveryFee);
          expect(r.items).toBe(lines.reduce((a, b) => a + b, 0));
          expect(r.prepayment).toBeGreaterThanOrEqual(0);
          expect(r.prepayment).toBeLessThanOrEqual(r.total);
          expect(Number.isInteger(r.total)).toBe(true);
          expect(Number.isInteger(r.prepayment)).toBe(true);
        }
      )
    );
  });

  it('prepayment is ceil(total*percent/100)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        (total, percent) => {
          const r = priceOrder([total], 0, percent);
          expect(r.prepayment).toBe(Math.ceil((total * percent) / 100));
        }
      )
    );
  });

  it('priceLine is unit*qty with option deltas, non-negative integer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: -50_000, max: 50_000 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 50 }),
        (unit, deltas, qty) => {
          const p = priceLine(unit, deltas, qty);
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
          if (qty > 0 && unit + deltas.reduce((a, b) => a + b, 0) > 0) {
            expect(p).toBe((unit + deltas.reduce((a, b) => a + b, 0)) * qty);
          }
        }
      )
    );
  });

  it('requiredLeadDays is max of product lead days and tenant min', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }), { maxLength: 20 }),
        fc.integer({ min: 0, max: 30 }),
        (leads, tenantMin) => {
          const r = requiredLeadDays(leads, tenantMin);
          expect(r).toBeGreaterThanOrEqual(tenantMin);
          for (const l of leads) {
            if (l !== null) expect(r).toBeGreaterThanOrEqual(l);
          }
        }
      )
    );
  });
});
