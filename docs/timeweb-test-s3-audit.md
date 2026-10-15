# Тестовые ресурсы Timeweb — read-only аудит 15.10.2026

**Заключение: SAFE TO DELETE** для обоих ресурсов:

- S3 bucket `vinyl-ledger-test-20261013`.
- S3 user `vinyl-ledger-test-runtime`.

В действующих компонентах Vinyl Collection зависимостей не найдено. Удаление именно этих S3 bucket/user не затронет работающий сайт, PostgreSQL/Covers backup, Google Sheets mirror и действующую систему резервного копирования. Удаление в этом чате не выполнялось; оно не входит в разрешение на read-only аудит.

## Основания

SSH read-only snapshot: current/RELEASE — `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`. App и mirror active/running, backup timer active/waiting; одноразовый backup service inactive между заданиями — нормальное состояние. Production после документационного merge не разворачивался.

Проверены фактические unit files/ExecStart/WorkingDirectory/EnvironmentFiles и inline environment; имена связанных ключей в окружении работающих app/mirror; файлы конфигурации app.env, owner-auth.env, mirror.env, pg-backup.env; current/server и current/scripts; служебные scripts в /usr/local/lib и bin/sbin; project-related systemd/cron/default configuration. Основной проход прочитал 79 текстовых файлов, затем отдельно прослежены unit paths и относительные scripts.

- Ни одного точного упоминания bucket/user в проверенных активных источниках нет.
- S3/AWS/BUCKET/LEDGER/OBJECT storage env keys в app/mirror/backup конфигурации отсутствуют. Inline systemd env таких зависимостей не добавляет.
- App использует PostgreSQL и filesystem Covers; active server/index не подключает S3 adapter. Postbox credentials — почтовые, не S3.
- Mirror unit работает из current и запускает scripts/pg-mirror.mjs, использующий PG→Google Sheets. Его активный script и env не используют S3.
- Backup unit работает из current и запускает scripts/pg-daily-backup.mjs; существующий backup.mjs выполняет pg_dump + локальный tar Covers и checksum manifest. S3/rclone/restic transfer не подключён. Backup retention/timer не изменялись.
- Health script не зависит от S3. Project timers/services и cron references не содержат указанных ресурсов.
- Остаточный optional deletion-ledger interface в коде не создаёт работающего S3 клиента и не подключён production startup. Слова bucket в auth относятся к лимитам, не к Object Storage. Случайная подстрока s3 внутри закрытого Google service-account key не является storage dependency; значение ключа не выводилось.

Действующий Timeweb daily VPS disk backup — отдельный механизм, не эти тестовые S3 bucket/user. Аудит относится к активным компонентам данного проекта на момент проверки, а не к произвольным посторонним проектам Timeweb-аккаунта. Cloud resources, DNS, systemd, scripts, env, backups и пользовательские данные не изменялись. Секреты в результаты не включены.
