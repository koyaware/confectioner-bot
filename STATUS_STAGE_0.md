# Стадия 0: Скелет — статус

## Завершённые задачи

| Задача | Коммит | Что сделано |
|---|---|---|
| 0.1 | в CI | tsconfig strict, eslint, prettier, vitest, GitHub Actions, .env.example, config с zod |
| 0.2 | `7822e05`, `ee49926` | `db/schema.ts` (16 таблиц по разделу 5), `lib/crypto.ts` (AES-256-GCM, claim-коды), миграции drizzle-kit, WAL |
| 0.3 | `3709bfa` | `TelegramPort`, `GrammyPort`, `FakePort` с инъекцией ошибок (RATE_LIMIT/BLOCKED/NETWORK) |
| 0.4 | `9a71695`, `dd2e50d` | runner, factory, middleware: tenant, role, session, antispam, funnel, errors |
| 0.5 | `129a9d2` | планировщик jobs: таблица `jobs`, опрос, ретраи 60/300/1800 с, dedupeKey, идемпотентность |
| 0.6 | `e652c15` | `services/tenants.ts` (createTenant с зашифрованным токеном и хешем claim-кода), `scripts/seed.ts`, `scripts/tenant-create.ts` |
| 0.7 | `bfa1772` | эталонная вертикаль: `/start`, `cat:list` → `cat:open` → `prd:open`, фейковый порт, сценарные тесты |

## Что зафиксировано по ходу

- Middleware antispam имел баг: блокировал любые сообщения в течение 5 минут после первого (см. коммит `bfa1772`). Исправлен.
- grammY требует `entities` в апдейтах команд для `bot.command` — учитывать в сценарных тестах.
- `new Bot(token)` без `botInfo` падает в `handleUpdate` — в factory подставлен placeholder botInfo.

## Чек-лист стадии 0

- [x] миграции применяются на пустой БД (тест и CI)
- [x] планировщик выполняет демо-джоб, повторный запуск не дублирует эффект (тест идемпотентности)
- [x] фейковый порт записывает вызовы и эмулирует RATE_LIMIT/BLOCKED
- [x] `npm run seed` создаёт демо-магазин, бот отвечает каталогом (сценарный тест)
- [ ] бот запущен на целевой машине под pm2/systemd — отложено до пилота
- [ ] CI на тривиальном PR — workflow добавлен в репозиторий, зелёный запуск на GitHub не проверялся

Тесты: `vitest run` зелёный на этапе 0 (см. текущее число тестов в `STATUS_STAGE_2.md`).
