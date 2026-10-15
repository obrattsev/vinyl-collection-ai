# Обычные production releases после Stage 4C

> Current authorization 15.10.2026: owner VISUAL ACCEPTANCE complete (including package 1). Git branch/commit/push/PR and production READ-ONLY audit authorized. Merge, deployment, production changes and real emails require separate approval. LOCAL DONE / VISUAL ACCEPTED / PRODUCTION PENDING.

> **LOCAL DONE / PRODUCTION PENDING.** Нормативная последовательность общего release Stage 4D — [production plan](stage-4d-production-plan.md): schema 5→7 и grants до current switch; frozen backup/restore gate; after check только после explicit thaw при закрытом ingress. Предыдущие записи ниже сохраняют исторический контекст 4D.7/8. Git/production пока не разрешены.

Статус: локальная реализация 4D.7; production применение не разрешено. Один Node process за nginx, существующие PostgreSQL/PG sessions, systemd, filesystem Covers, mirror и backup timer. Новых служб, БД, зависимостей и CI/CD нет. Короткий restart означает возможный downtime; zero-downtime не обещается.

## Что изменилось

Раньше artifact/current/restart и проверки выполнялись по отдельным runbooks. Теперь добавлены `release-policy.json`, read-only `scripts/release-check.mjs` и `scripts/release-smoke.mjs`. Они не выполняют SSH, systemctl, migrations, switch, rollback, SMTP или пользовательские writes. Переключение остаётся явной операцией оператора по checklist. Это ограничивает автоматизацию проверками, а не вводит новый deployment orchestrator.

`release-check` читает RELEASE/policy/SQL checksums кандидата и rollback release, затем в одной READ ONLY transaction проверяет applied migration history, freeze и mirror lag/error. Проверяется как текущая, так и предполагаемая итоговая схема; невозможность доказать совместимость — STOP. `before` выводит pending migrations, `after` запрещает оставшиеся pending. Значения env/DB rows/credentials в stdout не выводятся. Backup/timers/secret stability/ингресс этим скриптом не проверяются — ниже отдельные операторские gates.

При приёмке 4D.7 политика была multiuser/schema 5–5; следующая локальная 4D.8 требует migration 006 и policy 6–6; согласованная статистика добавляет migration 007 и текущую candidate policy 7–7. Верхняя граница не может превышать упакованные известные migrations. Это сознательно консервативно: неизвестная новая migration блокирует rollback. SQL не анализируется эвристически на «безопасность». Schema contract меняется только после review конкретного кода/DDL и rehearsal. Для migrations, не совместимых с предыдущим binary, обычный процесс останавливается: требуется отдельно согласованный план expand/contract или maintenance + forward fix. Автоматических down migrations/PG restore нет.

## Команды проверок

Рабочий каталог — подготовленный candidate release. Использовать существующий Node 24 и защищённый loader env; `DATABASE_URL` не передавать через argv и не печатать. Примеры содержат placeholders, а не реальные секреты.

```sh
node --env-file=<PROTECTED_ENV> scripts/release-check.mjs <CANDIDATE_DIR> <ROLLBACK_DIR> before
node --env-file=<PROTECTED_ENV> scripts/release-check.mjs <CANDIDATE_DIR> <ROLLBACK_DIR> after
node scripts/release-smoke.mjs https://vinyl-collection.ru
# Необязательно: только явно согласованный и уже публичный profile login:
node scripts/release-smoke.mjs https://vinyl-collection.ru <PUBLIC_LOGIN>
```

В 4C артефакте ещё нет policy. Для первого upgrade оператор после review готовит внешнюю JSON-декларацию для **точного rollback SHA** (не изменяя старый artifact): `format:1`, `release:<FULL_SHA>`, `authMode:multiuser`, `minimumSchema:5`, `maximumSchema:5`. Передать её четвёртым аргументом `release-check` после `before|after`. Это явное утверждение оператора, не автоматическое доказательство совместимости legacy binary. Checksums SQL по-прежнему берутся из настоящего rollback artifact и сравниваются с БД. Без декларации — STOP. Для следующих версий policy находится внутри артефакта.

Smoke делает ограниченный набор GET с timeout, без cookies и следования redirects: root/auth/assets, bare Collection/Wish-list → `/`, guest API → 401 AUTH_REQUIRED, session → guest/multiuser. При public login дополнительно проверяются HTML/API и public field allowlist. Выводит только path/status. Не регистрирует, не меняет пароль, не отправляет письма, не создаёт reports. Read-only HTTP не означает ноль служебных записей: существующий rate limiter приложения может обновлять технические counters. Ограничить частоту запусков; не повторять при 429 бесконечно. Runtime SHA проверяется отдельно по current/RELEASE; smoke не доказывает идентичность binary.

## Последовательность оператора после отдельного разрешения на выпуск

1. Согласовать target SHA, scope, окно и rollback boundary. Чистый merged commit, reproducible archive и lockfile, полный diff/secrets review. Проверить, что artifact соответствует именно target SHA; файл RELEASE сам по себе этого не доказывает. Подготовить Linux dependencies и readonly ownership до окна. Никакого `npm install` в active current.
2. Записать предыдущие current/RELEASE, app/mirror/timer states, freeze, schema checksums, backup result/age, ресурсы и ссылки Covers. Проверить PG schema contract командой `before`. Если mirror dirty, дождаться reconcile/read-back и повторить проверку; не сбрасывать lag вручную. Если freeze уже стоит — выяснить владельца maintenance, не снимать чужой freeze.
3. Существующим механизмом сделать свежий проверенный PG+Covers backup с manifest/checksums. Schema changes требуют отдельной изолированной restore/migration rehearsal. Backup job должен завершиться до ручного freeze; не пересекать два процесса. Наличие старого manifest не равно успешному свежему backup. Не менять retention 7 daily + 4 weekly.
4. Сохранить root-only config snapshot вне Git. Сравнить неизменность AUTH_SECRET, DATABASE_URL, session cookie settings, APP_ORIGIN, auth flags, PG owner, COVERS_DIR, mirror owner и Postbox settings без печати значений. Обычный update не очищает sessions, не повышает auth_version и не запускает quarantine. Новый secret допустим лишь как отдельная security операция с ожидаемым logout.
5. Закрыть внешний ingress существующим maintenance механизмом, оставив согласованный доступ оператора для smoke. Для migration закрываются и auth mutations: один `pg-freeze on` не блокирует все auth flows. Дождаться текущего backup, временно остановить timer/mirror только если это нужно для окна; сохранить их исходные enabled/active состояния. Установить штатный freeze/drain, остановить app через systemd и убедиться в завершении старого процесса. Существующий SIGTERM handler вызывает server.close и закрывает PG pool после принятых HTTP запросов. При незавершённых запросах/stop timeout — STOP, не делать слепой SIGKILL и не продолжать DDL.
6. Для code-only update migrations **не запускать**. Если есть согласованные pending DDL, выполнять существующий pg-migrate с privileged migration connection, checksum/advisory lock и bounded lock/statement timeouts. Текущий pool задаёт lock_timeout=5s и statement_timeout=10s; длительный DDL требует отдельного review, не автоматического увеличения. Каждая migration — отдельная transaction: при ошибке более ранняя могла уже примениться. Остановиться и переснять history, не повторять пакет вслепую и не делать down/restore. Grants — только необходимые, runtime не superuser.
7. Проверить завершённую schema/rollback совместимость; `after` требует frozen=false и synced mirror, поэтому выполнить его после контролируемого снятия собственного freeze в закрытом ingress и нужного reconcile, до публичного открытия. Если для миграции нельзя безопасно получить проверяемое состояние — STOP. Не обходить ошибку через изменение manifest/checksum/policy без review.
8. Атомарно заменить symlink current в той же filesystem (временная ссылка + rename), restart только app. Не заменять shared Covers/env. Проверить current/RELEASE target SHA и startup status/resources. Не добавлять unconditional `trap ... thaw/open` на ошибке.
9. Запустить read-only smoke через согласованный operator access к настоящему HTTPS origin, затем `after` check; backup timer/mirror вернуть в записанное исходное состояние и проверить отсутствие ошибок/зависшего freeze, mirror reconcile/read-back. Если smoke пропускается из-за maintenance/access — выпуск не считается проверенным. Владелец может отдельно проверить сохранённую собственную сессию; не копировать cookie в чат/лог.
10. Открыть ingress только после всех gates, записать SHA, время начала/конца окна, фактический downtime, backup proof, проверки и ограничения. После неуспеха не утверждать автоматически, что прежнее состояние восстановлено.

## Понятный rollback приложения

При провале startup/smoke оставить ingress закрытым. Определить последнюю реально применённую migration и повторно подтвердить совместимость выбранного предыдущего multiuser artifact с текущей schema. Вернуть current на этот artifact атомарно и restart app. Повторить smoke/`after`, проверить data/session continuity, mirror и backup timer. Только затем открыть ingress.

Если предыдущий binary несовместим с БД, app rollback **запрещён**: оставить maintenance и подготовить forward fix/решение владельца. Не возвращаться к Stage 4B после multiuser writes. PostgreSQL автоматически не откатывается, резервная копия не восстанавливается, sessions не очищаются. Аварийный restore — отдельное разрешение и прежние quarantine/recovery с принятым риском возврата удалённых аккаунтов.

## Локальные доказательства и границы

`tests/release-safety.test.mjs`: checksum/history/range gates, legacy SHA binding, read-only transaction и errors, guest access/content/redirect smoke. `tests/postgres/release.test.mjs`: маркированная test DB, реальная регистрация с capture email, синтетическая запись, прежний cookie после пересоздания HTTP/auth runtime; локальный current symlink переключается candidate → failed smoke → previous, schema/records/cover hash/mirror не откатываются. Это локальная HTTP/PG rehearsal, не Linux systemd или production disaster drill. Существующие PG integration tests дополнительно проверяют concurrent migration/checksum failure/transactional failed DDL.

Системные таймеры, nginx и production backup в этом цикле не изменялись и их реальная работа не тестировалась. Они включены в обязательный release checklist. Фактический production downtime будет известен только при отдельно разрешённом выпуске. До принятия 4D.7 к Bug Reports и остальным пунктам 4D не переходить.

## Переход 4D.8 / migration 006

006 — additive таблица report journal/delivery; старый multiuser binary её не использует. Это не автоматическое разрешение совместимости: перед release нужен code/DDL review и rehearsal. Для старого rollback artifact допускается только внешняя policy, привязанная к полному RELEASE SHA, с `compatibleMigrations: [{name: "006_bug_report_delivery.sql", checksum: "<REVIEWED_SHA256>"}]` и явным maxSchema=6 (`maximumSchema` в JSON). Инспектор проверяет последовательность, SHA-256 каждого дополнения и совпадение с фактической/candidate schema; wildcard и неявные будущие миграции запрещены. Артефакт не изменяется. Нужны grants runtime/backup на новую таблицу до нового startup, но новых привилегий superuser/CREATE нет. После app rollback к старой версии новые pending deliveries сохраняются в PostgreSQL и ждут совместимого кода; автоматического DB rollback нет. Реальный переход в этом чате не выполнялся.

## Дополнение Stage 4D / migration 007 и статистика

007 additive: state начала учёта, агрегаты, краткие user/day dedup и журнал ежедневных писем. Candidate schema 7–7. На старом rollback SHA требуется отдельная проверенная external compatibility attestation для всех отсутствующих migrations (006 и 007, если старый artifact знает только 005), с точными SHA-256 и maximumSchema=7; одного изменения числа недостаточно. Runtime/backup grants дополнены в authGrants. Не менять checksums уже опубликованных migrations и не выполнять автоматический PostgreSQL rollback.

После разрешения общего release: согласованные STATISTICS_ENABLED/STATISTICS_EMAIL_TO в существующей защищённой конфигурации, проверка момента начала учёта, review env-file paths в oneshot unit, установка/enable подготовленных existing-systemd timer units. 10:00 МСК + bounded retry slots 10:05/10:10; реальные Postbox delivery и systemd runtime проверяются тогда. Сейчас units не установлены, production не менялся. [Контракт и диагностика](stage-4d-statistics-local.md).

Если rollback binary не учитывает статистику либо восстанавливается старый backup, statistical timers держать остановленными; до возобновления явно зафиксировать неполноту периода и проверить delivery states, не переотправлять unknown вслепую. Это не изменяет существующий app rollback и не разрешает DB restore.
