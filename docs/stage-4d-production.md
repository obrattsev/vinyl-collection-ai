# Stage 4D — production release

**SUCCESS / Stage 4D — PRODUCTION DONE**, 16.10.2026. Все обязательные технические release gates пройдены. Единственный тестовый Bug Report сохранён в PostgreSQL, совпадает с Sheets archive и доставлен через Postbox; владелец подтвердил получение письма. Первый ежедневный отчёт и подтверждение его получения — отложенная проверка, не блокирующая закрытие по решению владельца.

## Exact artifact и подготовка

Production SHA: `d5f0ee90632339c8470cb9d710f32e99182098c2` (PR #33 + PR #34).

Неполный candidate предыдущей попытки изолирован в каталоге с суффиксом `.incomplete-182701`. Чистый artifact собран из exact Git SHA с файлом RELEASE; SHA-256 архива `503099e903a31c2d1245c5f2c043301e140bfaabf2b7db0f7d0da88a2f45f41f` проверен сервером. Все 232 исходных файла сверены побайтно с архивом. Установка выполнена от vinyl с явным приватным cache `/var/cache/vinyl-stage4d-d5f0ee9` (0700), HOME не менялся. 44 locked packages; Node 24.19.0 / npm 11.17.0; pg, sharp 0.35.5 и native WebP проверены. Release root-owned, group/other write запрещён.

В первой диагностической команде native check был указан неверный внутренний путь sharp/lib/index.js. Проверка через официальные package exports подтвердила исправность установленного пакета; повторной установки или изменения зависимостей не было.

## Gates

- Baseline: прежний release f593b3f, schema 5, frozen=false; исходные данные и сессии совпали. Mirror/backup/Postbox TLS-auth/resources исправны.
- Candidate и rollback совместимы с schema 5→7; после миграций повторный compatibility gate на schema 7 прошёл.
- Nginx generation установлен при отсутствующем flag; master PID 708 сохранён, старый worker 253511 завершился, новый worker 264027 подтверждён. Внешние 56 status/location baseline probes сохранили прежнее поведение и подтвердили новый marker.
- Flag активирован без reload. **168/168** внешних HTTP/HTTPS canonical/www/API/auth probes: 503, exact generation/maintenance markers, no-store, Retry-After. Public IP bypass отсутствовал, Node слушал только loopback. Только затем freeze/drain и graceful stop.
- Свежий backup PostgreSQL + Covers создан, manifest hashes проверены. Реально восстановлен в отдельную marked test DB и отдельные Covers. Сверены canonical данные владельца, бизнес-данные всех пользователей, 74 файла Covers и auth integrity (2 user_auth, 3 sessions). Только восстановленная копия прошла quarantine; тестовая БД/роль/Covers удалены. Production restore не выполнялся.
- Применены 006_bug_report_delivery.sql → 007_service_statistics.sql. **Schema 7**, checksums всех миграций и runtime/backup grants подтверждены.
- Только после restore/schema/grants gates переключён exact SHA. Приватный smoke 11/11, данные/Covers/сессии совпали с frozen snapshot. После явного thaw — after compatibility PASS, frozen=false.
- Google Sheets mirror проверен реальным read-back против PostgreSQL. Исходные mirror/backup states восстановлены.
- Flag удалён без reload; внешний baseline и HTTPS smoke 11/11 прошли. Затем временный nginx snippet удалён, worker 264027 завершился; исходный site config восстановлен. Финальные 56 probes прошли, временные markers отсутствуют.

Operation directory: `/var/backups/vinyl-4d-20261015T185822Z`; свежий backup и restore proof сохранены там с ограниченным доступом. Предыдущий release f593b3f сохранён. PostgreSQL rollback не выполнялся.

## Downtime и данные

Maintenance: 15.10.2026 **22:01:57–22:06:17 МСК**, **260,053 секунды (4 минуты 20 секунд)** по времени активации/снятия flag. Это интервал блокировки публичного ingress; внешние probes подтвердили 503 внутри него и нормальный доступ после.

На момент переключения: 29 Collection, 12 Wish-list владельца + 1 другого пользователя, 6 Favorites, 37 Covers / 74 файла. Данные и прежние активные сессии сохранены.

Во время последующей паузы пользователь перенёс одну запись Wish-list → Collection: новая и удалённая запись совпадают по метаданным, все остальные записи неизменны. Текущие counts: **30 Collection / 11 Wish-list владельца**, Wish-list всех пользователей **12**; Favorites 6, Covers 37/74. Эти данные не исправлялись под старые числа. Mirror generation=12/synced=12, ошибок нет. Сессии сохранены.

Обе публичные проекции проверены на отсутствие приватных полей; четыре реальных запроса image/thumb Covers прошли. Технические HTTP probes без авторизации/cookies/activity headers; статистические события искусственно не создавались.

## Интеграции и финальное состояние

- App/mirror active; NRestarts=0; failed systemd units=0. В journal app/mirror/nginx нет error-level записей после переключения; nginx error.log — 0 error/crit/alert/emerg с начала окна.
- Backup timer active. Штатный backup уже успешно выполнен на новом release: **16.10.2026 06:23:03 МСК**, retained=8. Новый schema 7 backup не заменяет пройденный pre-DDL restore gate.
- Postbox TLS/auth PASS. Bug Report `b37d57e5-ce90-41d2-ae80-22f787cf42d3`: PostgreSQL rows=1, Sheets rows=1, exact read-back PASS, sheet_state=sent, mail_state=sent; sheet_attempts=1, mail_attempts=1. Release в отчёте совпадает с exact production SHA. Владелец подтвердил получение письма 16.10.2026.
- Установлены и проверены systemd units: vinyl-daily-statistics.service, vinyl-daily-statistics.timer, vinyl-daily-statistics-retry.timer. Timers enabled/active; 10:00 МСК, retry 10:05/10:10 МСК. Ближайший первый запуск **16.10.2026 10:00 МСК**.
- Учёт начался **15.10.2026 22:04:22 МСК**. Первый отчёт — предыдущий календарный день, с пометкой неполного периода. За этот день в PG есть реальный пользовательский просмотр и одно добавление при переносе; backfill/искусственных событий/ручного исторического письма не было. Первый scheduled report и inbox — отложенные проверки.
- Maintenance flag отсутствует, nginx исходный, frozen=false, production current указывает на exact SHA выше.

## Закрытие и отложенная проверка

Единственный помеченный Bug Report пользователь отправил через production UI после запроса. Автоматическая перезагрузка авторизованного UI была отклонена проверкой безопасности из-за риска учесть технический просмотр в статистике; обход не выполнялся. Отдельной пользовательской визуальной приёмки не проводилось, она не требуется по решению владельца.

**Stage 4D — PRODUCTION DONE.** Новый release работает на schema 7, rollback не потребовался. Первый ежедневный отчёт ожидается 16.10.2026 в 10:00 МСК за неполные сутки 15.10.2026; получение первого daily email остаётся отложенной проверкой. Его отправка заранее не имитировалась.

Финальный отчёт и backlog обновлены локально; новые commit/push/PR/merge не выполнялись. Действующий immutable production artifact не менялся после проверки. Stage 4E не начинался.
