# Stage 4C — local implementation

> Актуализация 12.10.2026: функциональность и UI Stage 4C приняты владельцем. Разрешена локальная Postbox-проверка на ранее согласованный адрес; прежний запрет реальных локальных отправок заменён этим разрешением. SMTP TLS/auth проверены; владелец подтвердил реальную доставку, регистрацию и recovery с отзывом прежней сессии. Production readiness gates остаются в отчёте. Stage 4C открыт; Git finalization и deployment запрещены. [Текущий отчёт и checkpoint](stage-4c-release-readiness.md).

Статус: базовые auth/session/изоляция приняты владельцем; личный кабинет, canonical URL, цена продажи и реальная доставка Postbox ещё требуют acceptance. Stage 4C не закрыт. Ветка `feature/stage-4c-auth`. Commit/push/PR/merge/deploy не разрешены до следующего checkpoint. Production остаётся Stage 4B; Yandex/DNS/реальные письма не изменялись.

## Принятые границы

Registration реализована для локальных fixtures. По отдельному запросу владельца 12.10.2026 личный кабинет, общая публичность, цена продажи, смена пароля и удаление включены в локальный scope 4C. Остальной 4D polish не начат. Production registration остаётся disabled до общей acceptance и отдельного rollout-разрешения. Production registration допускается только с полной безопасной конфигурацией; актуальные release gates — в docs/stage-4c-release-readiness.md. Порядок: 4C → 4D account/lifecycle → 4D UX/Data polish → 4E public pages → 4F SEO/hardening → Stage 5 AI.

Provider выбран: Yandex Cloud Postbox, SMTP через Nodemailer. Сейчас только capture adapter; production запрещает capture. В текущей задаче реальные отправки запрещены; Cloud/DNS/credentials отдельно настраивает владелец. Production по-прежнему не изменять.

## Runtime и ownership

`AUTH_MODE` по умолчанию `legacy`; `multiuser` требует PostgreSQL и отдельный 32-byte hex `AUTH_SECRET` вне Git. `AUTH_LEGACY_ENABLED=true` сохраняет старый вход для bootstrap. Legacy и новая сессия используют разные cookies; неоднозначное предъявление двух действительных identities отклоняется. Нет fallback к legacy при недоступной БД.

User UUID берётся из проверенной PG session. На каждый HTTP request создаются scoped services; body/query не выбирает owner. Перед business mutation session повторно проверяется под user row lock внутри транзакции. Это закрывает race с password reset. Guest читает только разрешённый раздел пользователя, выбранного по login в URL. Public media прежнего owner доступно также другому вошедшему пользователю, но private media других users недоступно. Новые accounts имеют оба visibility=false.

Mirror остаётся строго привязан к existing owner UUID. Registration/login/reset/change-password не меняют business_writes/mirror generation. Settings и deletion используют существующий owner transaction/freeze barrier; generation меняется только для соответствующего UUID. Sheets сохраняют прежние колонки: salePrice исключён из mirror snapshot, но включён в полный PG backup. Основные DTO/revisions/Transfer/Stage 3 UI сохранены; salePrice — необязательное дополнение.

## Schema

Stage 4C добавляет **003_auth_foundation.sql** и **004_account_lifecycle.sql**; 001/002 неизменны. Всего **4 migrations**.

- user_auth: user PK/FK, active/disabled status, versioned password hash, email_verified_at, auth_version, password_changed_at.
- auth_sessions: token digest PK, user FK, auth_version, created/last_seen/expires/revoked timestamps.
- auth_flows: token digest UNIQUE, registration/reset/owner kind, pending/verified/completed/cancelled state, временные registration fields или существующий user FK, eligibility, subject HMAC, auth_version, expiry/grant/consumption timestamps.
- auth_challenges: flow FK, purpose, HMAC/key version, attempts <=5, expiry/consumed/superseded, pending/accepted/failed/unknown delivery state. Partial UNIQUE обеспечивает один current challenge на subject/purpose.
- auth_rate_limits: scope + subject HMAC + fixed window PK, bounded counter, expiry.

- users.show_sale_price: boolean NOT NULL DEFAULT false. Общий checkbox атомарно обновляет существующие collection_public и wishlist_public. Новые аккаунты private.
- collection_records.sale_price / wishlist_records.sale_price: nullable numeric, finite >=0; JSON number, ноль сохраняется, null очищает, отсутствие при update сохраняет прежнее значение.
- cover_cleanup: cover UUID PK, user UUID без FK, storage_key=UUID, created_at. Сохраняет сведения после удаления пользователя до удаления файлов. Trigger запрещает повторное использование ожидающего cleanup UUID.

Users/login_reservations сохраняют существующую семантику. До password completion User и reservation не создаются; completion создаёт обе записи и credentials атомарно. Login collision разрешается выбором другого login в том же verified flow. Email UNIQUE окончательно разрешает races.

Runtime grants добавляются отдельно через `authGrants` в server/security/grants.mjs: INSERT users/reservations, DELETE users/covers, column-scoped UPDATE visibility/settings users, CRUD auth tables и cover_cleanup; существующие data grants сохраняются. Backup получает SELECT новых таблиц. Migrator остаётся единственным DDL actor. Само приложение grants не применяет.

## Пароли и benchmark

Node 24.19.0 built-in async Argon2id, без стороннего Argon2 package:

- memory=65536 KiB, passes=3, parallelism=1;
- salt=16 bytes, tag=32 bytes;
- format: argon2id$v=19$m=65536,t=3,p=1$<salt hex>$<hash hex>;
- строгий allowlist параметров; произвольные параметры из DB не запускаются;
- один общий resource gate для Argon2id и transitional legacy verification, concurrency=1, queue=4, timeout=5s;
- KDF вне transaction/connection lock; version повторно проверяется при login commit.

Password: 12–128 Unicode code points, до 1024 UTF-8 bytes, well-formed Unicode, без control characters; пробелы сохраняются, нет trim/truncation/composition rules. Repeat обязателен при completion. Начальный встроенный common-password denylist и повтор одного символа проверяются локально. Это небольшой список, не полная база утечек; пароль наружу не отправляется.

Mac ARM64, Node 24.19.0, 11.10.2026. Владелец указал использовать только имеющийся Mac, без нового Linux стенда. Скрипт scripts/argon2-benchmark.mjs: 20 KDF, 5 Covers на 16 MP ceiling, конкурентные HTTP reads.

| Candidate | KDF p50/p95 ms | Peak process RSS MiB |
|---|---:|---:|
| 64 MiB, t3 | 108 / 132 | 232 |
| 48 MiB, t3 | 80 / 88 | 225 |
| 32 MiB, t4 | 65 / 75 | 222 |

Повтор выбранного профиля с настоящими reads из помеченной local PG test DB: KDF 108/129 ms, HTTP p95 3 ms (190 reads), Covers p95 119 ms, peak RSS 232 MiB. Процесс наблюдался с RSS budget 512 MiB; это **не hard Linux cgroup limit**. CPU latency и Linux native-memory поведение остаются отдельной проверкой перед production rollout, без автоматического ослабления KDF. Параметры версии кодируются для controlled future upgrade; сейчас существует один разрешённый профиль, переход на второй потребует отдельного изменения allowlist/rehash policy.

## Flows и защита

6-digit OTP, TTL 10 min, 5 неправильных попыток, cooldown 60s, registration flow 30 min, verified grant 15 min. CSPRNG + HMAC с purpose/challenge/subject context, secret вне DB, timing-safe comparison. Verify одноразово потребляет код и ротирует flow capability. Resend заменяет предыдущий current code. Вне зависимости от cleanup expiry проверяется на каждом обращении.

Opaque sessions: 32 random bytes, только SHA-256 digest в PG; idle 24h, absolute 7d, до 10 активных устройств. Cookie __Host-vinyl_auth в production; vinyl_auth для local HTTP. HttpOnly, Path=/, SameSite=Lax, Secure в production, без Domain. Logout отзывает текущую session; reset увеличивает auth_version, отзывает все sessions и другие recovery flows. После reset автоматического login нет.

Pre-auth signed CSRF cookie/token с TTL 30 min не даёт authentication. Origin/Host/Fetch-Site проверяются; unsafe auth JSON <=8192 bytes с timeout чтения. Authenticated CRUD требует session-bound CSRF. Existing reports/streaming limits остаются отдельными.

PG persistent limits: start 10/IP/15m; email 3/purpose/hour +10/day; verify 30/IP/15m +5/challenge; login 20/IP/15m +5/login/15m; completion 10/IP/15m +5/flow; bootstrap 30/IP/15m. Login account bucket сохраняет неудачные попытки; успешный login атомарно освобождает зарезервированную попытку. IPv6 объединяется по /64. Global mail ceiling 180/day, verification 140/day оставляет резерв recovery; SMTP pacing 1/sec. Это последние предохранители поверх индивидуальных limits. Cleanup пакетами до 500 строк при старте и раз в минуту; flows удаляются через сутки после expiry.

Occupied login при registration раскрывается намеренно. Login failure generic; unknown/ineligible email получает тот же внешний pending flow без письма. SMTP не ожидается HTTP response. Dummy hash для неизвестного login. No secrets в application audit: только event + HMAC subject; provider errors не сериализуются в ответ.

Email send: bounded in-memory queue, accepted/failed/unknown. Plaintext OTP только в памяти до отправки; capture специально сохраняет fixture codes в локальном файле 0600 вне Git. После ambiguous send нет автоматического duplicate retry. Crash/queue failure восстанавливается resend с новым кодом. Старое позднее письмо может содержать уже недействительный код.

## Existing owner и будущий rollout

Existing production UUID: 5c621d27-1477-46d3-a1f9-92311f53856d. Local fixture использует тот же UUID только в отдельной local DB, email fixture-owner@example.test и отдельный fixture legacy password.

Bootstrap: legacy login → /auth → «Активировать новый вход» → email verification → новый password → обычный login. Не создаётся второй User, данные/visibility не переносятся. Recovery owner закрыт пока legacy bridge включён: старый пароль иначе оставался бы обходом reset. Production bridge выключается только после отдельной production acceptance, не в этом local этапе.

Будущий rollout: backup/restore → additive 003/004/grants → code с registration disabled → отдельно разрешённый Postbox/DNS setup/smoke → owner activation → новый login/data verification → retirement bridge → registration остаётся disabled. Code rollback после activation сохраняет auth schema/accounts и допускается только к совместимому release. Старый dump не является способом обычного code rollback. После disaster restore отозвать все sessions/flows; не восстанавливать старые capabilities в работающий runtime.

Restore rehearsal теперь проверяет наличие/counts auth tables и credential/user integrity, затем удаляет восстановленные sessions/flows в **изолированной test DB**. Dump содержит hashes, поэтому права backup остаются ограниченными.

DNS read-only snapshot 11.10.2026: SPF `v=spf1 include:_spf.timeweb.ru ~all`; MX mx1/mx2.timeweb.ru; DMARC NXDOMAIN. Не создавать вторую SPF запись и не удалять Timeweb. MX не менять. DKIM/verification values получать только при реальном Postbox setup. Эти настройки сейчас не выполнялись.

## Текущие URL и кабинет

Canonical: `/`, `/auth`, `/{login}/collection`, `/{login}/wishlist`. Старые `/{login}` и `/u/{login}/…` используют тот же resolver и redirect; служебные имена зарезервированы. Несуществующий пользователь — 404, private список — понятная 403-страница. Ни SSR-каталог, ни SEO/indexing не реализованы; profile pages noindex.

`/` содержит прежний логотип, согласованный текст, «Вход» и «Регистрация». Signup после OTP/password выполняет существующий login и ведёт в собственную Collection. Recovery по-прежнему заканчивается новым входом. На списках — «Личный кабинет» вместо Login/Logout (legacy backend сохраняет Stage 3 controls).

Guest `/auth`: вход, регистрация, возврат. `returnTo` сервер принимает только как существующий публично доступный `/{login}/collection|wishlist`; внешние URL, неизвестные/private users, query/path tricks дают `/`. Вошедший пользователь всегда возвращается в свою Collection независимо от входной страницы. Reload сохраняет явный returnTo. Logout отзывает session и ведёт на `/`; повторный вход полный, с регистрацией и recovery.

Настройки кабинета: общий «Публичная коллекция» для двух списков; «Показывать цену продажи», default false. Цена покупки/storeUrl никогда не добавляются в guest projection. Владелец видит заполненную цену продажи независимо от переключателя. Форма, таблица, прежний mobile detail и CSV поддерживают отдельный salePrice; пустое поле не показывается. Transfer в новую Collection сохраняет цену источника; при выборе существующей записи сохраняется цена target. Duplicate/sort/streaming rules не менялись.

## Смена пароля и удаление

Change password требует текущий пароль, новый и повтор; существующая Argon2id policy, Origin/CSRF и durable лимиты 5/user и 20/IP за 15 минут для каждого действия. Hash вычисляется вне транзакции; под user lock повторно проверяются session/auth_version/hash. Все прежние sessions и pending recovery grants отзываются, текущая cookie заменяется новой. Для первого owner смена пароля недоступна, пока включён legacy bridge: иначе старый пароль оставался бы обходом обещанной смены.

Hard delete требует текущий пароль и `confirm:true`. В одной owner transaction сохраняется cleanup metadata, удаляются оба списка/Favorites, Covers metadata, credentials/sessions/flows и User. Login reservation остаётся; email/login менять нельзя. Конфигурированный owner UUID и любой mirror owner защищены от удаления сервером; кнопка недоступна. Никаких удалений реального obrattsev не выполнялось.

После commit удаляются только серверные UUID directories Covers. Ошибка/падение сохраняет cover_cleanup и не возвращает аккаунт; повтор при следующем startup или account deletion. Очистка идемпотентна, блокирует повторное использование UUID, использует SKIP LOCKED и общий backup/freeze lock. Это простая durable таблица с повторной обработкой, без отдельной системы jobs. Pending файлы не доступны через media authorization. Существующие orphan Cover metadata от обычных unlink/CRUD остаются прежним поведением; account deletion включает и их.

## Локальная acceptance — 12.10.2026

Текущий стенд: http://127.0.0.1:8046/ . Постоянная fixture-папка вне Git:
`/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4c-acceptance-izG2e5`.

Старая temporary папка отсутствовала после перерыва; существующие БД не удалялись и не пересевались. Новый стенд создан в отдельной DB через `scripts/pg-auth-acceptance.mjs`, с `PG_AUTH_ACCEPTANCE_PARENT` на постоянную папку. Скрипт требует dedicated localhost:55464 admin; runtime ограничен, env 0600. В production не обращались.

Тестовые accounts: `cabinet_test` (две fixture записи, public, sale price 1500.5/0) и `visitor_test` (пустой private). Пароль обоих **Local acceptance October 12!** — только для этого локального fixture-стенда. Email соответственно `cabinet_test@example.test` / `visitor_test@example.test`. Fixture `obrattsev` не активирован; технический rehearsal `/auth?mode=legacy-owner`, пароль `local-owner-4C-password`, email `fixture-owner@example.test`. Настоящие owner данные не используются.

Повторный запуск без сброса:

```sh
/Users/obrattsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4c-acceptance-izG2e5/restart.env server/index.mjs
```

Если user-local PG остановлен, запустить существующий cluster с прежним портом (system service не требуется):

```sh
/Users/obrattsev/vinyl-collection-config/stage4a-local/runtime/bin/pg_ctl -D /Users/obrattsev/vinyl-collection-config/stage4a-local/data -l /Users/obrattsev/vinyl-collection-config/stage4a-local/postgres.log -o '-h 127.0.0.1 -p 55464' start
```

Для OTP только локальный capture:

```sh
/Users/obrattsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/read-local-mail.mjs /Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4c-acceptance-izG2e5 cabinet_test@example.test
```

Короткая ручная приёмка:
1. Открыть `/`, затем public `/cabinet_test/wishlist`; через кабинет проверить возврат в Wish-list и reload.
2. Войти cabinet_test; проверить собственный `/cabinet_test/collection`, цену покупки/продажи, Edit и CSV. Открыть `/obrattsev/collection`: нет owner actions; кабинет возвращает в свою Collection.
3. Переключить публичность и цену продажи; во втором браузере проверить оба списка, отсутствие private purchase данных и закрытие прямого Cover URL. Вернуть нужные настройки.
4. В кабинете сменить пароль вручную; проверить старый/новый пароль и вторую session. Logout → `/` → полный вход. Recovery и новый signup проверить через capture codes, без SMTP.
5. Удаление проверять только на `visitor_test` или новом созданном disposable account: сначала отмена/неверный пароль, затем окончательное подтверждение; старый URL должен стать 404. `cabinet_test` можно оставить для повторной приёмки; fixture obrattsev защищён.

## Acceptance matrix

Автоматические результаты и отдельные браузерные наблюдения разделены. Финальная визуальная acceptance владельца ожидается.

| Группа | Проверка | Результат |
|---|---|---|
| A | Landing, login/signup redirects | Regression/PG pass; landing и login проверены в браузере |
| B | Public оба списка, filters/sort, отсутствие mutations | Regression/PG pass; public views и отсутствие owner actions проверены в браузере |
| C | Guest account, Collection/Wish-list return, invalid/private fallback | Regression/HTTP pass; Wish-list return + reload проверены в браузере |
| D | Login, wrong password, recovery, logout/relogin | Regression/PG pass; login/logout/relogin/browser back проверены в браузере; recovery capture проверен автоматически |
| E | Signup, OTP, password, auto-login | Regression/PG pass; создание fixture через полный серверный flow; ручная визуальная цепочка ожидает acceptance |
| F | Own vs foreign profile, UUID ownership | Regression/PG pass; браузерный own/foreign/account return pass |
| G | Общая публичность, API/Covers/CSV и no-store | Regression/PG pass; переключения в браузере остаются ручной acceptance |
| H | Sale price absent/null/zero/filled, guest purchase privacy, edit/Transfer | Regression/PG pass; mobile detail и desktop колонка проверены в браузере |
| I | Password checks, CSRF/rate, current rotation/other revocation, legacy guard | PG pass; форма/отмена проверены в браузере; ввод нового пароля выполняет владелец |
| J | Cancel/wrong password/delete, cleanup retry, A/B/mirror/login reservation | Regression/PG pass; предупреждение/отмена проверены в браузере; окончательное browser deletion оставлено ручной acceptance |
| K | Desktop/mobile, back/reload, direct URL, section links | Regression/HTTP pass; desktop 1365×900 и mobile 390×844, navigation/reload/back проверены |

## Self-review и ограничения

Проверены: session UUID как authority, повторная session check под user lock, safe return allowlist, CSRF/Origin, private fields/API/media, typed price и revisions, owner-scoped deletion, durable cleanup, runtime least privilege, зеркалирование без новых Sheets columns. При review исправлены nullable salePrice при редактировании старых записей, DELETE grant Covers и защита owner change-password при legacy bridge.

Новые зависимости именно для этого дополнения не добавлялись. Общая новая dependency Stage 4C — nodemailer 10.1.0. SMTP adapter сохранён; Postbox credentials/DNS/реальные отправки в текущей задаче не менялись.

Известные границы перед production: настоящая Postbox delivery и Linux capacity/cgroup проверка; запрет удаления mirror owner; файловый cleanup после сбоя повторяется при startup/следующем удалении, отдельного scheduler нет. Restore старого backup требует quarantine/recovery до открытия сервиса. По окончательному решению 14.10.2026 внешний deletion ledger не требуется; риск возврата удалённых аккаунтов и данных из старого backup принят владельцем. Текущий release contract — docs/stage-4c-release-readiness.md. PG backup сохраняет sale price, существующий Sheets mirror — нет. Не выдавать mirror за полный backup новых полей. Auth UI после reload незавершённого OTP flow начинает новый сценарий с существующим cooldown. SSR/SEO, редактирование ФИО и остальные 4D polish не реализовывались. Stage 4C открыт.

Полный список файлов этой итерации: `migrations/004_account_lifecycle.sql`; `server/security/account-store.mjs`, `http-auth.mjs`, `grants.mjs`, `scoped-services.mjs`; `server/app.mjs`, `index.mjs`, `cover-storage.mjs`; `server/postgres/repositories.mjs`, `services.mjs`, `mirror.mjs`; `src/base-record.mjs`, `public-record.mjs`; `prototype/auth.html`, `auth-ui.mjs`, `landing.html`, `app.js`, `index.html`, `wishlist.html`, `styles.css`; `scripts/pg-auth-acceptance.mjs`; `tests/stage-4c-ui.test.mjs`, `tests/fixtures/prototype-dom.mjs`, `tests/page-routing.test.mjs`, `tests/postgres/auth.test.mjs`, `tests/postgres/data.test.mjs`; `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/data-rules.md`, этот отчёт. Ранее подготовленные Stage 4C auth/email/benchmark файлы сохранены. Никаких commit/push/PR/merge/deploy.

## Итоговые проверки 12.10.2026

- Полный regression suite: **413/413 passed**.
- Полный PostgreSQL integration suite: **75/75 passed** (только marked test DB с проверкой ownership token).
- `npm audit` (все dependencies): **0 vulnerabilities**.
- `git diff --check`: passed.
- Проверка изменённых/новых файлов на фактические AUTH_SECRET и DB password локального стенда: совпадений нет. Env, capture OTP, Covers, dumps и runtime artifacts вне Git.
- Browser smoke: полная форма повторного входа, фокус Email, собственная и чужая коллекция, кабинет, формы и отмена password/delete, guest Wish-list return/reload, desktop/mobile, logout→landing и browser back. Настоящие смена пароля и удаление fixture проверены автоматическими PG/HTTP tests; браузерное финальное подтверждение оставлено владельцу.
- Self-review завершён; найденные дефекты исправлены, оставшиеся release limitations перечислены выше. Рабочая ветка `feature/stage-4c-auth` остаётся незакоммиченной; production/реальные Sheets/Covers/SMTP не изменялись.
