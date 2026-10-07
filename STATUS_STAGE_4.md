# Стадия 4: Диалог и защита от наплыва — статус

| Задача | Коммит | Что сделано |
|---|---|---|
| 4.1 | `9411e51` | `bot/relay/relay.ts`: пересылка text/photo/document из любого состояния вне checkout/payment в чат владельца с шапкой «Имя, @username, заказ №N», copyMessage, собственные записи в `relay_messages`, ответ владельца reply-маппится по `(tenantId, ownerChatId, ownerMessageId)`, автоответ раз в 6ч (`lastAutoReplyAt`) с кнопками «Каталог»/«Мои заказы», funnel событие `free_text`. |
| 4.2 | `b036e01` | Режим «перегруз»: `/menu_settings` переключатель `acceptOrders`, при закрытии оформления `chk:start` показывает `busyText` и кнопку «Написать мастеру»; `createOrder` возвращает TENANT_BUSY; каталог/FAQ остаются доступны. |
| 4.3 | `bfa1772`(баг-fix), `c570c1f` | Антиспам-мидлвар исправлен (раньше блокировал всё после первого сообщения). `adm:relay:block:<customerId>` — блокировка клиента из шапки relay, заблокированные не попадают в relay и не получают автоответы. `BLOCKED` от Telegram в отправках клиенту: `customers.botBlocked=true`, флаг проставляется в обработчиках reminder/expire/pickup; другие ошибки джобов возвращают success: false для ретрая. |

Все callback/protobuf-контракты из 8.1 покрыты для реализованного функционала: `rel:start`, `adm:relay:block`, `adm:set:edit:toggle_accept` использует существующее поле `adm:set:*`. Bullseye на `tech.md` v1.2.

DoD: 31 файл тестов, 145 тестов, eslint/prettier/tsc/vitest/build зелёные.
