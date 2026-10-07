# Деплой на VPS (Ubuntu 22.04)

Всё ниже уже проверено на боевом сервере. Команды выполнять по порядку.

## 1. Система (root)

```bash
apt update && apt install -y curl git build-essential python3 nano
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v && git --version
```

- Нужен Node.js **22+** (`node -v` → `v22.x`).
- `build-essential` + `python3` обязательны: `better-sqlite3` компилируется.
- Если `apt` спросит `Which services should be restarted?` — отвечай `14` (none), рестарт sshd через SSH опасен.
- Дефолтные `tsc`, `eslint`-предупреждения npm и `npm audit` — шум, игнорировать. `npm audit fix --force` **не запускать**.

## 2. Код

```bash
git clone https://github.com/koyaware/confectioner-bot.git /opt/confectioner-bot
cd /opt/confectioner-bot
npm ci
npm run build
cp -r src/db/migrations dist/db/migrations
cp -r src/db/seed-data dist/db/seed-data
ls dist/main.js
```

- Ставить полным `npm ci` (без `--omit=dev`): `tsc` для сборки лежит в dev-зависимостях.
- `tsc` не копирует `.sql`/`.json` в `dist/` — поэтому два `cp` обязательны, иначе старт упадёт с `ENOENT` на миграциях.

## 3. Конфиг `.env` (секреты — только на сервере, никогда в git)

```bash
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
cat > .env << EOF
APP_SECRET=$SECRET
SUPERADMIN_TELEGRAM_ID=123456789
DATABASE_PATH=./data.db
LOG_LEVEL=info
NODE_ENV=production
EOF
```

Затем вписать свой Telegram ID вместо `123456789` (узнать у @userinfobot):
```bash
sed -i 's/^SUPERADMIN_TELEGRAM_ID=.*/SUPERADMIN_TELEGRAM_ID=ТВОЙ_ID/' .env && grep SUPERADMIN .env
```

## 4. Пробный запуск

```bash
NODE_ENV=production node dist/main.js
```

Ждать ~20 секунд: должны пройти `Applied migration`, `Job scheduler started`, `Bot is running`. Остановить: `Ctrl+C`.

## 5. Автозапуск через pm2

```bash
npm i -g pm2
pm2 start dist/main.js --name confectioner-bot
pm2 save
pm2 startup
```

`pm2 startup` напечатает длинную команду — выполнить её, затем ещё раз `pm2 save`. Проверка: `pm2 list` → `online`.

## 6. Первый магазин

1. [@BotFather](https://t.me/BotFather): `/newbot` → имя → username → скопировать токен.
2. На сервере:
```bash
npx tsx scripts/tenant-create.ts --slug demo --name "Демо" --token "ТОКЕН_ИЗ_BOTFATHER"
```
3. Скрипт выдаст ссылку `t.me/...?start=claim_xxx`.
4. **Важно:** новые магазины подхватываются только на старте процесса:
```bash
pm2 restart confectioner-bot
```
5. Открыть ссылку в Telegram → `/start` → ты владелец → `/menu` → наполняешь каталог.

Следующие магазины — так же: `tenant-create` + `pm2 restart`.

## 7. Обновление кода

```bash
git pull && npm ci && npm run build && cp -r src/db/migrations dist/db/migrations && cp -r src/db/seed-data dist/db/seed-data && pm2 restart confectioner-bot
```

## 8. Диагностика

```bash
pm2 list                                  # жив ли процесс
pm2 logs --lines 30 --nostream            # что происходит (включая ошибки запуска ботов)
pm2 restart confectioner-bot              # рестарт
```

## 9. Бэкапы

Ежедневно файл БД сам прилетает в Telegram суперадмина (джоб `backup.db`). Восстановление — по `docs/restore.md`. Удаление магазина — `docs/delete-tenant.md`.
