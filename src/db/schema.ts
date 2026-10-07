import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

const ts = (n: string) => integer(n, { mode: 'timestamp' });

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  botTokenEnc: text('bot_token_enc').notNull(),
  botId: integer('bot_id').notNull().unique(),
  botUsername: text('bot_username').notNull(),
  ownerTelegramId: integer('owner_telegram_id'),
  claimCodeHash: text('claim_code_hash'),
  claimExpiresAt: ts('claim_expires_at'),
  shopName: text('shop_name').notNull(),
  currency: text('currency').notNull().default('₽'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  status: text('status', { enum: ['active', 'paused'] })
    .notNull()
    .default('active'),
  acceptOrders: integer('accept_orders', { mode: 'boolean' }).notNull().default(true),
  greetingText: text('greeting_text'),
  aboutText: text('about_text'),
  contactsText: text('contacts_text'),
  deliveryText: text('delivery_text'),
  paymentText: text('payment_text'),
  busyText: text('busy_text'),
  replySlaText: text('reply_sla_text').notNull().default('в течение нескольких часов'),
  prepaymentPercent: integer('prepayment_percent').notNull().default(50),
  minLeadDays: integer('min_lead_days').notNull().default(2),
  maxAdvanceDays: integer('max_advance_days').notNull().default(60),
  defaultDailyCapacity: integer('default_daily_capacity').notNull().default(5),
  paymentDeadlineHours: integer('payment_deadline_hours').notNull().default(24),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
  digestHour: integer('digest_hour').notNull().default(9),
  createdAt: ts('created_at').notNull(),
});

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    tenantIdx: index('categories_tenant_idx').on(t.tenantId),
  })
);

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    title: text('title').notNull(),
    description: text('description'),
    priceMinor: integer('price_minor').notNull(),
    unit: text('unit').notNull().default('шт'),
    minQty: integer('min_qty').notNull().default(1),
    maxQty: integer('max_qty').notNull().default(50),
    leadDays: integer('lead_days'),
    capacityUnits: integer('capacity_units').notNull().default(1),
    photoFileId: text('photo_file_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    tenantCatIdx: index('products_tenant_cat_idx').on(t.tenantId, t.categoryId),
  })
);

export const productOptions = sqliteTable(
  'product_options',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    groupTitle: text('group_title').notNull(),
    title: text('title').notNull(),
    priceDeltaMinor: integer('price_delta_minor').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    productIdx: index('options_product_idx').on(t.productId),
  })
);

export const faqItems = sqliteTable(
  'faq_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    tenantIdx: index('faq_tenant_idx').on(t.tenantId),
  })
);

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    telegramId: integer('telegram_id').notNull(),
    username: text('username'),
    firstName: text('first_name'),
    phone: text('phone'),
    source: text('source'),
    isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
    botBlocked: integer('bot_blocked', { mode: 'boolean' }).notNull().default(false),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
  },
  (t) => ({
    tenantTgUq: uniqueIndex('customers_tenant_tg_uq').on(t.tenantId, t.telegramId),
  })
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: integer('number').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    status: text('status', {
      enum: [
        'new',
        'awaiting_payment',
        'payment_review',
        'confirmed',
        'ready',
        'completed',
        'rejected',
        'cancelled',
        'expired',
      ],
    }).notNull(),
    dueDate: text('due_date').notNull(),
    proposedDate: text('proposed_date'),
    dueTimeText: text('due_time_text'),
    fulfillment: text('fulfillment', { enum: ['pickup', 'delivery'] }).notNull(),
    address: text('address'),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    comment: text('comment'),
    itemsTotalMinor: integer('items_total_minor').notNull(),
    deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    prepaymentMinor: integer('prepayment_minor').notNull(),
    capacityUnits: integer('capacity_units').notNull(),
    source: text('source'),
    idempotencyKey: text('idempotency_key').notNull(),
    paymentDueAt: ts('payment_due_at'),
    rejectReason: text('reject_reason'),
    createdAt: ts('created_at').notNull(),
    decidedAt: ts('decided_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => ({
    tenantNumberUq: uniqueIndex('orders_tenant_number_uq').on(t.tenantId, t.number),
    idemUq: uniqueIndex('orders_idem_uq').on(t.tenantId, t.idempotencyKey),
    tenantStatusIdx: index('orders_tenant_status_idx').on(t.tenantId, t.status),
    tenantDueIdx: index('orders_tenant_due_idx').on(t.tenantId, t.dueDate),
  })
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    productId: text('product_id'),
    titleSnapshot: text('title_snapshot').notNull(),
    optionsSnapshot: text('options_snapshot', { mode: 'json' })
      .$type<{ group: string; title: string; deltaMinor: number }[]>()
      .notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    qty: integer('qty').notNull(),
    capacityUnits: integer('capacity_units').notNull(),
  },
  (t) => ({
    orderIdx: index('order_items_order_idx').on(t.orderId),
  })
);

export const orderAttachments = sqliteTable(
  'order_attachments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    kind: text('kind', { enum: ['reference', 'receipt'] }).notNull(),
    fileId: text('file_id').notNull(),
    fileType: text('file_type', { enum: ['photo', 'document'] }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => ({
    orderIdx: index('attachments_order_idx').on(t.orderId),
  })
);

export const orderEvents = sqliteTable(
  'order_events',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    type: text('type').notNull(),
    actor: text('actor', { enum: ['customer', 'owner', 'system'] }).notNull(),
    payload: text('payload', { mode: 'json' }),
    createdAt: ts('created_at').notNull(),
  },
  (t) => ({
    orderIdx: index('order_events_order_idx').on(t.orderId),
  })
);

export const capacityOverrides = sqliteTable(
  'capacity_overrides',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    date: text('date').notNull(),
    capacity: integer('capacity').notNull(),
    isClosed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.date] }),
  })
);

export const sources = sqliteTable(
  'sources',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    label: text('label').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.code] }),
  })
);

export const relayMessages = sqliteTable(
  'relay_messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    ownerChatId: integer('owner_chat_id').notNull(),
    ownerMessageId: integer('owner_message_id').notNull(),
    customerChatId: integer('customer_chat_id').notNull(),
    orderId: text('order_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => ({
    ownerMsgUq: uniqueIndex('relay_owner_msg_uq').on(t.tenantId, t.ownerChatId, t.ownerMessageId),
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    tenantId: text('tenant_id').notNull(),
    telegramId: integer('telegram_id').notNull(),
    state: text('state').notNull().default('idle'),
    data: text('data', { mode: 'json' }).notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.telegramId] }),
  })
);

export const funnelEvents = sqliteTable(
  'funnel_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    customerId: text('customer_id').notNull(),
    type: text('type', {
      enum: [
        'start',
        'catalog_view',
        'product_view',
        'cart_add',
        'checkout_start',
        'order_submit',
        'faq_view',
        'free_text',
      ],
    }).notNull(),
    source: text('source'),
    at: ts('at').notNull(),
  },
  (t) => ({
    tenantAtIdx: index('funnel_tenant_at_idx').on(t.tenantId, t.at),
  })
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    tenantId: text('tenant_id'),
    payload: text('payload', { mode: 'json' }).notNull(),
    runAt: ts('run_at').notNull(),
    status: text('status', { enum: ['pending', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    dedupeKey: text('dedupe_key').notNull().unique(),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => ({
    dedupeKeyUnique: uniqueIndex('jobs_dedupe_key_unique').on(t.dedupeKey),
    dueIdx: index('jobs_due_idx').on(t.status, t.runAt),
  })
);
