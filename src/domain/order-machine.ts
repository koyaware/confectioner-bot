import { OrderEvent, OrderStatus } from '../types.js';
import { Result } from '../types.js';

export interface MachineOrder {
  status: OrderStatus;
  prepaymentMinor: number;
}

export interface Transition {
  event: OrderEvent;
  from: OrderStatus[];
  to: (order: MachineOrder) => OrderStatus;
}

const TRANSITIONS: Transition[] = [
  {
    event: 'owner_accept',
    from: ['new'],
    to: (o) => (o.prepaymentMinor > 0 ? 'awaiting_payment' : 'confirmed'),
  },
  { event: 'owner_reject', from: ['new'], to: () => 'rejected' },
  { event: 'customer_cancel', from: ['new', 'awaiting_payment'], to: () => 'cancelled' },
  { event: 'receipt_uploaded', from: ['awaiting_payment'], to: () => 'payment_review' },
  { event: 'payment_confirmed', from: ['payment_review'], to: () => 'confirmed' },
  { event: 'payment_rejected', from: ['payment_review'], to: () => 'awaiting_payment' },
  { event: 'payment_timeout', from: ['awaiting_payment'], to: () => 'expired' },
  {
    event: 'owner_cancel',
    from: ['awaiting_payment', 'payment_review', 'confirmed', 'ready'],
    to: () => 'cancelled',
  },
  { event: 'mark_ready', from: ['confirmed'], to: () => 'ready' },
  { event: 'mark_completed', from: ['ready'], to: () => 'completed' },
];

export function transition(
  order: MachineOrder,
  event: OrderEvent
): Result<{ status: OrderStatus }, 'ILLEGAL_TRANSITION'> {
  const t = TRANSITIONS.find((t) => t.event === event && t.from.includes(order.status));
  if (!t) {
    return { ok: false, error: 'ILLEGAL_TRANSITION' };
  }
  return { ok: true, value: { status: t.to(order) } };
}

export const TERMINAL_STATUSES: OrderStatus[] = ['rejected', 'cancelled', 'expired', 'completed'];
