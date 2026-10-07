# Confectioner Bot

Telegram bot storefront and order receiver for confectioners.

## Tech Stack

- Node.js >=22
- TypeScript (strict mode)
- grammY (Telegram Bot Framework)
- SQLite + Drizzle ORM
- Vitest + fast-check

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in required values:
```bash
cp .env.example .env
```

3. Generate APP_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Get your Telegram ID from [@userinfobot](https://t.me/userinfobot)

5. Load `.env` before starting the app:

```bash
set -a && source .env && set +a
```

> The app reads environment variables directly, so `.env` must be loaded into your shell.

## Development

```bash
# Run in development mode with watch
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Build
npm run build

# Start production
npm start
```

## Documentation

See [tech.md](./tech.md) for complete technical specification.

## Quick explanation

### English

This project is a multi-tenant Telegram bot for confectioners.
Each shop gets its own bot: customers see a catalog, create orders,
pay by manual transfer, and chat with the owner.
Owners manage products, calendar, payments, links, statistics, and FAQ from Telegram.

- Customer path: `/start` → catalog → cart → checkout → payment/order tracking.
- Owner path: `/menu` → orders, catalog, calendar, settings, links, statistics.
- Superadmin commands: `/status`, `/tenants`, `/pause <slug>`, `/resume <slug>`.
- Useful docs:
  - [docs/owner-setup.md](./docs/owner-setup.md) — how to connect a shop.
  - [docs/restore.md](./docs/restore.md) — database backup/restore.

### Русский

Это multi-tenant Telegram-бот для кондитеров.
У каждого магазина своя бот-точка продаж: клиенты выбирают товары, делают заказы, оплачивают переводом и получают статус заказа.
Владелец управляет каталогом, календарём, оплатой, ссылками для Instagram, статистикой и FAQ прямо в Telegram.

- Путь клиента: `/start` → каталог → корзина → оформление → оплата/мои заказы.
- Путь владельца: `/menu` → заказы, каталог, календарь, настройки, ссылки, статистика.
- Команды суперадмина: `/status`, `/tenants`, `/pause <slug>`, `/resume <slug>`.
- Полезные документы:
  - [docs/owner-setup.md](./docs/owner-setup.md) — как подключить магазин.
  - [docs/restore.md](./docs/restore.md) — бэкап и восстановление БД.
