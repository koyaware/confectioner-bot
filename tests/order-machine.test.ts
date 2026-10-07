import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { transition, TERMINAL_STATUSES, MachineOrder } from '../src/domain/order-machine.js';
import { OrderEvent, OrderStatus } from '../src/types.js';

const ALL_STATUSES: OrderStatus[] = [
  'new',
  'awaiting_payment',
  'payment_review',
  'confirmed',
  'ready',
  'completed',
  'rejected',
  'cancelled',
  'expired',
];

const ALL_EVENTS: OrderEvent[] = [
  'owner_accept',
  'owner_reject',
  'owner_cancel',
  'customer_cancel',
  'receipt_uploaded',
  'payment_confirmed',
  'payment_rejected',
  'payment_timeout',
  'mark_ready',
  'mark_completed',
];

describe('order machine invariants', () => {
  it('never leaves the valid status set on any event sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_EVENTS), { maxLength: 30 }),
        fc.integer({ min: 0, max: 10000 }),
        (events, prepayment) => {
          let status: OrderStatus = 'new';
          for (const e of events) {
            const r = transition({ status, prepaymentMinor: prepayment }, e);
            if (r.ok) {
              status = r.value.status;
            }
            expect(ALL_STATUSES).toContain(status);
          }
        }
      )
    );
  });

  it('terminal statuses have no outgoing transitions', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL_STATUSES), fc.constantFrom(...ALL_EVENTS), (s, e) => {
        const r = transition({ status: s, prepaymentMinor: 100 }, e);
        expect(r.ok).toBe(false);
      })
    );
  });

  it('accept goes to awaiting_payment iff prepayment > 0, else confirmed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (prepayment) => {
        const r = transition({ status: 'new', prepaymentMinor: prepayment }, 'owner_accept');
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.status).toBe(prepayment > 0 ? 'awaiting_payment' : 'confirmed');
        }
      })
    );
  });
});
