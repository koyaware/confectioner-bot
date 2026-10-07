# Стадия 3: Оплата и статусы — статус

| Задача | Коммит | Что сделано |
|---|---|---|
| 3.1 | `9cde827` | Оплата вручную: `paymentText`, предоплата, кнопка «Я оплатил», `payment.await_receipt`, чек → `payment_review`, `adm:ord:paid/badpay`, `paymentDueAt`, в текст события `receipt_uploaded`. |
| 3.2 | `a539c06` | Джобы `order.payment_reminder` и `order.expire` создаются в той же транзакции, что и переход в `awaiting_payment`; идемпотентные хендлеры; main.ts запускает runner и планировщик. |
| 3.3 | `620e67b` | ready/completed/cancel через `adm:ord:ready/done/cancel` с уведомлениями клиента, `customer.pickup_reminder` джоб (за день 10:00 local). |
| 3.4 | `c58873d`, `f07292d` | «Мои заказы»: `/start` кнопка, `my:list`, `my:view`, отмена только в `new`/`awaiting_payment`, уведомление владельцу. |
| 3.5 | `b8adcde` | `adm:ord:date` календарь, `adm:ord:pd` ставит proposedDate, `pd:yes` повторно проверяет доступность и авто-принимает (dueDate = proposedDate → owner_accept), `pd:no` очищает и уведомляет владельца. |

Баг пойман тестами: внутренний парсер callback-дейт `adm:ord:paid:...` не включал paid/badpay, кнопки оплаты не работали.

DoD: eslint, prettier, tsc, vitest (29 файлов, 141 тест), build — зелёные.
