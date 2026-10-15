# Stage 4D.8 — Bug Reports + Postbox: локальный результат

> Актуальный итог: **LOCAL DONE / PRODUCTION PENDING**. Функциональный scope принят/закрыт владельцем; финальные checks завершены, ручная приёмка локального stand ожидается. Исторические статусы ниже относятся к предыдущим итерациям. [Финальный отчёт](stage-4d-final-readiness.md).

**LOCAL DONE — принято владельцем 15.10.2026.** 4D.7 принят владельцем. Документационный PR #32 слит после CLEAN/MERGEABLE проверки; main синхронизирован на `7f4c775`. Все 11 файлов 4D.7 сохранены через stash и независимую копию, восстановлены побайтово по SHA-256; safety stash не удалён. Текущая разработка локальная, без commit/push/PR для кода.

## Поведение

- Кнопка доступна авторизованным пользователям; сервер сохраняет session/CSRF/Origin и прежние IP limits. Непосредственно перед PG записью повторно проверяются сессия и freeze.
- HTTP 201 означает commit отчёта и delivery state в существующий PostgreSQL. Внешние Sheets/Postbox не участвуют в этой transaction и не могут отменить accepted report.
- User UUID берётся только из серверной сессии. Client UUID `Idempotency-Key` ограничен парой user/key; неизменённый повтор возвращает тот же id, другое содержимое — 409. UI сохраняет key при повторе неизменённого запроса; при смене identity/текста/страницы создаёт новый. Перезагрузка страницы создаёт новый UI intent, поэтому абсолютная дедупликация одинакового текста с разными ключами не обещается.
- Persistent PostgreSQL limits: 3 новых reports за 15 минут на пользователя, 50 за час общие; retries с прежним ключом не создают rows. Сохраняются IP limits 3/15 минут и 50/hour, body 16 KiB и text 2000 Unicode code points. NUL, forged identity/recipient и page с query/token/внешним URL отклоняются.
- Встроенный worker сохраняет report в прежнюю отдельную Google Sheets-таблицу (прежние пять колонок), затем/независимо доставляет notification владельцу после PG commit. Идентификатор пользователя и page находятся в PG journal и email, Google schema не меняется. Одновременно работает один worker по advisory lock, максимум один report за 10-секундный проход.

## SMTP и неопределённые результаты

Используется прежний Yandex Cloud Postbox/Nodemailer transport, TLS и фиксированный From `Vinyl Collection <no-reply@vinyl-collection.ru>`. Отдельные настройки — `BUG_REPORT_NOTIFICATIONS_ENABLED` и `BUG_REPORT_EMAIL_TO`; fallback на From/owner/test email отсутствует. Владелец указал получателя, настройка подготовлена только в приватном локальном env mode 0600. Production env не изменён.

Email содержит report id, дату/время UTC, user UUID, section/page и описание. Только plain text; пользовательский текст не влияет на заголовки, From, To или attachments. Используется стабильный Message-ID.

Known SMTP rejection → до 5 попыток с паузой минимум минута. Timeout/неясный provider outcome или процесс, прерванный в `sending`, → `unknown`, без автоматического resend. Это предотвращает слепые повторные письма, но требует операторской сверки неопределённого результата. При исчерпании попыток `failed`, report не удаляется. Exactly-once SMTP не обещается.

Для Sheets перед append сохраняется `writing`; затем read-back по server id. После ambiguous write дальнейшие проходы только сверяют наличие, не append повторно. После пяти попыток нужна операторская сверка. Если Sheets недоступен, PG report сохранён; уведомление всё равно может быть доставлено. Уведомление не зависит от доступности Sheets.

## Код и эксплуатация

Подготовлена additive migration `006_bug_report_delivery.sql`: одна таблица в существующем PostgreSQL с payload/idempotency/delivery status, без новой базы/queue/service. Runtime получает SELECT/INSERT/UPDATE, backup — SELECT; обычный full PG dump содержит отчёты. Выполнение migration и grants на production **не проводилось**. Archive независим от удаления account, как существующие reports; хранится UUID, не email. Privacy/retention обращений учитываются оператором вместе с прежним Sheets archive.

Обновлены backend route/startup, прежний email adapter, report UI и tests. Worker прекращает работу при freeze и не выгружает quarantined disabled user; startup проверяет наличие новой schema/прав. Graceful shutdown ждёт текущего worker перед закрытием pool. Policy новой версии 6–6; rollback к старому binary разрешается лишь после явного schema review с external exact-SHA policy и checksum 006, без изменения старого artifact и без downgrade БД.

## Проверки

- Regression: **443/443**.
- Полный PostgreSQL suite: **97/97**.
- Дополнительный focused PG run после усиления NUL/retry exhaustion/grants: **10/10**.
- Проверены: SMTP отказ и timeout; повтор HTTP/конкурентные запросы/повтор после пересоздания service; restart в sending; lost Sheets response и ambiguous append; frozen state; user rate limit; anonymous/expired/revoked session; CSRF/foreign Origin; попытки подмены identity; runtime/backup grants; sender/recipient/text/header safety; UI request key и logout.
- Найденный при тестировании UI callback был исправлен: identity теперь хранится из applySession, а не берётся из недоступной переменной. Fixture Origin/pathname и открытие dialog в старом CSRF test приведены к реальному сценарию; проверки авторизации сохранены.
- Diff/whitespace/secret review и syntax checks пройдены. Dependency lockfile не менялся; свежий npm audit — 0 vulnerabilities.

Реальные SMTP письма, запись в Google Sheets, production migrations/deployment и production rollback не выполнялись. Фактическая доставка получателю не заявляется выполненной: она остаётся отдельной согласованной приёмкой. Производственные данные не использовались для destructive tests. Блок цитат не менялся; владелец подтвердил существующее оформление Collection/Wish-list.

После подготовки остановиться для приёмки 4D.8; к формам/обложкам/фильтрам не переходить без следующего разрешения.

Последующее решение владельца: реальный Postbox email, migration 006 и production smoke отложены до общего выпуска Stage 4D. Блок форм/обложек/текстов разрешён локально; production остаётся без изменений.
