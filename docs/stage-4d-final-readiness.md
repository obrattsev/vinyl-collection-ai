# Stage 4D — готовность к публикации

**LOCAL DONE / VISUAL ACCEPTED / PRODUCTION PENDING.** Владелец принял визуальную приёмку, включая пакет №1, и разрешил отдельную ветку, commits, push и PR. Merge, deployment, production mutations и реальные письма требуют следующего разрешения.

## Проверки кандидата

- Regression: **500/500**.
- PostgreSQL integration: **111/111**, изолированная marked test DB.
- npm audit: **0 vulnerabilities** во всех категориях.
- Chrome: обе роли × оба раздела × desktop/mobile; дополнительные 320px и границы 1120/1121px — PASS. Визуальная приёмка владельцем завершена.
- Проверены релизные gates/rollback, durable Bug Reports/SMTP failures/unknown/retries, формы/обложки, жанры/изоляция, интерфейс и защита удаления владельца, ежедневная статистика.
- Publication scan: нет известных тестовых паролей стенда, реальных конфигурационных секретов, private keys/tokens, пользовательских локальных путей, конфликтных маркеров или бинарных/private artifacts. В публикацию входят только код, migrations, tests, example config, systemd templates и документация. Синтетические литералы unit-тестов и placeholders конфигурации не являются учётными данными стенда.
- Ранее выполненные изменения сохранены. `.env`, локальная БД, стенд, скриншоты, dump, capture-письма и рабочие логи не включаются в commit.

## Read-only production audit — 15.10.2026, около 13:55 UTC / 16:55 МСК

| Объект | Результат |
|---|---|
| Current / RELEASE | `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`, совпадают |
| Runtime | Node `v24.19.0`, PostgreSQL 16 |
| Schema | 001–005; history checksums совпадают с файлами production и кандидата; 006/007 ещё отсутствуют |
| Maintenance | `frozen=false` |
| App / mirror | active/running, enabled, Result=success |
| Backup / health timers | active/waiting, enabled; последний backup service Result=success |
| Mirror | generation=11, synced_generation=11, last_error=null; worker health OK |
| Последний backup | `20261015T054808Z`, завершён `2026-10-15T05:48:08.893Z` |
| Целостность backup | SHA-256 и размеры database.dump, covers.tar, canonical.json совпали с manifest |
| Covers в backup | все 74 файла совпали с manifest; tar не содержит links/special/unsafe paths |
| Dump inventory | pg_restore --list успешен; users, user_auth, auth_sessions, оба списка, mirror и migrations присутствуют |
| Restore | существующая guard/rehearsal утилита доступна; текущий backup фактически не восстанавливался в рамках read-only проверки |
| Ресурсы | около 22 ГБ свободного диска, около 1,5 ГБ доступной RAM; PG database около 9,1 MB |
| Конфигурация | root-owned 0600, postgres/multiuser, ожидаемый APP_ORIGIN, persistent Covers; секреты не выводились |
| Postbox | существующий SMTP adapter, credentials присутствуют; TLS/auth verify успешен, sendMail не вызывался |
| Новые получатели | ещё не настроены в production; установить отдельно BUG_REPORT_EMAIL_TO и STATISTICS_EMAIL_TO = `obratsev@yandex.ru` при выпуске |
| Statistics timers | ещё не установлены; выражения 10:00 / 10:05 / 10:10 Europe/Moscow приняты действующим systemd |

Сбор данных выполнялся через SSH без сохранения скриптов на сервере. SQL выполнялся в явной READ ONLY transaction; backup читался без извлечения, восстановления и изменения. Не выполнялись freeze, migrations, grants, env edits, restart/reload, установка units, отправки email или операции с Timeweb S3. Provider timestamp ежедневного Timeweb backup независимо не подтверждён.

## Миграции

| Файл | Назначение | SHA-256 |
|---|---|---|
| 006_bug_report_delivery.sql | durable приём и идемпотентность Bug Reports, состояния доставки | `6696128911e503dec1917d67be295815a345768ffd3d9654a9a503aea0d1a142` |
| 007_service_statistics.sql | начало учёта, daily aggregates/dedup, журнал ежедневных email | `0c973dd2632167b6e25cb62bcb435625c452a1746af90ab240f451f3d8f79409` |

Обе миграции additive, без backfill, удаления или переименования существующих таблиц. 001–005 не изменены. Нужны explicit runtime/backup grants до нового startup. Новый код требует schema 7–7; migrations и grants выполняются **до current switch**. Локально проверены переход 5→7, synthetic backup/restore, старый `f593b3f` на schema 7 и сохранение сессии/данных/Covers/mirror.

## Решение

**GO для публикации PR и согласования выпуска. NO-GO для немедленного production deployment.** Блокирующих дефектов кандидата не выявлено, но обязательные gates live-выпуска ещё не выполнены: нет разрешения merge/deployment, exact merged artifact ещё не определён; свежий согласованный backup должен пройти actual restore в изолированную marked test DB, а exact artifact/rollback — before gate. Наличие и проверка хешей backup не заменяют восстановление.

Эти gates не выполнялись под read-only разрешением. После отдельного разрешения они идут строго перед DDL/current switch. Реальная доставка Bug Reports и первого daily report — отдельная часть smoke/приёмки по [плану](stage-4d-production-plan.md).

До release не менять AUTH_SECRET, cookie settings, APP_ORIGIN, owner ID, session/auth versions, persistent PG/Covers/mirror paths. Обычный rollback возвращает приложение и прежний feature config, оставляет schema 6/7 и данные; автоматический PostgreSQL rollback/restore запрещён.
