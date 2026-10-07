# Удаление магазина

Команда:

```bash
set -a && source .env && set +a
npm run tenant:delete -- --slug <slug>
```

Если магазин ещё активен, нужно подтверждение:

```bash
npm run tenant:delete -- --slug <slug> --force
```

Скрипт:

1. Делает бэкап SQLite в `./backups/pre-delete-*.db`.
2. Удаляет заказы, товары, клиентов, FAQ, источники, FAQ, сессии и джобы.
3. Удаляет строку из `tenants`.

Важно: после удаления данные нельзя восстановить без бэкапа.
