# ТЗ: Telegram-бот приема заказов для кондитеров

**Версия ядра: v1.18**

Changelog:

- v1.0: первая редакция.
- v1.1: `SessionData` дополнен полем `selections?: Record<string, string[]>` (productId -> выбранные optionId по группам) для выбора опций на карточке товара.
- v1.2: добавлен callback `adm:relay:block:<customerId>` — блокировка клиента из сообщения-шапки relay.
- v1.3: `TelegramPort` дополнен `sendDocument` для передачи файлов (бэкапы, документы).
- v1.4: в roadmap добавлена стадия 7 — кастомизация per-tenant фич / feature flags.
- v1.5: добавлена задача 6.6 — функциональность удаления заказчика из tenant.
- v1.6: добавлены задачи 6.6–6.11 по UX/визуалу/производительности/навигации, удаление tenant перенесено в 6.12.
- v1.7: добавлены в контракт owner-меню заказов callback `adm:ord:list`, `adm:ord:view:<orderId>` и подтвержден `adm:ord:msg:<orderId>`.
- v1.8: разрешены QA-артефакты в `docs/qa/`: test-cases и bug table.
- v1.9: добавлен раздел 13.6 — обязательный регрессионный QA-проход и правила обновления `docs/qa/*`.
- v1.10: добавлен callback `nav:menu` для возврата в главное меню пользователя/владельца.
- v1.11: добавлена env-настройка `ADMIN_TELEGRAM_IDS`: дополнительные Telegram ID получают роль `owner` и доступ к owner-разделам.
- v1.12: `ADMIN_TELEGRAM_IDS` теперь задаётся по магазинам: `slug=id1,id2;another-slug=id3`; роль `owner` даётся только в этом tenant.
- v1.13: добавлена Стадия 8 — UX/перформанс/платежи/референсы/нумерация заказов и оптимальные пояснения.
- v1.14: перенесён пилот 6.5 в Stage 9.1, бот не готов к использованию до полного закрытия Stage 8.
- v1.15: в контракты воздействия на карточку добавлены `cart:open:<lineId>` и `prd:qty:inc/dec:<lineId>`; add в корзину теперь отвечает toast-ом и остаётся в карточке кнопка «Перейти в корзину».
- v1.16: подтверждён callback `adm:ord:datepage:<orderId>:<YYYY-MM>` для листания месяца при «Другой дате»; сообщения клиенту используют локальный номер заказа.
- v1.17: добавлены callback `my:refs:<orderId>` и `adm:ord:refs:<orderId>` для просмотра референсов заказа.
- v1.18: в контракт добавлены недостающие callback `cart:noop`, `chk:photos:done`, `adm:menu`, `adm:preview`, `adm:stats[:7|:30]`.

Правила изменения этого файла: менять только append-only. Любое изменение контракта (схема БД, типы, callback-данные, джобы, статусы заказа) поднимает версию и записывается в changelog до написания кода, который от него зависит.

---

## 0. Контекст и ограничения

- Разработчик один. Бюджет на платные сервисы: 0. Нет домена, нет платного хостинга, нет платежного эквайринга, нет платных API.
- Любое решение в этом ТЗ обязано работать бесплатно. Если для фичи нужен платный сервис, она уходит в раздел «Вне MVP».
- Код пишется в сессиях нейросети. Этот файл подгружается в каждую сессию целиком (раздел 16).

## 1. Проект

### 1.1 Что это

Telegram-бот-витрина и приемщик заказов для кондитеров из Instagram (корпусные десерты, торты, бенто, капкейки, макаруны и подобное). Один бот обслуживает один магазин. Код и БД общие для всех магазинов (multi-tenant): каждый кондитер получает своего бота со своим именем и аватаркой.

### 1.2 Боль

Один рилс залетает, в директ Instagram приходят сотни сообщений. Часть Instagram отправляет в спам. Кондитер физически не успевает: рассказать цены, скинуть каталог и фото, уточнить дату, адрес, надпись на торте, договориться об оплате. Клиенты ждут и уходят. Заказы теряются.

### 1.3 Решение

Вынести рутинную часть диалога из директа в бота. Кондитер ставит ссылку на бота в шапку профиля, в закрепленный комментарий под рилсом и в автоответ директа. Бот сам отвечает на типовые вопросы, показывает каталог, собирает заказ целиком (состав, дата, самовывоз или доставка, контакты, надпись, референсы), проверяет загрузку мастера на дату и ведет до оплаты. Мастеру приходит готовая карточка заказа с кнопками. Нетиповые вопросы бот пересылает мастеру, ответ идет клиенту через бота.

| Боль                                | Функция                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| Не успеваю отвечать всем            | Бот отвечает сам: каталог, цены, FAQ, оформление 24/7     |
| Повторяю одно и то же               | FAQ и каталог редактируются владельцем, отвечают без него |
| Тяжело собрать детали заказа        | Пошаговое оформление, карточка заказа целиком             |
| Беру больше, чем могу испечь        | Лимит заказов на дату, закрытые дни, режим «перегруз»     |
| Путаница с оплатой                  | Предоплата, реквизиты, чек в бот, подтверждение кнопкой   |
| Сообщения в спаме и теряются        | Все заказы в одном месте со статусами                     |
| Не знаю, какой рилс привел клиентов | Метки источника в ссылках, статистика по источникам       |

### 1.4 Ключевое ограничение: Instagram

Бот не читает и не отправляет сообщения Instagram. Официальный API сообщений требует app review Meta и бизнес-верификацию, это долго и не бесплатно по усилиям. Бот работает как мост: клиент переходит из Instagram в Telegram по ссылке. Часть аудитории не перейдет. Это принятый риск (раздел 18).

Что делается для конверсии перехода:

- генерация ссылок с метками источника (`t.me/<bot>?start=<code>`) и QR;
- готовые тексты для шапки профиля, закрепленного комментария, сохраненного ответа или автоответа в директе (встроенные инструменты Instagram, если доступны в аккаунте);
- короткий путь: клиент нажимает ссылку, нажимает Start, видит каталог за 2 действия.

### 1.5 Роли

| Роль                      | Кто                                                   | Как определяется                                                                       |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Клиент                    | Любой пользователь Telegram                           | Любой, кто не владелец                                                                 |
| Владелец                  | Кондитер                                              | `tenants.ownerTelegramId`, привязка через одноразовый claim-код                        |
| Суперадмин                | Разработчик                                           | `SUPERADMIN_TELEGRAM_ID` из конфига                                                    |
| Админ с правами владельца | Сотрудник разработчика/оператор в конкретном магазине | `ADMIN_TELEGRAM_IDS` в формате `slug=id1,id2;...`; в этом tenant получает role `owner` |

### 1.6 Допущения (можно менять, версия ядра поднимается)

- Язык интерфейса бота: русский. Все тексты в `src/i18n/ru.ts`.
- Валюта и часовой пояс настраиваются на магазин. Значения по умолчанию: `₽`, `Europe/Moscow`.
- Оплата вручную: перевод по реквизитам владельца, клиент присылает скриншот чека, владелец подтверждает кнопкой. Эквайринга нет.
- В MVP один владелец на магазин.
- Один бот равно один магазин. Владелец сам создает бота в @BotFather (бесплатно), токен передает разработчику.

## 2. Объем

### 2.1 MVP (входит)

- Клиент: каталог с категориями, карточка товара с фото и опциями, корзина, оформление заказа, FAQ, свободные вопросы мастеру, мои заказы, оплата по реквизитам с чеком.
- Владелец: привязка к магазину, редактор каталога, FAQ и настроек в самом боте, календарь загрузки, обработка заказов (принять, отклонить, предложить другую дату, написать клиенту, статусы), режим «перегруз», ссылки и QR для Instagram, статистика, ежедневная сводка.
- Платформа: multi-tenant, планировщик напоминаний, бэкап БД, демо-магазин, логи, команды суперадмина.

### 2.2 Вне MVP

- Self-service онбординг через мастер-бота (MVP: магазины заводит разработчик скриптом).
- Telegram Mini App (нужен HTTPS-хостинг фронта).
- Webhook-режим (нужен домен или постоянный HTTPS).
- Платежные API, автоподтверждение оплаты.
- Несколько администраторов на магазин.
- Рассылки клиентам. Только по opt-in, после MVP.
- Биллинг подписки (в пилоте вручную).
- Интеграция с Instagram API.
- Доставка через службы, расчет стоимости доставки по расстоянию (в MVP фиксированная плата).

## 3. Стек (все бесплатное)

| Слой                     | Выбор                                 | Примечание                                                                             |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Рантайм                  | Node.js LTS (>=22), TypeScript strict |                                                                                        |
| Telegram                 | grammY                                | плагины: `@grammyjs/runner`, `@grammyjs/auto-retry`, `@grammyjs/transformer-throttler` |
| Режим получения апдейтов | Long polling                          | Домен и входящие порты не нужны. Несколько ботов в одном процессе через runner         |
| БД                       | SQLite (`better-sqlite3`), режим WAL  | Один файл, бэкап копированием                                                          |
| ORM и миграции           | Drizzle ORM + drizzle-kit             | Миграции генерируются из схемы                                                         |
| Валидация                | zod                                   | payload джобов, callback-данные, сессии, конфиг                                        |
| Планировщик              | Собственный, таблица `jobs`           | Опрос раз в 30 секунд, in-process                                                      |
| Файлы                    | Только Telegram `file_id`             | Диска и S3 не нужно. `file_id` валиден для бота, который его получил                   |
| QR                       | `qrcode` (npm)                        | Локально, PNG в памяти                                                                 |
| Логи                     | `pino` в stdout                       |                                                                                        |
| Тесты                    | vitest, fast-check                    | Раздел 13                                                                              |
| Линт                     | eslint, prettier, `tsc --noEmit`      |                                                                                        |
| CI                       | GitHub Actions                        | Бесплатно для публичного репо, лимиты минут для приватного                             |
| Запуск                   | pm2 или systemd                       | Docker опционально                                                                     |

### 3.1 Хостинг без денег

- Разработка: локальная машина, long polling.
- Пилот: любая всегда включенная машина (домашний мини-ПК, старый ноутбук, Raspberry Pi) или бесплатная VM, если получится ее завести. Условия бесплатных тарифов меняются, проверять на момент выбора.
- Long polling не требует белого IP, домена и проброса портов.
- Если процесс упал: Telegram хранит необработанные апдейты до 24 часов, после рестарта бот их получит. Процесс-менеджер обязан перезапускать бота автоматически.
- Бэкап: ежедневно `db.backup()` и отправка файла в приватный чат суперадмина через бота (раздел 12).

### 3.2 Принятые решения

| Решение                                | Причина                       | Цена решения                                                                                |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| Polling вместо webhook                 | Нет домена                    | Нужен всегда работающий процесс                                                             |
| SQLite вместо Postgres                 | 0 затрат, 0 администрирования | Один процесс пишет в БД, горизонтально не масштабируется. Для десятков магазинов достаточно |
| Собственный планировщик вместо pg-boss | pg-boss требует Postgres      | Простая таблица, идемпотентные хендлеры                                                     |
| `file_id` вместо хранения файлов       | Бесплатно и просто            | Фото привязаны к боту магазина. Загружать фото нужно через бота этого магазина              |
| Ручная оплата                          | Нет эквайринга                | Владелец вручную сверяет чек                                                                |

## 4. Архитектура и структура папок

```
src/
  main.ts                    # config, миграции, запуск ботов и планировщика
  config.ts                  # zod-схема env, единая точка доступа
  types.ts                   # общие типы (раздел 7)
  bot/
    factory.ts               # createTenantBot(tenant): Bot
    runner.ts                # запуск и остановка ботов всех магазинов
    context.ts               # BotContext: tenant, role, session
    callbacks.ts             # кодек callback-данных (раздел 8.1)
    middleware/              # tenant, role, session, errors, antispam, funnel
    customer/                # start, catalog, cart, checkout, payment, faq, myorders, freetext
    owner/                   # menu, orders, catalog-editor, faq-editor, calendar, settings, links, stats
    relay/                   # пересылка клиент <-> владелец
  domain/                    # ЧИСТАЯ логика, без БД и Telegram
    pricing.ts
    capacity.ts
    dates.ts
    order-machine.ts
    escape.ts
  services/                  # работа с БД, транзакции
    tenants.ts catalog.ts orders.ts customers.ts relay.ts stats.ts scheduler.ts
  telegram/
    port.ts                  # интерфейс TelegramPort
    grammy-port.ts           # реальная реализация
    fake-port.ts             # фейк для тестов, с инъекцией ошибок
  jobs/                      # хендлеры джобов
  db/
    schema.ts client.ts migrations/ seed.ts
  i18n/ru.ts
  lib/                       # logger, ids, money, time, crypto
tests/
  domain/ services/ jobs/ flows/ contracts/
scripts/
  tenant-create.ts           # заводит магазин, печатает claim-ссылку
  backup.ts
  load-sim.ts                # симуляция наплыва (раздел 13.5)
docs/
  owner-setup.md             # инструкция для владельца: создать бота, куда вставить ссылки
```

Правила слоев:

- `domain/` чистые функции. Не импортируют БД, grammY, `Date.now()` напрямую (время приходит параметром).
- `services/` знают про БД, не знают про Telegram.
- `bot/` знает про Telegram и вызывает `services/` и `domain/`. Отправка сообщений только через `TelegramPort`.
- Запись в БД, затрагивающая несколько таблиц, идет в одной синхронной транзакции `better-sqlite3`.

## 5. Схема БД (Drizzle, SQLite)

Время: `integer({ mode: 'timestamp' })`. Даты заказа: `text` формата `YYYY-MM-DD` в часовом поясе магазина. Деньги: целые числа в минорных единицах (`*Minor`).

```ts
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
  id: text('id').primaryKey(), // nanoid
  slug: text('slug').notNull().unique(),
  botTokenEnc: text('bot_token_enc').notNull(), // AES-256-GCM, ключ из APP_SECRET
  botId: integer('bot_id').notNull().unique(),
  botUsername: text('bot_username').notNull(),
  ownerTelegramId: integer('owner_telegram_id'), // null до привязки
  claimCodeHash: text('claim_code_hash'),
  claimExpiresAt: ts('claim_expires_at'),
  shopName: text('shop_name').notNull(),
  currency: text('currency').notNull().default('₽'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  status: text('status', { enum: ['active', 'paused'] })
    .notNull()
    .default('active'),
  acceptOrders: integer('accept_orders', { mode: 'boolean' }).notNull().default(true), // false = режим «перегруз»
  greetingText: text('greeting_text'),
  aboutText: text('about_text'),
  contactsText: text('contacts_text'),
  deliveryText: text('delivery_text'),
  paymentText: text('payment_text'), // реквизиты
  busyText: text('busy_text'), // текст в режиме «перегруз»
  replySlaText: text('reply_sla_text').notNull().default('в течение нескольких часов'),
  prepaymentPercent: integer('prepayment_percent').notNull().default(50), // 0..100
  minLeadDays: integer('min_lead_days').notNull().default(2),
  maxAdvanceDays: integer('max_advance_days').notNull().default(60),
  defaultDailyCapacity: integer('default_daily_capacity').notNull().default(5),
  paymentDeadlineHours: integer('payment_deadline_hours').notNull().default(24),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
  digestHour: integer('digest_hour').notNull().default(9), // час ежедневной сводки, локальное время
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
  (t) => [index('categories_tenant_idx').on(t.tenantId)]
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
    unit: text('unit').notNull().default('шт'), // шт, кг, набор
    minQty: integer('min_qty').notNull().default(1),
    maxQty: integer('max_qty').notNull().default(50),
    leadDays: integer('lead_days'), // переопределяет tenant.minLeadDays, если больше
    capacityUnits: integer('capacity_units').notNull().default(1), // сколько «слотов» занимает 1 единица
    photoFileId: text('photo_file_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('products_tenant_cat_idx').on(t.tenantId, t.categoryId)]
);

// Каждая непустая группа опций = выбор ровно одной опции (начинка, размер).
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
  (t) => [index('options_product_idx').on(t.productId)]
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
  (t) => [index('faq_tenant_idx').on(t.tenantId)]
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
    source: text('source'), // first-touch start-параметр
    isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false), // владелец заблокировал
    botBlocked: integer('bot_blocked', { mode: 'boolean' }).notNull().default(false), // клиент заблокировал бота
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('customers_tenant_tg_uq').on(t.tenantId, t.telegramId)]
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: integer('number').notNull(), // последовательный в пределах магазина
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
    dueDate: text('due_date').notNull(), // YYYY-MM-DD
    proposedDate: text('proposed_date'), // встречное предложение владельца
    dueTimeText: text('due_time_text'), // «к 15:00», свободный текст
    fulfillment: text('fulfillment', { enum: ['pickup', 'delivery'] }).notNull(),
    address: text('address'),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    comment: text('comment'), // надпись, пожелания
    itemsTotalMinor: integer('items_total_minor').notNull(),
    deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    prepaymentMinor: integer('prepayment_minor').notNull(),
    capacityUnits: integer('capacity_units').notNull(),
    source: text('source'),
    idempotencyKey: text('idempotency_key').notNull(), // checkoutId из сессии
    paymentDueAt: ts('payment_due_at'),
    rejectReason: text('reject_reason'),
    createdAt: ts('created_at').notNull(),
    decidedAt: ts('decided_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('orders_tenant_number_uq').on(t.tenantId, t.number),
    uniqueIndex('orders_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('orders_tenant_status_idx').on(t.tenantId, t.status),
    index('orders_tenant_due_idx').on(t.tenantId, t.dueDate),
  ]
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    productId: text('product_id'), // без FK: товар можно удалить
    titleSnapshot: text('title_snapshot').notNull(),
    optionsSnapshot: text('options_snapshot', { mode: 'json' })
      .$type<{ group: string; title: string; deltaMinor: number }[]>()
      .notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(), // цена + дельты опций
    qty: integer('qty').notNull(),
    capacityUnits: integer('capacity_units').notNull(), // capacityUnits товара * qty
  },
  (t) => [index('order_items_order_idx').on(t.orderId)]
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
  (t) => [index('attachments_order_idx').on(t.orderId)]
);

export const orderEvents = sqliteTable(
  'order_events',
  {
    // аудит
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    type: text('type').notNull(), // OrderEvent или системное
    actor: text('actor', { enum: ['customer', 'owner', 'system'] }).notNull(),
    payload: text('payload', { mode: 'json' }),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)]
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
  (t) => [primaryKey({ columns: [t.tenantId, t.date] })]
);

export const sources = sqliteTable(
  'sources',
  {
    // метки ссылок для Instagram
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(), // [a-z0-9_-], до 32 символов, префикс claim_ зарезервирован
    label: text('label').notNull(), // «Рилс с тортом-бенто»
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.code] })]
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
    ownerMessageId: integer('owner_message_id').notNull(), // сообщение в чате владельца
    customerChatId: integer('customer_chat_id').notNull(),
    orderId: text('order_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('relay_owner_msg_uq').on(t.tenantId, t.ownerChatId, t.ownerMessageId)]
);

export const sessions = sqliteTable(
  'sessions',
  {
    tenantId: text('tenant_id').notNull(),
    telegramId: integer('telegram_id').notNull(),
    state: text('state').notNull().default('idle'), // SessionState
    data: text('data', { mode: 'json' }).notNull(), // SessionData, валидируется zod при чтении
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.telegramId] })]
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
  (t) => [index('funnel_tenant_at_idx').on(t.tenantId, t.at)]
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
  (t) => [index('jobs_due_idx').on(t.status, t.runAt)]
);
```

Примечания:

- Токены ботов в БД только в зашифрованном виде. Шифрование в `lib/crypto.ts`.
- Номер заказа выдается внутри транзакции создания: `max(number) + 1` по магазину.
- Фото и файлы в `order_attachments`, `products.photoFileId` ссылаются на `file_id` конкретного бота.

## 6. Статусы заказа

```
new ──owner_accept──► awaiting_payment (если prepaymentMinor > 0)
 │                └──► confirmed        (если prepaymentMinor = 0)
 ├─owner_reject──► rejected
 └─customer_cancel──► cancelled

awaiting_payment ──receipt_uploaded──► payment_review
 ├─customer_cancel / owner_cancel──► cancelled
 └─payment_timeout──► expired

payment_review ──payment_confirmed──► confirmed
 ├─payment_rejected──► awaiting_payment
 └─owner_cancel──► cancelled

confirmed ──mark_ready──► ready
 └─owner_cancel──► cancelled        (клиент отменяет через «Написать мастеру»)

ready ──mark_completed──► completed
 └─owner_cancel──► cancelled
```

- Терминальные статусы: `rejected`, `cancelled`, `expired`, `completed`. Из них переходов нет.
- Занимают загрузку даты: `new`, `awaiting_payment`, `payment_review`, `confirmed`, `ready`, `completed`. Освобождают: `rejected`, `cancelled`, `expired`.
- «Предложить другую дату»: заказ остается в `new`, заполняется `proposedDate`. Клиент принимает: проверка загрузки на новую дату, `dueDate = proposedDate`, затем автоматически `owner_accept`. Клиент отклоняет: `proposedDate = null`, владельцу уведомление.
- Реализация: единственная функция `transition(order, event): Result` в `domain/order-machine.ts`. Любое изменение статуса в коде идет только через нее.

## 7. Общие типы (`src/types.ts`)

```ts
export type Minor = number; // целое, минорные единицы валюты
export type IsoDate = string; // YYYY-MM-DD в часовом поясе магазина
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

export type CartLine = { lineId: string; productId: string; qty: number; optionIds: string[] };
export type Cart = { lines: CartLine[] };

export type CheckoutDraft = {
  checkoutId: string; // nanoid, он же idempotencyKey заказа
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
  | 'relay.compose' // клиент пишет мастеру
  | 'owner.edit_field' // владелец вводит текст поля, контекст в ownerDraft
  | 'owner.reply_to_customer';

export type SessionData = {
  cart: Cart;
  checkout?: CheckoutDraft;
  ownerDraft?: { kind: string; targetId?: string; extra?: Record<string, string> };
  paymentOrderId?: string;
  lastAutoReplyAt?: number; // unix seconds
  antispam?: { windowStart: number; count: number };
  selections?: Record<string, string[]>; // productId -> выбранные optionIds (по одной опции на группу)
};

export type TelegramErrorCode = 'BLOCKED' | 'RATE_LIMIT' | 'NOT_FOUND' | 'NETWORK' | 'OTHER';
```

### 7.1 Интерфейс `TelegramPort`

Вся отправка сообщений идет через него. Реальная реализация на grammY, фейк для тестов.

```ts
export interface TelegramPort {
  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<{ messageId: number }>;
  sendPhoto(
    chatId: number,
    photo: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<{ messageId: number }>;
  editMessageText(chatId: number, messageId: number, text: string, opts?: SendOpts): Promise<void>;
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
  copyMessage(
    toChatId: number,
    fromChatId: number,
    messageId: number
  ): Promise<{ messageId: number }>;
  sendDocument(
    chatId: number,
    document: string | Buffer,
    caption?: string,
    opts?: SendOpts
  ): Promise<{ messageId: number }>;
}
// SendOpts: { keyboard?: InlineKeyboard; parseMode: 'HTML' }. Ошибки: TelegramError { code: TelegramErrorCode }
```

Фейк умеет: записывать все вызовы, возвращать заданную ошибку на N-й вызов, эмулировать `RATE_LIMIT` и `BLOCKED`.

## 8. Контракты

### 8.1 Callback-данные

Формат: `<ns>:<action>[:<arg>...]`. Разделитель `:`, в аргументах двоеточий нет. Длина не более 64 байт UTF-8. Кодек и разбор (zod discriminated union) в `bot/callbacks.ts`. Идентификаторы в callback: nanoid длиной 10.

| Callback                                                                                                    | Смысл                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `cat:list`                                                                                                  | список категорий                                                                                  |
| `cat:open:<categoryId>`                                                                                     | товары категории                                                                                  |
| `prd:open:<productId>`                                                                                      | карточка товара                                                                                   |
| `prd:opt:<productId>:<optionId>`                                                                            | выбор опции                                                                                       |
| `prd:qty:inc:<lineId>` / `prd:qty:dec:<lineId>`                                                             | изменить количество строки корзины прямо из карточки товара                                       |
| `prd:add:<productId>`                                                                                       | в корзину                                                                                         |
| `cart:show` / `cart:inc:<lineId>` / `cart:dec:<lineId>` / `cart:clear` / `cart:open:<lineId>` / `cart:noop` | корзина; `cart:open` открывает карточку строки с опциями/количеством; `cart:noop` инертная кнопка |
| `chk:start`                                                                                                 | начать оформление                                                                                 |
| `chk:date:<YYYY-MM-DD>` / `chk:datepage:<YYYY-MM>`                                                          | выбор даты, листание месяца                                                                       |
| `chk:ful:<pickup\|delivery>`                                                                                | способ получения                                                                                  |
| `chk:skip` / `chk:back` / `chk:cancel`                                                                      | пропуск шага, назад, отмена                                                                       |
| `chk:photos:done`                                                                                           | подтвердить прикреплённые фото                                                                    |
| `chk:submit:<checkoutId>`                                                                                   | отправить заказ (идемпотентно)                                                                    |
| `my:list` / `my:view:<orderId>`                                                                             | мои заказы                                                                                        |
| `nav:menu`                                                                                                  | главное меню текущей роли                                                                         |
| `my:cancel:<orderId>`                                                                                       | отмена клиентом (только `new`, `awaiting_payment`)                                                |
| `my:refs:<orderId>`                                                                                         | показать референсы своего заказа                                                                  |
| `pay:sent:<orderId>`                                                                                        | «я оплатил», ждем чек                                                                             |
| `faq:list` / `faq:view:<faqId>`                                                                             | FAQ                                                                                               |
| `rel:start`                                                                                                 | «Написать мастеру»                                                                                |
| `adm:ord:accept:<orderId>`                                                                                  | принять                                                                                           |
| `adm:ord:list`                                                                                              | список последних заказов владельца                                                                |
| `adm:ord:view:<orderId>`                                                                                    | карточка заказа в режиме владельца                                                                |
| `adm:ord:msg:<orderId>`                                                                                     | написать клиенту                                                                                  |
| `adm:ord:refs:<orderId>`                                                                                    | показать референсы заказа владельцу                                                               |
| `adm:ord:reject:<orderId>` / `adm:ord:rr:<orderId>:<reasonCode>`                                            | отклонить, код причины                                                                            |
| `adm:ord:date:<orderId>` / `adm:ord:pd:<orderId>:<YYYY-MM-DD>` / `adm:ord:datepage:<orderId>:<YYYY-MM>`     | предложить дату; сетка; листание месяца                                                           |
| `adm:ord:paid:<orderId>` / `adm:ord:badpay:<orderId>`                                                       | оплата верна, оплата неверна                                                                      |
| `adm:ord:ready:<orderId>` / `adm:ord:done:<orderId>` / `adm:ord:cancel:<orderId>`                           | статусы                                                                                           |
| `pd:yes:<orderId>` / `pd:no:<orderId>`                                                                      | клиент принимает или отклоняет предложенную дату                                                  |
| `adm:cat:*`, `adm:prd:*`, `adm:faq:*`, `adm:set:*`, `adm:cal:*`, `adm:src:*`                                | редакторы владельца                                                                               |
| `adm:menu` / `adm:preview`                                                                                  | меню владельца / предпросмотр клиентского меню                                                    |
| `adm:stats` / `adm:stats:7` / `adm:stats:30`                                                                | статистика за период по умолчанию, 7 или 30 дней                                                  |
| `adm:relay:block:<customerId>`                                                                              | блокировка клиента из relay-шапки                                                                 |

Новые callback добавляются только с правкой этого раздела и поднятием версии.

### 8.2 Джобы планировщика

Все джобы идемпотентны: хендлер сначала читает актуальное состояние и выходит, если действие уже не нужно. Ретраи: до 3 попыток, задержки 60 с, 300 с, 1800 с. После третьей неудачи статус `failed` и сообщение суперадмину.

| type                       | payload              | runAt                                | dedupeKey                  | Действие                                                                                  |
| -------------------------- | -------------------- | ------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| `order.payment_reminder`   | `{ orderId }`        | `paymentDueAt - 50% окна`            | `payrem:<orderId>`         | Если статус `awaiting_payment`, напомнить клиенту                                         |
| `order.expire`             | `{ orderId }`        | `paymentDueAt`                       | `expire:<orderId>`         | Если статус `awaiting_payment`, `payment_timeout`, освободить дату, уведомить обе стороны |
| `customer.pickup_reminder` | `{ orderId }`        | за день до `dueDate`, 10:00 локально | `pickup:<orderId>`         | Если статус `confirmed` или `ready`, напомнить клиенту детали получения                   |
| `owner.daily_digest`       | `{ tenantId, date }` | `digestHour` локально                | `digest:<tenantId>:<date>` | Сводка: заказы на сегодня и завтра, заказы без решения                                    |
| `backup.db`                | `{}`                 | 03:00 UTC ежедневно                  | `backup:<YYYY-MM-DD>`      | Бэкап и отправка суперадмину                                                              |

Правило создания: джобы заказа создаются в той же транзакции, что и смена статуса. Отмена джоба не нужна, хендлер проверяет статус.

### 8.3 Сервисные функции (сигнатуры)

```ts
createOrder(input: { tenantId; customerId; cart: Cart; checkout: Required<Pick<CheckoutDraft,'checkoutId'|'dueDate'|'fulfillment'|'contactName'|'contactPhone'>> & CheckoutDraft; now: Date })
  : Result<Order, 'EMPTY_CART' | 'PRODUCT_INACTIVE' | 'DATE_UNAVAILABLE' | 'CAPACITY_EXCEEDED' | 'TENANT_BUSY' | 'BAD_QTY'>
  // повторный вызов с тем же checkoutId возвращает уже созданный заказ
applyOrderEvent(orderId: string, event: OrderEvent, actor: 'customer'|'owner'|'system', now: Date)
  : Result<Order, 'NOT_FOUND' | 'ILLEGAL_TRANSITION'>
getDateAvailability(tenantId: string, from: IsoDate, to: IsoDate, cart: Cart, now: Date)
  : Record<IsoDate, { available: boolean; reason?: 'CLOSED' | 'FULL' | 'TOO_SOON' | 'TOO_FAR' }>
```

Доменные функции (`domain/`):

```ts
priceLine(unitMinor: Minor, optionDeltas: Minor[], qty: number): Minor
priceOrder(lines: Minor[], deliveryFee: Minor, prepaymentPercent: number): { items: Minor; total: Minor; prepayment: Minor }
  // prepayment = ceil(total * percent / 100)
requiredLeadDays(cartProductLeadDays: (number|null)[], tenantMinLead: number): number  // максимум
```

### 8.4 Пересылка клиент <-> владелец

- Любое сообщение клиента вне сценария оформления (текст, фото, голос, документ) идет в чат владельца: заголовок («Имя, @username, заказ №N если есть») и `copyMessage` исходного сообщения. Обе записи сохраняются в `relay_messages`.
- Владелец отвечает Telegram-ответом (reply) на заголовок или копию. Бот находит запись по `(tenantId, ownerChatId, ownerMessageId)` и копирует ответ клиенту.
- Кнопка `adm:ord:msg:<orderId>` включает состояние `owner.reply_to_customer` на одно сообщение.
- Клиенту после первого сообщения вне сценария отправляется автоответ: «Передал мастеру, ответ придет сюда, обычно {replySlaText}» и кнопки «Каталог», «Мои заказы». Автоответ не чаще раза в 6 часов на клиента (`lastAutoReplyAt`).
- `BLOCKED` от Telegram при отправке клиенту: `customers.botBlocked = true`, владельцу уведомление один раз.

### 8.5 Метки источника

- Ссылка: `https://t.me/<botUsername>?start=<code>`. Код: `[a-z0-9_-]{1,32}`. Префикс `claim_` зарезервирован под привязку владельца.
- Первый `/start` с кодом записывает `customers.source`, если оно пустое. Источник заказа берется из `customers.source`.
- Генератор ссылок у владельца: создает запись в `sources`, выдает ссылку, QR (PNG) и готовые тексты.
- Шаблоны текстов (в `i18n/ru.ts`): шапка профиля, закрепленный комментарий, автоответ директа. Подставляются `shopName` и ссылка. Пример автоответа: «Привет! Каталог, цены и оформление заказа у нас в боте: {link}. Так мы отвечаем быстрее и не теряем ваш заказ».

## 9. Сценарии клиента

Общие правила UX:

- Один экран равно одно сообщение. Навигация редактирует сообщение (`editMessageText`), новое не отправляется.
- Кнопка «Назад» на каждом экране. `/start` и `/menu` всегда возвращают в главное меню и сбрасывают состояние в `idle` (корзина сохраняется).
- Весь пользовательский ввод экранируется перед подстановкой в HTML-сообщения (`domain/escape.ts`).
- `answerCallbackQuery` вызывается первым действием в каждом обработчике callback.
- Неожиданный ввод не ломает бота: в сценарии оформления подсказка по текущему шагу, вне сценария пересылка мастеру.
- Если `acceptOrders = false`: каталог и FAQ доступны, оформление заменено текстом `busyText` и кнопкой «Написать мастеру».

### 9.1 Старт

Приветствие (`greetingText` или дефолт с `shopName`), кнопки: «Каталог», «Корзина», «Мои заказы», «Вопросы и ответы», «Написать мастеру». Сохраняется `source`. Событие воронки `start`.

### 9.2 Каталог

Категории, затем товары категории, затем карточка: фото, название, описание, цена («от X» если есть опции с доплатой), выбор опций (по группам), количество, «В корзину». Неактивные товары и категории не показываются. Событие `catalog_view`, `product_view`, `cart_add`.

### 9.3 Корзина

Список строк с ценой, `+` и `−`, удаление, итог. «Оформить заказ» запускает `checkout`.

### 9.4 Оформление

Шаги (состояния `checkout.*`), на каждом «Назад»:

1. **Дата.** Календарь ближайших `maxAdvanceDays`. Недоступные даты (`TOO_SOON`, `CLOSED`, `FULL`, `TOO_FAR`) помечены и не выбираются. Минимальный срок равен `requiredLeadDays(...)`.
2. **Время.** Свободный текст, можно пропустить.
3. **Получение.** Самовывоз или доставка. Доставка: плата `deliveryFeeMinor` добавляется к итогу, `deliveryText` показывается.
4. **Адрес.** Только для доставки.
5. **Контакт.** Имя и телефон: кнопка «Отправить контакт» Telegram или ввод текстом. Предзаполнение из прошлого заказа.
6. **Комментарий.** Надпись, пожелания. Можно пропустить.
7. **Референсы.** Фото и файлы (до 5), можно пропустить.
8. **Подтверждение.** Сводка: состав, дата, получение, итог, предоплата, текст согласия на обработку данных для выполнения заказа. Кнопка `chk:submit:<checkoutId>`.

Отправка: `createOrder` в транзакции с повторной проверкой загрузки. Двойное нажатие дает один заказ (идемпотентность по `checkoutId`). `CAPACITY_EXCEEDED` или `DATE_UNAVAILABLE`: клиента возвращают к выбору даты с пояснением и сохраненным остальным. После успеха: корзина и черновик очищаются, клиенту «Заказ №N отправлен, мастер ответит {replySlaText}», владельцу карточка заказа (9.5).

### 9.5 Оплата

После `owner_accept` с предоплатой клиент получает: сумму предоплаты, `paymentText` (реквизиты), срок (`paymentDeadlineHours`), кнопку «Я оплатил». Нажатие включает `payment.await_receipt`, клиент присылает фото или файл чека, состояние `receipt_uploaded`, владельцу уходит чек с кнопками «Оплата верна» и «Оплата не пришла». Джобы `order.payment_reminder` и `order.expire` создаются при переходе в `awaiting_payment`.

### 9.6 Мои заказы

Список заказов клиента со статусами, карточка заказа, отмена в `new` и `awaiting_payment`. Клиент видит только свои заказы (проверка по `customerId` в каждом обработчике).

### 9.7 FAQ

Кнопки-вопросы из `faq_items`, ответ текстом. Стартовый набор при создании магазина: цены, сроки, доставка, оплата и предоплата, как заказать, адрес.

## 10. Сценарии владельца

### 10.1 Привязка

`scripts/tenant-create.ts` создает магазин и печатает ссылку `t.me/<bot>?start=claim_<code>`. Код одноразовый, хранится хешем, срок 24 часа. Первый пользователь, открывший ссылку, становится владельцем (`ownerTelegramId`). Повторное использование кода невозможно.

### 10.2 Меню владельца

`/menu` для владельца показывает меню владельца. Разделы: «Заказы», «Каталог», «Календарь», «Настройки», «Ссылки для Instagram», «Статистика», «Как видит клиент» (предпросмотр главного меню клиента).

### 10.3 Заказы

Новый заказ приходит карточкой: номер, клиент (имя, ссылка на профиль), состав с опциями, дата и время, получение и адрес, контакт, комментарий, референсы (фото), сумма и предоплата, источник, текущая загрузка даты («на 12.10 занято 3 из 5»). Кнопки: «Принять», «Отклонить» (выбор причины из списка или свой текст), «Другая дата», «Написать клиенту». Списки: новые, в работе (`awaiting_payment`, `payment_review`, `confirmed`), готовые, на сегодня и завтра. Кнопки статусов соответствуют событиям раздела 6. Каждая смена статуса уведомляет клиента шаблонным сообщением.

### 10.4 Каталог

Создание, редактирование, скрытие, удаление категорий, товаров, опций. Поля товара вводятся по одному. Фото: владелец присылает фото боту, сохраняется `file_id`. Порядок: кнопки «Выше» и «Ниже». Удаление товара не ломает старые заказы (снимок в `order_items`).

### 10.5 FAQ и настройки

Редактирование всех текстов и числовых параметров из `tenants` (раздел 5). Каждый параметр редактируется в одном шаге с валидацией (проценты 0..100, дни не отрицательные). Режим «перегруз»: переключатель `acceptOrders` и текст `busyText`.

### 10.6 Календарь

Месяц с загрузкой по дням. Действия по дате: закрыть день, изменить лимит, открыть день. Лимит по умолчанию `defaultDailyCapacity`.

### 10.7 Ссылки для Instagram

Список меток, создание новой (название, код автоматически), выдача ссылки, QR и готовых текстов. Справка по установке в шапку, закрепленный комментарий, автоответ.

### 10.8 Статистика

Периоды 7 и 30 дней. Показатели: новые клиенты (по источникам), шаги воронки (старт, каталог, корзина, оформление, заказ), заказы по статусам, выручка по подтвержденным заказам, среднее время до решения владельца, число обращений, обработанных ботом без участия владельца (события `catalog_view`, `faq_view` без последующего `free_text`).

### 10.9 Ежедневная сводка

Джоб `owner.daily_digest`: сколько заказов на сегодня и завтра, сколько заказов ждут решения, сколько ждут оплаты.

## 11. Команды суперадмина

Доступны только для `SUPERADMIN_TELEGRAM_ID` в любом боте и в отдельном чате с любым из ботов:

- `/status`: аптайм, число запущенных ботов, размер очереди джобов, число `failed` джобов, размер БД.
- `/tenants`: список магазинов со статусом.
- `/pause <slug>` и `/resume <slug>`.
- Уведомления об ошибках: необработанное исключение, `failed` джоб, отказ запуска бота (например, отозванный токен).

## 12. Нефункциональные требования

**Производительность.** Ответ на callback до 1 секунды. Целевая нагрузка для одного магазина: 300 новых клиентов за час, 50 одновременных оформлений. Целевая плотность: 20 магазинов в одном процессе на 1 vCPU и 512 МБ памяти.

**Лимиты Telegram.** Исходящие сообщения идут через throttler и auto-retry. При `RATE_LIMIT` ожидание и повтор. Сообщения владельцу приоритетнее сообщений клиентам при очереди (отдельная очередь владельца).

**Надежность.**

- Состояние хранится в БД (`sessions`), рестарт процесса не теряет прогресс клиента.
- Доставка апдейтов at-least-once: все обработчики повторно безопасны (идемпотентность `createOrder`, `applyOrderEvent` отклоняет повторные события как `ILLEGAL_TRANSITION` без побочных эффектов).
- Падение одного бота (например, отозванный токен) не останавливает остальные.
- Graceful shutdown: остановка runner, завершение текущих обработчиков, закрытие БД.

**Безопасность.**

- Токены ботов шифруются (AES-256-GCM), ключ в `APP_SECRET`, файл `.env` вне репозитория.
- Каждый обработчик проверяет роль и принадлежность объекта: заказ, товар, категория должны принадлежать `ctx.tenant`. Действия `adm:*` выполняются только если `ctx.from.id === tenant.ownerTelegramId` или пользователь есть в `ADMIN_TELEGRAM_IDS` для этого slug.
- Claim-коды одноразовые, хранятся хешем, живут 24 часа.
- Антиспам: не более 20 сообщений и callback в минуту на клиента, затем молчаливое игнорирование на 5 минут. Владелец может заблокировать клиента (`isBlocked`).
- Ограничения на ввод: длины текстовых полей, размер и число вложений, валидация телефона.
- В логах нет телефонов, адресов, текстов клиентов.

**Персональные данные.** Хранится минимум: Telegram id, имя, username, телефон и адрес из заказа. Согласие показывается на шаге подтверждения. Команда `/deleteme` у клиента: обезличивание записи клиента и его заказов (имя, телефон, адрес, комментарий заменяются заглушкой, агрегаты сохраняются).

**Бэкап и восстановление.** `better-sqlite3` `db.backup()` ежедневно, файл отправляется в приватный чат суперадмина. Хранится в Telegram как история. Процедура восстановления в `docs/restore.md`: остановить процесс, заменить файл БД, запустить. Раз в месяц проверка восстановления на копии.

**Стоимость.** 0. Проверка: в `package.json` нет платных SDK, в конфиге нет платных API.

## 13. Стратегия тестов

Тесты привязаны к задаче и PR. Задача закрыта только с тестами.

**Главное правило.** Тесты выводятся из критериев приемки задачи, не из реализации. Тест кодирует контракт. Запрещено писать тесты, подтверждающие то, что код делает сейчас. Порядок: критерии приемки, затем тесты (красные), затем код.

Обязательные типы:

1. **Юнит на чистой логике (`domain/`).** Цена, загрузка, даты, машина статусов, экранирование.
2. **Property-based (fast-check) на `domain/`.** Инварианты:
   - `priceOrder`: итог равен сумме строк плюс доставка, все значения целые и неотрицательные, `0 <= prepayment <= total`;
   - `order-machine`: из терминального статуса нет переходов, любая последовательность событий оставляет статус в допустимом множестве;
   - `capacity`: сумма занятых единиц на дату после любой последовательности создания, отмены и истечения не превышает лимит даты (для заказов, созданных клиентами);
   - `getDateAvailability`: дата раньше `now + requiredLeadDays`, закрытая дата и полная дата никогда не `available`;
   - кодек callback: `decode(encode(x)) = x`, длина не более 64 байт;
   - `escape`: на выходе нет неэкранированных `<`, `>`, `&` из входа.
3. **Идемпотентность.** На каждый хендлер джоба тест: запуск дважды с тем же payload дает ровно один эффект (одно сообщение, один переход статуса). Отдельно: `chk:submit` два раза подряд создает один заказ. Отдельно: параллельное создание заказов на последний свободный слот дает один успех.
4. **Контрактные тесты на стыках.** Payload каждого джоба валидируется zod-схемой из раздела 8.2. Каждое сообщение в `TelegramPort` проверяется фейком: текст не пустой, не длиннее 4096 символов, подпись не длиннее 1024, callback-данные не длиннее 64 байт.
5. **Путь ошибки через фейк.** `RATE_LIMIT`: повтор. `BLOCKED` при отправке клиенту: `botBlocked = true`, владелец уведомлен один раз. `NETWORK`: ретрай джоба по расписанию. Необработанная ошибка в обработчике: клиент получает нейтральное сообщение, суперадмин уведомление, бот продолжает работать.
6. **Сценарные (flow) тесты.** Фейковые апдейты подаются напрямую в `bot.handleUpdate`, исходящие вызовы перехватывает фейковый `TelegramPort`. Сети нет. Обязательные сценарии: путь клиента от `/start` до заказа, принятие с предоплатой и без, отклонение, встречная дата, истечение оплаты, вопрос вне сценария и ответ владельца, привязка владельца и повторное использование claim-кода, доступ клиента к чужому заказу (запрещен), доступ не-владельца к `adm:*` (запрещен).

### 13.5 Симуляция наплыва

`scripts/load-sim.ts`: эмуляция 300 клиентов, проходящих каталог и оформление на одном магазине, с фейковым портом. Проверяется: нет потерянных и задвоенных заказов, загрузка дат не превышена, p95 времени обработки апдейта меньше 200 мс.

### 13.6 Регрессионный QA-проход

После любой значимой или функционально заметной правки, а также после любого UX/баг-фикса:

1. Расширить `docs/qa/test-cases.md` новыми сценариями для изменённого поведения.
2. Найденные баги записывать в `docs/qa/bugs.xlsx` до исправления. Колонки: `ID`, `Summary`, `Description`, `Priority`, `Severity`, `Attachments`.
3. Исправить баги и добавить/обновить тесты в `tests/`.
4. Прогнать полный gate: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build`.
5. Коммитить код, QA-артефакты и `tech.md` вместе логическим шагом.

Если правка чисто декаративная и не меняет поведение, достаточно обновить test-cases/bugs только при появлении нового бага.

## 14. Конвенции

- **Язык.** Коммиты, заголовки PR, комментарии в коде, имена: английский. Тексты бота: русский, только в `i18n/ru.ts`.
- **Коммиты.** Conventional Commits: `type(scope): summary`. `type` из набора `feat|fix|test|refactor|chore|docs`. `summary` в повелительном наклонении, со строчной, без точки, до 50 символов. Тело только для объяснения «почему». Коммитить маленькими логическими шагами по ходу работы. Каждый коммит по возможности проходит `tsc`.
- **Ветки и PR.** Короткие ветки от `main`, PR в `main` даже соло (CI как гейт). Заголовок PR кратко, тело: что делает, какие контракты затронуты, чем покрыто тестами.
- **Комментарии.** Объясняют «почему», не пересказывают код. Закомментированный код не коммитится.
- **Проза ТЗ и сообщений.** Активный залог, конкретика, без филлеров и без длинных тире.
- **TypeScript.** `strict`, без `any` (исключения с комментарием), `Result` вместо исключений для ожидаемых ошибок, zod на всех внешних границах.
- **Миграции.** Генерируются из `schema.ts` через drizzle-kit, применяются при старте. Сгенерированные миграции вручную не правятся. Изменение схемы требует правки раздела 5 и версии ядра.
- **Деньги и даты.** Только целые минорные единицы. Даты заказа как `IsoDate` в часовом поясе магазина, преобразования только в `lib/time.ts`.

### Definition of Done (одна задача)

- Критерии приемки задачи выполнены и отмечены.
- Тесты по разделу 13 написаны из критериев приемки и проходят.
- `eslint`, `prettier --check`, `tsc --noEmit`, `vitest run`, `build` зеленые.
- Если менялась схема: миграция сгенерирована, раздел 5 обновлен, версия ядра поднята.
- Если менялись контракты (callback, джобы, типы, статусы): раздел обновлен, версия ядра поднята, changelog дополнен.
- Тексты бота вынесены в `i18n/ru.ts`.

## 15. CI

GitHub Actions на PR и push в `main`: установка, `eslint`, `prettier --check`, `tsc --noEmit`, `vitest run` (включая property-тесты и сценарные), проверка, что миграции применяются к пустой SQLite, `build`. Деплоя нет: пилот запускается вручную на хосте командой `git pull && npm ci && npm run build && pm2 restart`. Автодеплой после появления постоянного сервера.

## 16. Правила для сессий нейросети

Этот раздел копируется в системный промпт или `CLAUDE.md` репозитория.

1. Перед работой прочитай `tech.md` целиком. Подчиняйся ему дословно.
2. Схему, типы, callback-данные, статусы и контракты джобов не выдумывай.
3. Если нужного контракта нет, остановись и выдай блок `CONTRACT GAP`: что нужно, зачем, предлагаемая форма. Код с выдуманным типом не пиши. Жди обновления `tech.md`.
4. Делай одну задачу за раз из раздела 17. Отдавай сфокусированный дифф.
5. Сначала тесты из критериев приемки, затем код. Не пиши тесты, отражающие реализацию.
6. Нет новых зависимостей, платных сервисов и файлов на диске без правки `tech.md`.
7. Пиши коммиты по конвенции раздела 14.

## 17. Дорожная карта

Каждая задача равна одному вертикальному слайсу и одному PR. Стадия N+1 не начинается, пока чек-лист стадии N не выполнен.

### Стадия 0. Скелет

Задачи:

- 0.1 Репозиторий, `tsconfig`, eslint, prettier, vitest, CI, `.env.example`, конфиг-модуль с zod.
- 0.2 `db/schema.ts`, drizzle-kit, миграции на старте, клиент SQLite в режиме WAL, `lib/crypto.ts`.
- 0.3 `TelegramPort`, `grammy-port`, `fake-port` с инъекцией ошибок.
- 0.4 Запуск нескольких ботов в одном процессе (runner), middleware: tenant, role, session (в БД), ошибки, antispam, funnel.
- 0.5 Планировщик джобов (таблица `jobs`, опрос, ретраи, `dedupeKey`).
- 0.6 `scripts/tenant-create.ts`, `seed.ts` с демо-магазином (категории, товары с опциями, FAQ).
- 0.7 Эталонная вертикаль: `/start` для клиента, список категорий и товаров из БД (эталон структуры слайса), тесты, сценарный тест через фейк.

Чек-лист «скелет готов»:

- CI зелен на тривиальном PR;
- миграции применяются на пустой БД в CI;
- два тестовых магазина работают параллельно в одном процессе;
- планировщик выполняет демо-джоб, повторный запуск не дублирует эффект;
- фейковый порт записывает вызовы и эмулирует `RATE_LIMIT` и `BLOCKED`;
- `npm run seed` создает демо-магазин, бот отвечает каталогом;
- бот запущен на целевой машине под pm2 или systemd и переживает рестарт.

### Стадия 1. Каталог и привязка владельца

- 1.1 Привязка владельца по claim-коду. Критерии: код одноразовый, повтор отклонен, истекший отклонен, не-владелец не видит меню владельца.
- 1.2 Редактор категорий и товаров (с опциями и фото). Критерии: изменения видны клиенту сразу, скрытое не показывается, удаление не ломает старые заказы.
- 1.3 FAQ: клиентский просмотр и редактор владельца.
- 1.4 Настройки текстов магазина (приветствие, о нас, доставка, реквизиты, контакты).

### Стадия 2. Корзина, оформление, загрузка

- 2.1 Корзина: `domain/pricing.ts`, экраны, сохранение в сессии.
- 2.2 `domain/capacity.ts`, `dates.ts`, `getDateAvailability`, календарь выбора даты. Критерии: недоступные даты не выбираются, причины показаны.
- 2.3 Оформление: шаги 1 - 8, черновик в сессии, возврат назад, отмена.
- 2.4 `createOrder` в транзакции: номер, повторная проверка загрузки, идемпотентность по `checkoutId`. Критерии: двойной submit дает один заказ, параллельный захват последнего слота дает один успех.
- 2.5 Карточка заказа владельцу, принять и отклонить (с причиной), уведомление клиенту, `domain/order-machine.ts`.
- 2.6 Календарь владельца: закрытые дни и лимиты.

### Стадия 3. Оплата и статусы

- 3.1 Предоплата: запрос реквизитов, «Я оплатил», прием чека, подтверждение и отклонение владельцем.
- 3.2 Джобы `order.payment_reminder` и `order.expire`. Критерии: идемпотентны, освобождают дату при истечении.
- 3.3 Статусы `ready` и `completed`, уведомления клиенту, джоб `customer.pickup_reminder`.
- 3.4 «Мои заказы» и отмена клиентом.
- 3.5 Встречная дата: предложение владельца, ответ клиента.

### Стадия 4. Диалог и защита от наплыва

- 4.1 Пересылка клиент - владелец, reply владельца, автоответ, кнопка «Написать клиенту».
- 4.2 Режим «перегруз» (`acceptOrders`, `busyText`).
- 4.3 Антиспам и блокировка клиента владельцем, обработка `BLOCKED`.

### Стадия 5. Инструменты для продвижения

- 5.1 Метки источников, генератор ссылок, QR, шаблоны текстов для Instagram.
- 5.2 Статистика: воронка, источники, выручка, время до решения.
- 5.3 Ежедневная сводка владельцу.

### Стадия 6. Надежность и пилот

- 6.1 Бэкап и `docs/restore.md`, проверка восстановления.
- 6.2 `scripts/load-sim.ts`, прохождение порога из 13.5.
- 6.3 `/deleteme`, команды суперадмина, уведомления об ошибках.
- 6.4 `docs/owner-setup.md`, демо-бот для показов (публичный, с демо-магазином).
- 6.5 Удалено из текущего скоупа: пилотирование перенесено в позднюю стадию, бот сейчас не готов к использованию.
- 6.6 Исправить видимость owner-меню: `/menu` должен показывать все разделы владельца (Заказы, Каталог, Вопросы и ответы, Календарь, Настройки, Ссылки для Instagram, Статистика, Как видит клиент) владельцу и суперадмину соответствующего tenant. Суперадмин видит owner-разделы только если он одновременно является владельцем этого tenant (`ownerTelegramId`); чистый суперадмин без привязки видит клиентский режим плюс команды `/status`, `/tenants`, `/pause`, `/resume`. Действия `adm:*` остаются только для владельца и tenant-админов из `ADMIN_TELEGRAM_IDS`.
- 6.7 Реализовать обработчик `adm:preview` для кнопки «Как видит клиент»: предпросмотр клиентского главного меню с актуальным приветствием и кнопками каталога/корзины/моих заказов/FAQ.
- 6.8 Визуальный дизайн и UX текстов/клавиатур: один экран равно одно сообщение, заголовок, короткие абзацы, кнопка «Назад» везде, empty-state, понятные ошибки, единый стиль разметки, внутри owner menu «Вопросы и ответы» вместо raw `FAQ`, разделы настроек сгруппированы.
- 6.9 Производительность: отдельно замерять Telegram API latency, время обработки апдейта через middleware, queries к БД, планировщик jobs; цель p95 < 200 мс на обработку блока обновлений; уменьшить повторные чтения tenant/session, не делать лишние записи в session, проверить `npm run load:sim`.
- 6.10 Навигация и состояния: после `/menu` и `/start` сбрасывать sessionState в idle, команды не должны перехватываться relay, показать суперадмину понятный ответ на `/menu`, показывать кнопки согласно текущему состоянию.
- 6.11 Привести тексты кнопок и экранов к единому виду, убрать английские/технические лейблы там, где владелец должен видеть понятный русский текст.
- 6.12 Удаление заказчика из tenant. Критерии: команда `scripts/tenant-delete.ts`, удаление связанных строк в правильном порядке, бэкап перед удалением, защита от удаления активного магазина без подтверждения, docs, тесты.

### Стадия 7. Кастомизация для одного магазина

- 7.1 Потребности клиентов: как быстро проверять фичу только у нужного tenant.
- 7.2 Вариант: вводится таблица/объект per-tenant настроек и feature flags, без хардкода tenantId в обработчиках.
- 7.3 Админский UI для включения/выключения фич per-tenant.
- 7.4 Сценарий внедрения: shared-код, tests, возможность включить для одного магазина без эффекта на остальные.

### Стадия 8. Полировка UX, платежей и перформанса

- 8.1 Добавление товара в корзину показывать toast/popup, а не отдельным сообщением; на карточке товара после добавления оставить кнопку «В корзину».
- 8.2 Корзина: нажать на количество товара («× N») открывает карточку этого товара с его текущим количеством и опциями; из карточки можно добавлять/убавлять количество и менять вес/опции.
- 8.3 Отдельный номер заказа для каждого клиента: номер в сообщении клиенту должен начинаться с 1 для него; для владельца можно хранить глобальный `tenant order number`.
- 8.4 Диалог владелец ↔ клиент: после сообщения владельца у клиента появляется кнопка для ответа; после ответа он увидит «Мастер скоро ответит». У владельца после ответа появляется подтверждение и кнопка написать клиенту снова.
- 8.5 «Другая дата» для существующего заказа должна использовать красивую месяц-сетку как при обычном оформлении, подтверждение переноса показывает тот же номер, который видит клиент.
- 8.6 Оплата/чек: если после «Пришлите фото или чек» клиент отправляет текст/недопустимый файл, бот должен попросить ещё раз и объяснить формат. Оба фото/файл уходят владельцу как фото/файл, не как plain text. В тексте владельцу: «Клиент N прислал подтверждение оплаты чеком/фото».
- 8.7 Во время оформления на экране даты добавить кнопку «Отмена», чтобы отменить оформление.
- 8.8 Контакт владелец: подсказка номера телефона зависит от валюты/страны: ₽/RU `+7...`, ₸/KZ `+7...`, UZS/UZ `+998...`.
- 8.9 Отменённые заказы до оплаты не держать в «Мои заказы» и не показывать пользователю.
- 8.10 Референсы/фото заказа: владелец должен видеть фотографии, которые прикрепил клиент, и сам клиент должен видеть свои вложения в своей карточке заказа.
- 8.11 Жёсткая оптимизация: замер логin/логи middleware, уменьшить чтение/запись в БД на каждый апдейт, не спамить сессии, проверить `npm run load:sim` и диагностировать slow paths.
- 8.12 Для UX использовать один экран равно одно сообщение, по возможности удалять лишние сообщения и не плодить чат.
- 8.13 Для постоянно доступных действий продумать inline-кнопки в каждом ключевом экране: «В меню», «Каталог», «Корзина», «Отмена».

### Стадия 9. Пилотное подключение

- 9.1 Подключение первых 3 - 5 пилотных кондитеров только после закрытия Stage 8 и полного регрессионного прогона.

### После MVP (по результатам пилота)

Self-service онбординг через мастер-бота, Mini App на бесплатном статическом хостинге (при появлении HTTPS-бэкенда), webhook-режим, несколько администраторов, рассылки по opt-in, автоучет оплаты, биллинг.

## 18. Проверка спроса и риски

### 18.1 Проверка спроса до и во время разработки

- После стадии 2 показать демо-бот 5 - 10 кондитерам из ниши. Вопрос: «Вставили бы ссылку на этого бота в шапку профиля?»
- Критерий продолжения: минимум 3 из 10 готовы подключить бота к своему аккаунту на бесплатный пилот.
- Критерий успеха пилота (2 - 4 недели): не менее 30% заказов у пилотного магазина приходит через бота, владелец подтверждает экономию времени на переписке, никто из пилотных владельцев не отказывается из-за неудобства.

### 18.2 Аргументы для продажи

- Первые полчаса работы после рилса не теряются: бот отвечает мгновенно.
- Клиент получает цены и каталог без ожидания, мастер получает готовую карточку вместо переписки.
- Загрузка по датам защищает от перебронирования.
- Подключение за день: создать бота в @BotFather, отправить токен, вставить ссылку в профиль.
- Бесплатный пилот, далее подписка (модель и цена определяются по итогам пилота).

### 18.3 Риски

| Риск                                         | Вероятность      | Митигация                                                                                                                                                        |
| -------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Клиенты не переходят из Instagram в Telegram | Высокая          | Короткий путь, автоответ директа со ссылкой, закрепленный комментарий, метки источников для измерения конверсии, честное позиционирование «бот дополняет директ» |
| Хост падает, бот недоступен                  | Средняя          | Автоперезапуск, хранение апдейтов Telegram 24 часа, `/status`, уведомления суперадмину                                                                           |
| Потеря БД                                    | Низкая           | Ежедневный бэкап в Telegram, регулярная проверка восстановления                                                                                                  |
| Владельцу сложно создать бота в @BotFather   | Средняя          | Пошаговая инструкция `docs/owner-setup.md`, первые магазины заводятся совместно                                                                                  |
| Блокировка бота Telegram за спам             | Низкая           | Нет рассылок в MVP, только ответы на инициативу клиента                                                                                                          |
| Кондитеры не доверяют передачу токена        | Средняя          | Объяснение: токен можно отозвать в @BotFather в любой момент, токены хранятся зашифрованными                                                                     |
| Ручное подтверждение оплаты ошибочно         | Низкая           | Чек пересылается владельцу, решение принимает он                                                                                                                 |
| SQLite не справится с ростом                 | Низкая на старте | Порог 20 магазинов на процесс, миграция на Postgres как отдельная стадия при необходимости                                                                       |

## 19. Открытые вопросы (не блокируют старт, действуют допущения из 1.6)

1. Страна и способ оплаты первых пилотных клиентов (влияет на формат реквизитов и валюту по умолчанию).
2. Будет ли у первого пилота одновременно несколько сотрудников, принимающих заказы (тогда «несколько администраторов» поднимается в MVP).
3. Где физически работает бот в пилоте (домашняя машина или бесплатная VM).
