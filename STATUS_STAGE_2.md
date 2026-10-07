# Стадия 2: Корзина, оформление, загрузка — статус

## Завершённые задачи

| Задача | Коммит | Что сделано |
|---|---|---|
| 2.1 | `9f63808` + bump tech.md v1.1 | `domain/pricing.ts`, корзина в сессии, `prd:add`/`prd:opt`, `chk:start` |
| 2.2 | `2962cc4` | `domain/dates.ts`, `domain/capacity.ts`, `services/dates.ts`, календарь checkout.date, property-тест на `getDateAvailability` |
| 2.3 | `27d9752` | все шаги checkout.*, «Назад», отмена, контакты, фото до 5, сводка. Fix: общий `.on('message:*')`-обработчик с `next()` |
| 2.4 | `2b07266` | `services/orders.ts#createOrder` в sync-транзакции, защита от race по idempotencyKey и по ёмкости, chk:submit подвязан |
| 2.5 | `86ea347` | `domain/order-machine.ts#transition`, `applyOrderEvent`, карточка заказа, Принять/Отклонить с причинами, уведомление клиента |
| 2.6 | `f9786fe` | `services/calendar.ts`, календарь owner, закрытие дня, лимит, валидация ввода |

## В работе

- [x] 2.2 domain/capacity.ts, dates.ts, getDateAvailability, календарь выбора даты
- [x] 2.3 Оформление: шаги 1–8, черновик, «Назад», отмена
- [x] 2.4 `createOrder` в транзакции: номер, повторная проверка загрузки, идемпотентность
- [x] 2.5 Карточка заказа владельцу, принять/отклонить, уведомление клиенту, `order-machine`
- [x] 2.6 Календарь владельца: закрытые дни и лимиты
