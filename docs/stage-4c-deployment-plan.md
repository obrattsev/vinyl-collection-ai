# Stage 4C — production preparation, 14.10.2026

Статус: **CONDITIONAL GO; только подготовка, rollout не разрешён**. Full scope, включая самостоятельное удаление. Никакого обязательного S3 ledger. Разработка завершена; этот документ не вводит новую архитектуру.

## Проверено чтением

Production release `2ccb47b50cb3903d1542a273a84d963d4d98cc36`; app active, NRestarts=0. Node 24.19.0, PostgreSQL 16.15, nginx/HTTPS существующие. Runtime user `vinyl`, Covers write path `/var/lib/vinyl-collection-ai/covers`, MemoryMax 512 MiB. Свободно 22 ГБ; available RAM около 1506 MiB, swap 1023 MiB, использовано 0. Это snapshot, не нагрузочная гарантия.

В БД 1 пользователь, Collection=29, Wish-list=12, Favorites=6, Covers metadata=37, mirror rows=1. Owner email заполнен, обе публичности true; mirror synced, last_error отсутствует, frozen=false. User-auth пока отсутствует. Миграции 001–002 совпадают с локальными по SHA-256. Нового owner создавать нельзя: сохранить существующий PG_OWNER_ID и существующую запись users.

Последний backup service: success/exit=0, 14.10.2026 03:23:41 UTC. Последний manifest — `/var/backups/vinyl-postgresql/20261014T032341Z/manifest.json`, содержит canonical.json, covers.tar, database.dump. Это подтверждение успешного задания и наличия manifest, **не повторная checksum/restore проверка**. Перед миграциями нужен новый backup. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён.

## Конфигурация

| Параметр | Сейчас / подготовка после разрешения |
|---|---|
| NODE_ENV | production, сохранить |
| DATA_BACKEND / PG_PRODUCTION_ACK | postgres / stage4b, сохранить |
| DATABASE_URL / PG_OWNER_ID | присутствуют; сохранить runtime роль и существующий UUID |
| APP_ORIGIN | https://vinyl-collection.ru, сохранить |
| AUTH_MODE | отсутствует → multiuser |
| AUTH_SECRET | отсутствует → сгенерировать 32 криптографически случайных байта, 64 hex; один стабильный secret между перезапусками |
| EMAIL_ADAPTER | отсутствует → smtp |
| POSTBOX_KEY_ID / POSTBOX_KEY_SECRET | отсутствуют на VPS; локальная проверенная конфигурация доступна, файл 0600; переносить защищённо, без печати значений |
| AUTH_REGISTRATION_ENABLED | сначала false, после owner activation true |
| AUTH_LEGACY_ENABLED | только закрытая owner activation: true; затем false |
| OWNER_PASSWORD_HASH | присутствует; нужен для существующего bootstrap, не менять/не публиковать |
| COVERS_DIR / mirror / Google / Bug Reports | сохранить существующие настройки |

SMTP в коде: postbox.cloud.yandex.net:465, TLS с проверкой сертификата, From no-reply@vinyl-collection.ru. Production не использует POSTBOX_TEST_EMAIL allowlist; способность отправлять новым получателям должна пройти проверку provider-ограничений и smoke. Новые ключи не нужны, если существующие имеют необходимые права; не расширять их автоматически. Сейчас SMTP probe с VPS не выполнялся.

Cookies задаются кодом: production `__Host-vinyl_auth`, flow/pre cookies; Secure, HttpOnly, SameSite=Lax, Path=/, без Domain. APP_ORIGIN/Host/Origin должны совпадать; нельзя использовать HTTP или development env для bootstrap. Проверить существующий nginx proxy Host и forwarding при rollout; DNS не требуется менять.

Можно автоматически подготовить после разрешения: secret, root-only staged env/backup конфигурации, SQL grants из существующего authGrants, release artifact. Нельзя подставлять dev DATABASE_URL, fixture owner, mail capture, локальные Covers. Env-файлы не source-ить как недоверенный shell; использовать существующий безопасный loader. Секреты не передавать через argv/логи/Git.

## Миграции 003–005

003 создаёт auth tables/indexes; не заменяет users. 004 добавляет show_sale_price=false, nullable sale_price и durable cover_cleanup/trigger. 005 создаёт restore epoch/quarantine/grants и расширяет допустимый auth flow kind. Нет DELETE/UPDATE бизнес-строк, UUID и Cover storage keys сохраняются. Новые nullable/default поля не должны менять semantic hashes прежних полей.

Migrator проверяет sequence/checksums и берёт advisory lock. **Каждая миграция транзакционна отдельно**, весь пакет не является одной общей транзакцией. При ошибке сохранить maintenance, выяснить фактический последний applied номер; не запускать случайный rollback DDL и не менять checksums.

Выполнять privileged migration connection, не повышать runtime до superuser/owner. Применить существующий authGrants(runtimeRole,backupRole), сверив реальные имена ролей. Проверить SELECT новых таблиц backup-ролью и права runtime без CREATE/schema ownership. Перепроверить 001–005 и counts/UUID/revisions/Favorites/Cover references/mirror state после миграций.

## Пошаговый rollout после отдельного разрешения

1. **Release artifact.** Отдельно разрешить Git finalization и deployment; зафиксировать SHA, набор файлов, lockfile, отсутствие env/fixtures/runtime artifacts. Ничего не выкатывать из незакреплённой рабочей копии.
2. **Свежий preflight.** Повторить services/resources, PG/migration checks, mirror clean, отсутствие активных mutations, SMTP readiness и наличие доступа владельца к существующему email. Если owner email недоступен — STOP, без дубликата аккаунта.
3. **Maintenance.** Ограничить внешний ingress на окно работ, оставить согласованный доступ оператора/владельца. Приостановить backup timer на окно, дождаться/проверить завершение текущего задания, остановить mirror, freeze/drain writes. Сохранить текущий release/config/таймеры для возврата. Это первое изменение production, до него требуется разрешение.
4. **Свежий backup.** Существующим механизмом создать новый PG dump + Covers archive + canonical/manifest/checksums + защищённую копию config/release metadata. Ничего не перезаписывать. Проверить SHA-256, pg_restore --list, archive listing и права. Копия env должна оставаться 0600.
5. **Пригодность backup.** На уже существующей изолированной локальной test DB (после проверки marker и согласования замены только её синтетического содержимого) восстановить доверенную копию, проверить owner UUID, оба списка, Favorites, Covers hashes и migration rehearsal 003–005. Закрытый стенд, без real SMTP/mirror; реальные backup credentials не печатать. Новую cloud DB не создавать. Если фактическая rehearsal невозможна — STOP перед production migrations. `pg_restore --list` сам по себе недостаточен.
6. **Миграции и grants.** Остановить app, применить 003–005 и нужные grants. Проверить сохранность baseline, старые миграции/checksums. Не выполнять quarantine на живой production базе при обычном upgrade: это только процедура аварийного restore.
7. **Конфигурация и release.** Установить закреплённый artifact с Linux dependencies, сохранить runtime/systemd paths, подготовить root-only env. Bootstrap flags: multiuser, registration=false, legacy=true. Проверить startup guards, SMTP TLS/auth, отсутствие секретов в ошибках; переключить current и запустить в закрытом окне. Оценить RSS/OOM/latency на действующем лимите 512 MiB; не ослаблять KDF и systemd автоматически.
8. **Owner activation.** Владелец открывает HTTPS `/auth?mode=legacy-owner`, вводит прежний пароль сам, проходит существующий owner activation через новый OTP на сохранённый email, задаёт новый пароль. Код использует существующий UUID и создаёт user_auth, а не второй users row. Пароль/OTP не просить в чате. Проверить owner UUID/users=1 и неизменность коллекции, favorites, covers, public=true/true.
9. **Финальные flags.** legacy=false, registration=true; restart. Проверить новый owner login и невозможность legacy login. Новый парольный вход выполняет владелец; cookies не копировать в отчёт.
10. **Controlled smoke.** В ограниченном ingress снять freeze для согласованных тестовых writes, выполнить матрицу ниже на отдельном disposable аккаунте и контролируемом mailbox. Не использовать owner для удаления/изменения пароля ради теста. При любом нарушении privacy/integrity закрыть ingress и остановить writers.
11. **Открытие.** Проверить отсутствие fixture rows/cleanup pending тестового аккаунта, owner baseline, mirror sync, ошибки приложения. Вернуть mirror и backup timer в прежнее состояние; снять оставшиеся ограничения только после smoke. Зафиксировать RELEASE/config metadata и результат. Существующую backup retention не менять.

## Smoke matrix

- `/`: новая landing, ссылки напрямую на auth/registration; активная сессия → собственная Collection.
- Disposable registration: новый email OTP доставлен, новый пользователь private по умолчанию, отсутствует доступ к owner private/foreign resources.
- Login/logout/relogin, cabinet, оба персональных раздела; восстановление пароля новым OTP, прежний пароль/сессия отвергаются; смена пароля — на disposable аккаунте.
- Публичность и sale price: включение/выключение на disposable данных; guest API/Covers/CSV соответствуют privacy; origin/CSRF запрещают посторонние mutations.
- Добавить минимальные synthetic Collection/Wish-list/Favorite/Cover; проверить привязку к fixture UUID. Удалить disposable аккаунт штатно с паролем; проверить User/auth/sessions/records/Covers references отсутствуют, reservation есть, filesystem очищен либо явно обработан cleanupPending. Повторный запрос не удаляет другие данные.
- Owner: только read-only сравнение существующего UUID, 29/12/6/37 и semantic hashes baseline, подтверждение собственных страниц и Cover reads. Значения counts переснять непосредственно перед выпуском — текущие не вечный эталон.
- Mirror: configured owner/state прежние, generation сверена, Google read-back успешен; fixture пользователя туда не выгружать. Existing mirror может выполнять writes, поэтому запуск входит в разрешение rollout.
- Backup role читает новые auth/restore/cleanup tables; timer восстановлен. TLS, cookie flags, public HTTP status, отсутствие stack traces/секретов, RSS/restarts — проверены.

## Rollback и STOP

STOP при checksum mismatch, плохом backup, потере baseline, неполной migration/grants, SMTP/owner activation failure, нарушении privacy, OOM, невозможности завершить smoke. Оставить maintenance, не открывать половинчатую конфигурацию.

До 4C пользовательских writes: определить применённые migrations и совместимость старого binary; нельзя считать переключение current универсальным откатом. Не удалять schema ради автоматического восстановления. После 4C writes предпочтителен предыдущий совместимый 4C release/исправление под maintenance; Stage 4B не знает multi-user privacy. DB restore — отдельное аварийное решение, не автоматическая часть smoke: закрытый ingress, актуальный код/migrations, quarantine/recovery, private defaults и блокировка mirror до recovery. Старые backup способны вернуть удалённые аккаунты — принятый владельцем риск сохраняется.

## Решение

**Подготовка завершена, CONDITIONAL GO сохраняется.** Нужны разрешение на Git/release и production maintenance, доступ владельца к email для bootstrap и контролируемый test mailbox. На текущем шаге нет новых изменений приложения, production, DNS, backups или пользовательских данных; новые ресурсы/ключи не созданы. Полные suites 433/433 и 87/87 не повторялись без изменения кода; результаты относятся к принятому RC.


14.10.2026: владелец разрешил Git finalization и controlled production rollout по этому плану, включая backup/rehearsal, migrations/grants, env, owner activation и disposable smoke. STOP conditions сохраняются; итог rollout фиксируется отдельно.
