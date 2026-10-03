# Backlog Vinyl Collection AI

Актуальный статус 3E: deployment 02.10.2026 выполнен, технический production smoke пройден; [отчёт](stage-3e-production.md). Финальная визуальная production acceptance подтверждена владельцем; Stage 3 закрыт. Реализация Stage 4/5 не начата.


Backlog описывает текущее состояние продукта и согласованный roadmap. Этапы 1–3 выполнены; архитектура Stage 4 согласована, реализация этапов 4–5 не начата. Статусы пакетов этапа 3 указаны отдельно. Для будущих задач согласование направления не означает готовность подробной спецификации или реализации. Действующие спецификации определяют поведение операций; новые требования уточняются перед реализацией.

## Этап 1 — Полный локальный MVP без AI на реальных Google Sheets

**Статус: выполнен.** Реализованные возможности актуального `main`; acceptance основной коллекции и wish-list пройден.

1. **Основная коллекция и wish-list.** Две специализированные модели и два реальных Google Sheets-документа. Доступ: UI → собственный API → слой доступа к данным → Google Sheets. GET/POST/DELETE работают для обоих разделов; браузер не обращается к Sheets напрямую.
2. **Постоянные UUID.** Генерация приложением, хранение и проверка идентификаторов обеих моделей. Текущие рабочие таблицы используют UUID; GET не создаёт и не исправляет ID.
3. **Просмотр и ручной поиск.** Просмотр обоих разделов и поиск по исполнителю, альбому, году альбома и жанру. Единый критерий жанра проверяет основной и дополнительный жанры.
4. **Ручное добавление.** Формы обоих разделов, предварительный просмотр полного проекта, исправление, подтверждение и отмена без записи неподтверждённого проекта.
5. **Удаление.** Подтверждение выбранной записи, проверка её версии и результата удаления; успех сообщается только после проверки.
6. **Перенос wish-list → collection.** Подтверждённое создание записи коллекции до удаления исходника; отдельный результат частичного успеха и явное подтверждение завершения удаления по выбранному совпадению.
7. **Проверки данных и обработка ошибок.** Форматы, дополнительный жанр, дубли, структура и колонки Sheets, целостность UUID. Проверка результата записи перечитыванием, защита от слепых автоматических повторов и обработка неподтверждённого результата.
8. **Базовый веб-интерфейс.** Переключение разделов, таблицы, поиск и фильтры, формы добавления, подтверждения, отмена и состояния операций.

**Существенные ограничения:** перенос не является междокументной транзакцией; при частичном успехе нет автоматического rollback. Полноценная идемпотентность, устойчивый журнал операций и транзакционная защита от внешних конкурентных изменений не реализованы. Запоздалое применение записи Google после timeout остаётся возможным. Запросы записи одного процесса выполняются последовательно; несколько серверов записи и одновременное ручное изменение/сортировка Sheets не поддерживаются. AI и смысловая нормализация отсутствуют. Эти ограничения не являются незавершёнными задачами этапа 1.

Контракты: [README](../README.md), [правила данных](data-rules.md), [добавление в коллекцию](add-record-spec.md), [добавление в wish-list и перенос](add-wishlist-record-spec.md), [удаление](delete-record-spec.md), [поиск в коллекции](search-records-spec.md), [поиск в wish-list](search-wishlist-spec.md).

## Этап 2 — Публикация на VPS и публичный read-only режим

**Статус: выполнен по подтверждению владельца.** Программный срез и последние UX-корректировки реализованы; локальная acceptance подтверждена владельцем. Production и HTTPS развёрнуты; внешняя acceptance guest/login/logout и обоих разделов подтверждена владельцем. Канонизация URL /collection и /wishlist завершена. Подробности — [auth и acceptance](stage-2-auth.md).

Порядок задач отражает roadmap, а не обязательную техническую последовательность реализации. **Приложение нельзя делать публично доступным до защиты всех изменяющих операций аутентификацией owner.**

### 2.1. Публикация на собственном VPS

Предпочтён существующий VPS с WireGuard и схема Internet → существующий nginx → Node на 127.0.0.1:8000 → Sheets. Локальная acceptance пройдена; выбран https://vinyl-collection.ru с перенаправлением www. Перед deployment добавлено разделение rate limiting по client IP через доверенный loopback nginx; контракт proxy — в docs/stage-2-auth.md. Первый production deployment и внешняя acceptance выполнены; финальная канонизация адресов завершена. WireGuard, NAT, firewall, SSH и Zabbix вне текущей задачи. Требуются интернет-доступ, доменное имя, HTTPS, постоянный запуск сервиса и простой процесс обновления. Конфигурация и секреты — вне Git. Публичный запуск допускается только после проверки защиты изменяющих операций и разграничения доступа.

### 2.2. Аутентификация владельца и разграничение доступа

Один owner после входа получает существующие возможности управления коллекцией и wish-list. Защитить все изменяющие операции; реализованы пароль owner с scrypt-хешем и серверная cookie-сессия (7 дней максимум, 24 часа бездействия, сброс после рестарта). Регистрация и независимые коллекции нескольких пользователей в этот этап не входят.

### 2.3. Публичный read-only просмотр

Гость без авторизации может переключаться между collection/wish-list, искать и просматривать разрешённые данные, но не выполнять изменяющие операции. Согласованы и реализованы девять публичных полей, включая note; id, сведения о покупке и storeUrl гостю не передаются. Поиск и просмотр работают без UUID. Интерфейс должен подходить для публичной демонстрации pet project, в том числе для портфолио и собеседований. Возможное развитие публичного представления — статистика и карточки пластинок; их состав требует отдельного согласования и не включается автоматически в реализацию этапа.

## Этап 3 — Развитие продукта без AI

**Статус: ЗАКРЫТ по подтверждению владельца.** Пакеты 3A–3E реализованы, приняты и опубликованы. Production Bug Reports проверен; схема Sheets, backup/restore Covers и initial backfill выполнены. Streaming, финальные Add Cover и mobile Transfer приняты. Последний принятый runtime release — `da16da2dd257ee7175278ddb38ebee31aa7f2138` (PR #23), отчёт — PR #24; 386/386 tests, production smoke и финальная визуальная production acceptance пройдены. [Production-отчёт](stage-3e-production.md). UI и функции Stage 3 являются regression contract Stage 4.

### 3.1. Редактирование записи

Редактирование существующих записей основной коллекции и wish-list с сохранением постоянного UUID, правил валидации и целостности. Все пользовательские поля доступны owner; полный PUT с If-Match, preview изменений и сохранение draft при конфликте. [Действующая спецификация](edit-record-spec.md).

### 3.2. Формат даты покупки

Изменить пользовательский ввод и отображение с `YYYY-MM-DD` на `DD.MM.YYYY`, сохранив правила корректности даты. Внутренний/API/Sheets формат сохранён YYYY-MM-DD, без миграции.

### 3.3. Переименование поля wish-list

Изменить пользовательское название «Ссылка на онлайн-магазин» на «Ссылка». Это не требование автоматически переименовать внутреннее поле `storeUrl`. В 3C валидный HTTP(S) URL показывается owner компактной безопасной ссылкой «Открыть в магазине ↗» в таблице / «Открыть ↗» в detail; исходное значение остаётся в edit и разрешённом CSV.

### 3.4. Компактные окна подтверждения

Пакет 3B: адаптивная компактная ширина подтверждений и форм обоих разделов; прокрутка в пределах viewport, доступные кнопки и focus. Контракт — [3B](stage-3b-spec.md).

### 3.5. Мобильный UX

Пакет 3B: desktop table → responsive compact list (≤1120 px, визуальная проверка в local acceptance) → bottom sheet. Общие displayedRecords/activeSort, resize без GET и сброса поиска. Mobile list: исполнитель, альбом, год, основной жанр; detail по роли, существующие CRUD без вложенных modal. Mobile select сортировки + направление; базовый порядок восстанавливается через «По умолчанию». CSV сохраняет контракт 3A независимо от viewport. Подробности — [3B](stage-3b-spec.md). Развитие 3C: note ограничен ellipsis только в desktop, полностью доступен в detail/edit; owner Collection видит дату/магазин/цену покупки в desktop и detail, guest их не получает. Несортируемые заголовки выровнены без добавления сортировки. [Контракт 3C](stage-3c-presentation.md).

### 3.6. Базовая сортировка

Единое правило Collection и Wish-list: Исполнитель ASC → внутри одного исполнителя Год альбома ASC. Все альбомы одного исполнителя сгруппированы вместе, годы идут от раннего к позднему. Одинаковое написание, регистр и незначащие пробелы сравниваются по общему механизму нормализации и Intl.Collator ru. При одинаковом исполнителе и годе сохраняется исходный порядок. Пустой год на уровне presentation располагается после заполненных внутри исполнителя; обязательность albumYear в модели/API не меняется. Правило действует для полного списка и результатов поиска и восстанавливается после сброса ручной сортировки. Физический порядок строк Sheets не меняется; сортировка только на presentation layer.

### 3.7. Интерактивная сортировка

Клик по поддерживаемому заголовку таблицы сортирует отображаемые строки; повторный клик переключает ASC/DESC. Активная ручная сортировка переопределяет базовую только для отображения. Восемь сортируемых колонок и правила состояния — в [спецификации](search-records-spec.md#сортировка-и-скачивание-3a).

### 3.8. Скачивание отображаемого набора

Кнопка «Скачать csv» справа на уровне счётчика, вне таблицы, в стиле «Войти». Скачивается именно текущий отображаемый набор с текущей сортировкой: весь список либо результат поиска. CSV UTF-8 BOM с `;`, колонки контракта 3A (guest/owner Collection: 9; owner Wish-list: 10), независимо от viewport, без UUID/действий; доступен guest и owner. Экспорт выполняется на клиенте. Сверка 3C сохраняет этот состав: поля покупки Collection не экспортируются даже после добавления в owner desktop; разрешённые note/URL экспортируются полностью, без presentation-сокращений, с прежней защитой формул.

### 3.9. Избранное основной коллекции

3D, реализовано и развёрнуто: только Collection, публичная нота ♪, owner toggle без confirmation, read-only фильтр «Только избранное». Mapping `Избранное` → favorite:boolean, пусто=false без массовой перезаписи. Фильтр влияет на displayedRecords/CSV; колонка favorite в CSV не добавляется. [Контракт](stage-3d-spec.md).

### 3.10. Обложки и изображения

3D, реализовано и развёрнуто: общая первая desktop-колонка Favorite/Cover; отдельные add/replace/delete cover для обеих коллекций, вне Add/Edit metadata. Thumbnail/detail/dialog по роли, без пустого guest placeholder. Persistent COVERS_DIR вне releases, нормализация JPEG/PNG/WebP, HEIC отложен владельцем. Подтверждённые ссылки Sheets, общая очередь, durable holds при неизвестном результате. Геометрия 36/48 px принята по повторной local acceptance. [Контракт](stage-3d-spec.md).

### 3.11. Интеграция со стриминговым сервисом

3E — согласован iTunes Search API → официальный Apple Music embed → постоянная внешняя ссылка. Read-only lookup только по «Прослушать» для guest/owner обоих разделов. Desktop сохраняет полную таблицу, horizontal scroll и CRUD в конце строки; Streaming открывается в отдельном read-only Artist/Album/Cover dialog; Cover control сохраняет отдельный Stage 3D dialog без Streaming. Mobile сохраняет compact list → полный detail по роли со Streaming. Desktop-вход только через название альбома; без новой колонки и третьей quick button. Один клик автоматически выполняет RU → US только после настоящего no-result; финальное состояние — «Альбом не найден»; неоднозначность требует выбора из максимум пяти кандидатов. MusicKit, собственный audio-player и streaming fields в записях/Sheets/CSV исключены. После отклонённой local acceptance выполнен controlled rollback к pre-3E UI и минимальный Streaming patch. Дополнительно согласованы видимый native scrollbar и устранение вертикального блока действий Wish-list, растягивавшего строки. Local acceptance 3E пройдена по подтверждению владельца. Финальные optional Cover при Add и primary mobile Transfer приняты владельцем; Git/deployment разрешены 02.10.2026; после них функциональный scope Stage 3 заморожен. [Контракт](stage-3e-final-polish.md). [Контракт](stage-3e-spec.md), [локальная проверка](stage-3e-acceptance.md). Цикл реализации, local acceptance, commit/push/PR/merge, deployment и production acceptance завершён; пакет и Stage 3 закрыты.

### 3.12. Отправка сообщения об ошибке

Пакет 3B: «Сообщить об ошибке» в обоих разделах для guest/owner; ≤2000 Unicode-символов, body ≤16 KiB, без вложений. Отдельный Google Sheets-документ: ID, Создано UTC, Сообщение, Раздел, Версия приложения. Нет публичного чтения/inbox; same-origin POST, 3 попытки/15 минут/IP и 50/час суммарно, отдельные лимиты, 429 + Retry-After. Серверные ID/time/RELEASE, stringValue против formula injection, post-write verification, draft сохраняется при ошибке. Конфигурация исключает документы коллекций. Реальный отдельный production Sheet подключён, acceptance выполнен, тестовая строка удалена; долг закрыт по подтверждению владельца. Контракт — [3B](stage-3b-spec.md).

### 3.13. Общий справочник жанров — пакет 3A

В `src/genres.mjs` добавлены New Age и Various для обоих списков, добавления, редактирования и поиска. Various — служебное жанровое значение для разножанровых сборников; Artist не изменяется.

### 3.14. Унификация кнопок полного просмотра — пакет 3A

Collection: «Показать всю коллекцию». Wish-list: «Показать весь wish-list». Обе кнопки показывают полный соответствующий набор вместо результата поиска, независимо от заполненных критериев. Поведение и активная ручная сортировка сохраняются.

### 3.15. Daily Quote и компактный заголовок — пакет 3D

Реализовано и развёрнуто: curated JSON, стабильный выбор по локальному дню и section, смена в полночь без cron/AI, graceful fallback. Большой heading скрыт визуально, semantic h1 сохранён. Первоначальный каталог из 10 цитат согласован владельцем и подключён к стенду и production; переносы сохранены, фон блока светло-серый. [Приёмка](stage-3d-acceptance.md).

## Этап 4 — PostgreSQL и многопользовательский режим

**Статус: архитектура и декомпозиция СОГЛАСОВАНЫ; реализация НЕ НАЧАТА.** Фиксация документации не разрешает реализацию 4A или production operations. Реализация 4A начинается отдельной командой владельца. Приоритеты: data safety → ownership security → простой UX → минимальная эксплуатационная сложность → сохранение Stage 3 → SEO.

User и ownership закладываются до миграции. До успешного cutover 4B действуют текущие Sheets contracts; после него PostgreSQL — единственный runtime source of truth Collection/Wish-list. Старые Sheets сохраняются как migration archive, без runtime reads/writes и без dual-write. Bug Reports остаётся отдельной системой на Google Sheets.

### 4A — Data foundation

Relational schema, versioned SQL migrations с checksum/lock, PostgreSQL repository/data layer и транзакционные services. Без ORM; простой Node stack с `pg`. С самого начала: User, CollectionRecord, WishlistRecord, Covers/references, ownership/FK; Favorite сохраняет семантику boolean собственной CollectionRecord, а не избранного чужих записей. Предусмотреть auth artifacts/sessions по мере реализации 4C.

Сохранить точные record fields, UUID, metadata, null/zero/false, dates/purchase information/storeUrl, cover references, Favorites, revisions/If-Match и правила дублей. Импорт сохраняет порядок; новые timestamps не выдаются за исторические даты создания. Owner-scoped queries, constraints/indexes и транзакционная защита конкурентных изменений обязательны. Transfer становится атомарным; идемпотентность create/transfer должна учитывать потерянный ответ.

Tests: schema/FK, repository parity, duplicates, revisions, concurrency и A/B isolation на реальном изолированном PostgreSQL. Production data не мигрируются; подготовленные additive changes не меняют source of truth. Rollback: код откатывается, неиспользуемая additive schema может оставаться; destructive downgrade не обещается.

### 4B — Owner migration и production cutover

Зависит от 4A. Первый существующий владелец становится обычным User; все production Collection/Wish-list/Covers/Favorites принадлежат ему. **Оба его раздела остаются public.** До открытия регистрации доступен один пользователь, но runtime уже применяет ownership. Session определяет user server-side; client-supplied owner ID не даёт прав. Все private GET/mutations, transfer, covers и favorite проверяют владельца; ошибки/conflict/duplicate responses не раскрывают чужие данные.

Обязательный план: capacity preflight → rehearsal в изолированной БД → freeze/drain writes → согласованный backup Sheets/Covers (включая `.holds`) и DB → создание User → импорт → counts/checksums/UUID/fields/Favorites/FK/file reconciliation → переключение runtime при закрытых writes → smoke/acceptance → открытие writes. Import manifest и stable import key обеспечивают безопасный повтор; другой snapshot/конфликт останавливает импорт, blind upsert запрещён. Не исправлять production rows вручную и не терять unresolved holds.

Covers остаются на VPS filesystem; binary в PostgreSQL не хранить. Сохранить существующие UUID paths с DB ownership mapping. Private/public media authorization обязательна для GET/HEAD; знание cover UUID не даёт доступа. Подготовка файлов, ссылки и cleanup учитывают отсутствие общей транзакции DB/filesystem; durable deletion jobs, защита от гонок, orphan cleanup и quotas обязательны.

PostgreSQL на существующем VPS, без Docker/ORM/PgBouncer, если capacity preflight не выявит препятствий. Базовый план — PostgreSQL 16 из Ubuntu packages, актуальный security minor; local-only доступ (предпочтительно Unix socket), отдельные runtime/migration/backup permissions, секреты вне Git, небольшой connection pool, timeouts, systemd integration, monitoring диска/памяти/connections/WAL/autovacuum. Установка и cutover требуют отдельного production шага.

До migration обязательны offsite backup, restore procedure и успешный restore rehearsal. **Конкретное offsite storage не выбрано; выбрать до production migration 4B.** Retention, RPO/RTO и capacity подтвердить до cutover; исходное предложение — daily backup, 7 daily + 4 weekly, RPO до 24 часов, RTO проверить rehearsal. Backup БД и файлов должен быть согласованным; отдельно контролировать успешность и возраст копий.

Tests: повтор/прерывание импорта, changed manifest, missing covers, точное сравнение данных, A/B/Guest UUID attacks, UI regression, restore. Rollback разделён: до новых PostgreSQL writes можно вернуть прежний runtime и неизменённые Sheets; после них Sheets устарели. После открытия writes — совместимый PostgreSQL code rollback или forward fix; data/schema rollback и обратный экспорт являются отдельной процедурой, без обещания безопасного автоматического downgrade.

### 4C — Registration / Auth / Recovery

Зависит от 4B. ФИО необязательно; Email и Login обязательны и уникальны. Регистрация: **ФИО + Email + Login → email code → проверка → Password + repeat → активный account**. Основной вход — **Login + Password**. Recovery: Email → одноразовый код → проверка → новый пароль дважды → отзыв всех sessions → повторный вход.

Login: 3–30 ASCII символов, первая буква, далее `a-z`, `0-9`, `_`, `-`; trim/lowercase, case-insensitive unique. Reserved names покрывают реальные и планируемые routes (`collection`, `wishlist`, `api`, `assets`, `src`, `media`, `prototype`, `u`, `account`, `login`, `logout`, `register`, `verify`, `reset`, `forgot-password`, `admin`, `support`, `system`). Email: единая normalization policy для signup/recovery, trim, нормализованный domain, case-insensitive identity; не удалять точки/plus tags по правилам отдельных providers. Login и Email immutable в первой версии Stage 4.

Современный password hash; переиспользовать versioned scrypt с обоснованными параметрами и ограничением concurrency. Сохранить Secure/HttpOnly/SameSite cookies, CSRF, Host/Origin и trusted-proxy protections; sessions привязаны к User и хранятся в PostgreSQL, поддерживают expiry/revocation. Verification/reset: bounded TTL/attempts/resend, purpose separation, безопасное hashing/HMAC codes, short-lived grants, atomic single-use и cleanup. Plaintext passwords/codes/tokens не хранить в БД/логах.

Rate limiting по IP и уместным account/login/email/challenge dimensions; auth/email limits переживают restart. Enumeration resistance, email bombing/reset abuse/brute force/credential stuffing/username squatting и bounded hashing/email queues входят в MVP. Маленький global limit не должен быть основным ограничением всех пользователей; общие resource/provider ceilings остаются последним предохранителем. CAPTCHA автоматически не добавлять.

**Email provider НЕ выбран.** Решение принимается непосредственно перед 4C; Postbox/Resend/Postmark — кандидаты, ни один не считается утверждённым. До подключения проверить условия/квоты/доставку, DNS authentication и bounce/complaint handling.

Tests: registration/login/logout, normalization/uniqueness races, expiry/replay/resend, enumeration/limits, sessions после restart, reset/revocation. Deploy допускается с registration disabled; rollback отключает новые регистрации, но сохраняет accounts/data и совместимость auth schema.

### 4D — Profile и account lifecycle

Зависит от 4C. `/account`: просмотр Login/Email, изменение необязательного ФИО, change password с current password и двукратным новым, invalidation других sessions и rotation текущей. **Email/Login change не входит в первую версию Stage 4.**

Два независимых переключателя Public Collection / Public Wish-list. **Для новых аккаунтов оба private по умолчанию.** Email/ФИО не публикуются автоматически. Первый мигрированный пользователь сохраняет оба раздела public.

Account deletion: **hard delete без восстановления; удалённый login не переиспользуется**. Явное подтверждение и повторный пароль. Немедленный revoke sessions и публичного доступа; удаление Collection/Wish-list/Favorites/auth artifacts, durable очередь физического удаления Covers с retry/orphan cleanup. Минимальный login tombstone без профиля/коллекции исключает повторное использование. Backup retention ограничивает срок существования архивных копий; restore должен повторно применить журнал удалений до открытия сервиса. Bug Reports остаются отдельными анонимными сообщениями без автоматической привязки account.

Tests: profile/privacy, reauthentication, password/session lifecycle, deletion/cleanup races и restart, запрет восстановления удалённых аккаунтов через обычный restore. Deploy возможен для первого пользователя при закрытой регистрации; code rollback не восстанавливает удалённые данные.

### 4E — Public pages и SSR

Зависит от 4B–4D. Канонические public URLs: **`/u/{login}/collection`**, **`/u/{login}/wishlist`**; **`/u/{login}` → Collection**. Management URLs: `/collection`, `/wishlist`, `/account`. Старые ссылки должны иметь контролируемую совместимость без выдачи чужих private данных; session-dependent redirects не кешируются как постоянные.

Public API — отдельный allowlist-контракт, независимый от наличия visitor session. На своей странице authenticated owner получает management controls через private API; пользователь A на странице B остаётся public visitor. Сохранить текущие девять public metadata fields (включая note), cover presentation и favorite только Collection; не публиковать record UUID, purchase fields, storeUrl, Email/ФИО. Private разделы/media не выдаются гостю.

**Public Collection индексируется и сразу содержит каталог в initial server-rendered HTML.** Небольшой renderer в существующем Node stack, без большого frontend framework migration. Существующие table/mobile UI, search/sort, scrollbar, Covers, Favorite, Transfer, Streaming, Quote, CSV и Bug Report — regression contract; общего redesign нет. Обоснованное изменение — каталог при открытии public Collection; management pages сохраняют прежнюю отложенную загрузку. SSR использует только public projection и escaping.

Public Wish-list доступен по разрешению владельца, но **noindex и вне sitemap в первой версии**. Отдельные страницы пластинок не создаются. Daily Quote остаётся curated, без AI и анализа коллекции пользователя; Streaming остаётся общей read-only функцией с automatic RU → US, ambiguity handling, player lifecycle/cache/limits и прежним UX. CSV использует только доступную проекцию.

Tests: A/B/Guest, четыре сочетания visibility, public/private responses/media, ownership controls, raw HTML без JS, stale requests/logout/смена пользователя, desktop/mobile parity. Public registration открывается только после совместной acceptance auth/recovery, isolation, lifecycle/deletion и privacy; deployment 4C сам по себе её не открывает. Rollback — только к multi-user-safe PostgreSQL release, не к Stage 3 runtime.

### 4F — SEO и release hardening

Зависит от 4E. Unique title/meta description/canonical, Open Graph basics, robots.txt, favicon, semantic headings/content и alt Covers. Dynamic sitemap содержит только разрешённые public Collection активных пользователей; Public Wish-list, private/auth/account/API/technical routes исключены. Корректные 404 для nonexistent/private pages, noindex для служебных страниц/API; robots не заменяет authorization. Проверить server-visible content, escaping и query canonicalization, без отдельных record URLs.

Финальная проверка capacity/abuse limits для public API, Streaming и Bug Reports, backup/restore drill и production checklist. Security и backup не откладываются до 4F: здесь проверяется готовность всего сервиса. SEO rollback независим от сохранения БД/ownership. После production: Google Search Console, Яндекс Вебмастер, sitemap submission и фактическая проверка индексации — внешние post-deploy операции.

### Общая стратегия поставки и проверки Stage 4

Каждый пакет делится на небольшие reviewable PR с dependencies, tests, migration impact, deployment gate и rollback boundary. Существующие **386 tests — regression baseline**, не переписывать массово. Новые integration tests используют реальный изолированный PostgreSQL; матрица Users A/B/Guest × Collection A/B × Wishlist A/B обязательна для private GET, POST, PUT, DELETE, transfer, cover, favorite, conflict responses и CSV. Проверять cross-user UUID attacks, concurrency, migration/recovery, account deletion, public projection/routes и SEO responses.

AI остаётся Stage 5. За пределами Stage 4: отдельные album pages, общий UI redesign, email/login change, object storage migration без необходимости. Принятые решения не означают выполненную реализацию, installation или production migration.

## Этап 5 — AI-функции, естественный язык и внешнее уточнение

**Статус: не начат.** Провайдер, расходы и техническая реализация не выбраны. AI дополняет обычный UI, использует существующие операции и не обходит authorization, validation, confirmation и data-integrity rules. [AI-спецификация](ai-stage.md) описывает этот этап; подробная реализация ещё не согласована.

### 5.1. AI-чат и интернет-уточнение

Дополнительный интерфейс к формам и кнопкам: текстовые команды и помощь в уточнении сведений о пластинке и издании. Обычный UI сохраняется. Самостоятельный информационный поиск остаётся отдельной идеей без этапа.

### 5.2. Распознавание данных по фотографии

Распознавание данных пластинки для collection/wish-list. Показывать уверенность и явно маркировать предположения, запрашивать их подтверждение и недостающие обязательные сведения. Техническую реализацию и способ отображения уверенности определить перед реализацией.

### 5.3. Расширенная нормализация написаний

Сопоставление альтернативных названий и транслитерации. Согласовать правила предложений, автоматизации и подтверждения; не обходить проверки дублей и не менять смысловые значения без подтверждения.

### 5.4. Расширенный поиск естественным языком

Поиск по данным коллекций с более сложными запросами, включая будущие диапазоны годов, дат и цен и сложные условия. Семантику согласовать перед реализацией; состав ручного поиска этапа 1 автоматически не расширяется.

### 5.5. AI/внешний поиск обложки

Поиск и предложение обложки как развитие ручных изображений этапа 3. Источники, подтверждение выбора и подробности интеграции определить перед реализацией.

### 5.6. Dynamic/AI quote source

Dynamic Daily Quote: AI/внешнее уточнение может выбирать цитату из музыки, реально представленной в Collection/Wish-list конкретного пользователя. Текущий curated quote catalog остаётся fallback. Не начато; источники, права и технические условия согласуются перед реализацией.

## Без этапа — идеи

**Статус каждого пункта: идея, решение о реализации не принято.**

### Компактные desktop actions

Идея для отдельного решения: убрать отдельный столбец «Действия», заменить текстовые кнопки компактными иконками с tooltip/accessible label и подобрать более экономное desktop-представление. В 3C не реализуется; текущие кнопки и операции сохраняются.

### Более точная идентификация прессинга

Страна выпуска, каталожный номер и barcode. Включение в модель и влияние на сравнение изданий требуют отдельного согласования.

### История и аудит изменений

Хранение истории изменений данных коллекции. Состав событий и доступ пользователя к истории определить отдельно.

### Альтернативный интерфейс управления и просмотра

Например, Telegram-бот. Состав операций и способ доступа к данным требуют отдельного решения.

### Самостоятельная проверка всей коллекции на дубли и консистентность

Отдельная пользовательская операция с показом найденных проблем. Правила результата и дальнейших действий требуют согласования; встроенные проверки отдельных операций её не заменяют.

### Самостоятельный информационный поиск

Отдельный поиск информации о пластинке или конкретном издании. Состав ответа и границы поиска требуют согласования. Не объединяется с интернет-уточнением внутри AI-сценариев этапа 5.

### Undo после удаления

Возможность кратковременно предложить «Отменить» после удаления. Длительность окна и техническая реализация не определены. Это отдельная идея, не отмена неподтверждённого удаления этапа 1.

## Условная техническая задача — вне этапов

### Миграция legacy-записей без UUID

**Статус: не реализована; нужна только при появлении legacy-данных без UUID.** Текущие рабочие таблицы уже используют UUID и не требуют миграции; задача не является незавершённой частью этапа 1.

При появлении таких данных предусмотреть отдельную одноразовую миграцию для обоих Google Sheets-документов с присвоением UUID существующим строкам без ID. Обычный GET не создаёт и не исправляет идентификаторы. Требование не разрешает автоматически изменять реальные таблицы. Правила целостности — в [модели данных](data-rules.md).
