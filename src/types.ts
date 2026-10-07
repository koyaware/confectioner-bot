// Common types used across the application
export type Minor = number; // Integer, minor currency units
export type IsoDate = string; // YYYY-MM-DD in tenant's timezone
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export type OrderStatus =
  | 'new'
  | 'awaiting_payment'
  | 'payment_review'
  | 'confirmed'
  | 'ready'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type OrderEvent =
  | 'owner_accept'
  | 'owner_reject'
  | 'owner_cancel'
  | 'customer_cancel'
  | 'receipt_uploaded'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'payment_timeout'
  | 'mark_ready'
  | 'mark_completed';

export type CartLine = {
  lineId: string;
  productId: string;
  qty: number;
  optionIds: string[];
};

export type Cart = {
  lines: CartLine[];
};

export type CheckoutDraft = {
  checkoutId: string; // nanoid, also used as idempotencyKey
  dueDate?: IsoDate;
  dueTimeText?: string;
  fulfillment?: 'pickup' | 'delivery';
  address?: string;
  contactName?: string;
  contactPhone?: string;
  comment?: string;
  referenceFileIds: { fileId: string; fileType: 'photo' | 'document' }[];
};

export type SessionState =
  | 'idle'
  | 'checkout.date'
  | 'checkout.time'
  | 'checkout.fulfillment'
  | 'checkout.address'
  | 'checkout.contact'
  | 'checkout.comment'
  | 'checkout.photos'
  | 'checkout.confirm'
  | 'payment.await_receipt'
  | 'relay.compose'
  | 'owner.edit_field'
  | 'owner.reply_to_customer';

export type SessionData = {
  cart: Cart;
  checkout?: CheckoutDraft;
  ownerDraft?: { kind: string; targetId?: string; extra?: Record<string, string> };
  paymentOrderId?: string;
  lastAutoReplyAt?: number; // unix seconds
  antispam?: { windowStart: number; count: number };
};

export type TelegramErrorCode = 'BLOCKED' | 'RATE_LIMIT' | 'NOT_FOUND' | 'NETWORK' | 'OTHER';
