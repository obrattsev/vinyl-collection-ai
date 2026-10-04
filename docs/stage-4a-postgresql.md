# Stage 4A — PostgreSQL Data Foundation

Статус: 4A реализован, local visual acceptance успешно выполнена и принята владельцем. Функциональный scope закрыт; commit/push/PR/merge разрешены без production deployment. Production остаётся на Sheets; Stage 4B не начат.

## Границы и схема

Data layer использует `pg@8.23.1`, без ORM. Одна migration `migrations/001_data_foundation.sql`; runner дополнительно создаёт `vinyl.schema_migrations`.

| Таблица | Поля и назначение |
| --- | --- |
| `users` | UUID PK; login/normalized login; email/normalized email; full_name; collection_public/wishlist_public default false; created_at/updated_at |
| `login_reservations` | normalized login PK, reserved_at; reservation создаётся вместе с User и сохраняется после его удаления |
| `collection_records` | UUID PK, user_id FK; все 15 текущих Collection fields; revision, version, position, timestamps |
| `wishlist_records` | UUID PK, user_id FK; все 12 текущих Wishlist fields; revision, version, position, timestamps |
| `covers` | UUID PK, user_id FK, storage_key UNIQUE (= UUID), created_at; UNIQUE(user_id,id) |
| `data_imports` | import_key PK, manifest_hash, user_id UNIQUE FK, report JSONB, completed_at |
| `schema_migrations` | name PK, checksum, applied_at |

Общие record fields: id, artist, album, genre, additionalGenre, label, albumYear, recordYear, editionType, note. Collection дополнительно: purchaseDate, purchaseStore, purchasePrice, coverId, favorite. Wishlist дополнительно: storeUrl, coverId. SQL использует snake_case; DTO возвращает прежние camelCase и точный прежний набор ключей. Favorite — boolean Collection, отдельной таблицы нет. Auth tables/пароли в foundation User не добавлены: 4C добавит их additive migration.

Годы — четырёхзначный text; purchaseDate — ISO text с проверкой календаря существующим JS validator. Это сохраняет допустимый в текущем коде год `0000`, который PostgreSQL date напрямую не представляет. Цена — конечный неотрицательный numeric без округления, наружу прежний JSON number. Необязательные значения остаются null; 0 и false не теряются. UUID сохраняют идентичность, текст канонизируется в lowercase; importer сообщает количество изменённых по регистру ID. Version/revision/position/timestamps не добавляются в API/CSV.

`position` нужен для конкретного текущего поведения: stable sort в `prototype/record-presentation.mjs` сохраняет source order при одинаковых Artist и Album Year. Импорт идёт в исходном порядке, новые строки дописываются. Сам default sort остаётся JS `Artist ASC → Year ASC` с прежним `Intl.Collator('ru', {sensitivity:'accent'})`; поля ordering в UI не добавлены.

DB constraints: unique normalized login/email (без citext), обязательный user_id, UUID PK, допустимые годы/edition/price, composite FK `(user_id,cover_id)` к Cover того же владельца. JS validators сохраняют точную семантику whitespace, genres, URL и даты; SQL не пытается заменить их другой locale/нормализацией. Public user lookup в будущем использует unique login index. Индексы owner/position обслуживают загрузку в стабильном порядке; owner/cover — проверку ссылок и orphan inspection. Search/sort/favorite filter пока application-side; индексы всех metadata не нужны.

## Ownership и транзакции

Repository создаётся с обязательным userId: отсутствует unscoped get/update/delete. userId поступает из server context, не из payload. Выбор SQL таблиц/колонок ограничен внутренними constants, values параметризованы. Read DTO собирается по allowlist, без `SELECT * → client`.

Write service берёт connection, начинает transaction и блокирует User row. Это сериализует duplicate checks и запись одного пользователя, включая проверки Wishlist против Collection; разные owners независимы. Shared validators/checkAddition/isPotentialDuplicate используются без изменения правил. Импорт сохраняет существующие данные и не выдумывает новый unique artist/album constraint.

UPDATE/DELETE атомарно ограничены `user_id + id + revision`; UPDATE выполняет `version=version+1`. SHA-256 If-Match остаётся прежним hash полного record snapshot. Он не становится numeric counter; возврат к точно прежним полям может вернуть прежний digest, как и в Stage 3. metadata Edit сохраняет cover/favorite. Чужой UUID даёт 404 без чужой записи в conflict details. После неудачного rollback соединение уничтожается, а не возвращается в pool.

Transfer — одна transaction для создания Collection и удаления Wishlist; выбранная существующая target тоже проверяется в owner scope и по revision. Новый Collection UUID создаётся как в Stage 3, Wishlist UUID не переиспользуется. Metadata/cover сохраняются, favorite нового record false. При ошибке второго шага insert откатывается; PG не возвращает Sheets-specific partial success. Успешный response остаётся `status:complete`.

Автоматических retries mutating requests нет. Durable request receipts для HTTP create/transfer пока нет: после потерянного COMMIT/HTTP ответа результат следует сверить чтением. Import idempotency реализована отдельно. До 4B необходимо закрепить обработку неизвестного результата и retry policy; атомарность transaction не равна exactly-once доставке ответа.

## Covers boundary

Binary остаётся filesystem WebP. Composite FK запрещает чужую ссылку; Cover UUID сохраняется. Удаление/отвязка record не удаляет Cover metadata. `coverRepository.unreferenced()` возвращает UUID/storage key для будущего cleanup. FK Cover → User RESTRICT не позволяет cascade потерять пути до подготовки удаления файлов; records → User CASCADE, favorite исчезает вместе с record.

В 4A orphan metadata намеренно сохраняются до reconciliation, но не объявляются бессрочным storage policy. Подготовка файла предшествует DB link; failed transaction может оставить filesystem orphan. Полный безопасный cleanup/GC и account deletion — 4B/4D; фоновые jobs сейчас не добавлены. Production media authorization — 4B. Local HTTP bridge предназначен только для одного явно public fixture owner; публичный media handler Stage 3 пока не является multi-user security boundary.

## Migrations и import foundation

`npm run pg:migrate` требует development/test, явный local DATABASE_URL. Runner принимает последовательные numbered SQL files, проверяет SHA-256 уже применённых файлов и берёт session advisory lock. Каждая migration и successful marker находятся в одной transaction. Failure не фиксируется successful; повтор безопасен; пропуск номера, изменённый checksum или неизвестная history останавливают runner. Down/reset не реализован.

`npm run pg:import -- snapshot.json --dry-run` валидирует без записи. `--apply` импортирует в одной transaction и проверяет перечитанные DTO. Snapshot требует importKey, User с заданным UUID, covers inventory и ровно одно представление каждого списка: canonical `collection`/`wishlist` либо raw Sheets `collectionValues`/`wishlistValues`. Используются существующие Sheets mappers; importer не подключается к Google.

`data_imports` хранит стабильный key и manifest hash. Advisory transaction lock исключает одновременный двойной импорт. Повтор идентичного manifest — no-op, а не восстановление уже изменённых живых данных. Изменённый manifest/UUID conflict — ошибка с rollback, без blind upsert. Verification report: counts, favorites, cover count, record hash, canonicalized ID count. Реальные snapshots/files не импортировались. Проверка физических файлов/checksums/holds и production manifest — 4B.

## Backend/config

`DATA_BACKEND=sheets` — default. Только явное `postgres` при `NODE_ENV=development|test` включает PG. Production + PG отклоняется до соединения. Никакого fallback или dual-write. `DATABASE_URL` разрешает только явный 127.0.0.1:port и имена `vinyl_4a_test_*`/`vinyl_4a_acceptance_*`, без query overrides. `PG_LOCAL_OWNER_ID` — UUID fixture owner. Pool max=5, connection/statement/lock/idle transaction timeouts заданы явно.

Current owner auth используется как local bridge: все services привязаны к одному fixture User с обоими public flags. `server/index.mjs` отказывается запускать bridge с private owner, чтобы нынешняя guest projection не раскрыла private data. 4B изменит runtime ownership/media boundary, 4C заменит bridge на session user. `.env` с production credentials не загружается test/acceptance scripts.

Bug Reports остаётся отдельным Sheets adapter у обычного runtime. В специально подготовленном acceptance stand reports — память, без Google writes; Streaming — прежний реальный read-only Apple lookup. UI/src business validators, CSV и auth не перепроектированы.

## Воспроизводимый local workflow

Нужен Node 24 и user-local PostgreSQL 16. Runtime/cluster/credentials хранятся вне Git. Cluster слушает только 127.0.0.1; no system service/autostart. Для текущего стенда корень `/Users/obrattsev/vinyl-collection-config/stage4a-local`.

`scripts/pg-create-local-db.mjs` создаёт только новую БД с random suffix. Требует NODE_ENV development/test, явный PG_LOCAL_ADMIN_URL к loopback `postgres`, роль `vinyl_4a_admin` и comment database `vinyl-4a-local-cluster`. Создаёт environment file с mode 0600 и `wx`, не перезаписывает существующий. Reset/drop отсутствуют.

После установки runtime: initdb в новый каталог с SCRAM host auth и случайным локальным паролем; pg_ctl запускает loopback cluster; оператор отмечает его postgres database указанным comment. PG_LOCAL_ADMIN_URL хранится в приватном admin.env вне Git. Затем из корня repository:

```sh
node --env-file=/absolute/private/admin.env scripts/pg-create-local-db.mjs test /absolute/private/test.env
node --env-file=/absolute/private/test.env --test tests/*.test.mjs tests/postgres/*.test.mjs
node --env-file=/absolute/private/admin.env scripts/pg-create-local-db.mjs acceptance /absolute/private/acceptance.env
node --env-file=/absolute/private/acceptance.env scripts/pg-acceptance.mjs
```

PG tests до migrations требуют NODE_ENV=test, test-prefixed database, database owner=current user и secret token в database comment. Acceptance DB не допускается. Tests не делают reset/drop database; failure injection DDL применяется только внутри проверенной fixture database. Обычный `npm test` сохраняет 386 regression tests; `npm run test:pg` требует явного test environment и не пропускает тесты молча без PostgreSQL.

`PG_ACCEPTANCE_ROOT` задаёт существующий абсолютный каталог для сохраняемых fixture Covers/sample/restart.env; по умолчанию используется temporary directory. `PG_ACCEPTANCE_PORT` по умолчанию 8044. Initial acceptance script требует новую пустую marked acceptance DB и никогда не пересеивает непустую. Для повторного запуска с сохранёнными изменениями: `node --env-file=/absolute/fixture/restart.env server/index.mjs`; в таком запуске reports без отдельной конфигурации недоступен, а данные/cover files сохраняются.

## Local visual acceptance

Открыть `http://127.0.0.1:8044/collection`, затем `/wishlist`. Пароль только этого локального fixture стенда: `local-pg-only-password-4A`.

1. Guest: «Показать…», search/sort, Favorite filter, Covers, Streaming, CSV; нет private purchase fields/store link и owner actions.
2. Войти, добавить/изменить/удалить тестовую запись; проверить preview/confirmation, dates, price, metadata.
3. Favorite; Add/Replace/Delete Cover с sample.png; metadata Edit сохраняет cover/favorite.
4. Transfer `Wish Alpha / Transfer me`: запись появляется в Collection и исчезает из Wishlist.
5. Desktop table/scrollbar, mobile cards/detail, CSV не зависит от viewport, Daily Quote и logout.
6. Reload сохраняет PG данные; в отдельном окне проверить stale edit конфликт. По завершении сообщить acceptance или список замечаний.

Тестовые записи вымышленные; никаких production writes. Local visual acceptance успешно выполнена владельцем. Разрешена Git-финализация; production deployment запрещён.

## Проверка и текущий стенд — 03.10.2026

Полный regression + real PostgreSQL integration run: **416 passed, 0 failed, 0 skipped** (386 прежних + 30 PG). `npm audit`: **0 vulnerabilities**. `git diff --check` пройден. Stage 3 `prototype/`, `src/`, HTTP app и auth не изменены. Self-review охватил owner scoping, SQL parameters/DTO projection, composite cover FK, rollback/connection disposal, duplicate locking, revisions, Transfer, migration checksums и import repeat protection. Ограничения cleanup/media, auth bridge и uncertain commit явно оставлены выше для 4B+.

HTTP smoke: Collection/Wishlist pages и API — 200. Обычный `server/index.mjs` отдельно запущен на 8045 с сохранённым restart.env; Collection response совпал со стендом, после проверки дополнительный процесс остановлен. Визуальная browser-проверка не выполнена: предыдущую попытку отклонил automatic approval review из-за usage limit. Позднее владелец самостоятельно выполнил local visual acceptance и принял результат.

Текущий stand: `http://127.0.0.1:8044/collection`. Fixture directory: `/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4a-acceptance-Zyq9fz`; здесь `sample.png`, Covers и private `restart.env`. Credentials не входят в Git. Test/audit evidence: `final-tests.log` и `final-audit.json` в корне `stage4a-local`.

Если процесс остановился, из `/Users/obrattsev/vinyl-collection-ai`:

```sh
/Users/obrattsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4a-acceptance-Zyq9fz/restart.env server/index.mjs
```

Если остановлен сам PostgreSQL cluster, сначала запустить его (не повторять initdb):

```sh
/Users/obrattsev/vinyl-collection-config/stage4a-local/runtime/bin/pg_ctl -D /Users/obrattsev/vinyl-collection-config/stage4a-local/data -l /Users/obrattsev/vinyl-collection-config/stage4a-local/postgres.log start
```

Ручная остановка cluster после остановки приложения: тот же `pg_ctl -D .../data stop -m fast`. System service/autostart не создавались. Stage 3 закрыт; 4A принят по local acceptance; 4B–4F и Stage 5 не начаты.

## Последующее развитие 4B

Исторические ограничения 4A выше описывают принятую версию этапа. В локальной 4B реализации подготовлены explicit production config, media boundary и owner mirror; production ещё не переключён. [Текущий contract](stage-4b-local.md).
