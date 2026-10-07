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
