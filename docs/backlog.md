# Backlog Vinyl Collection AI

> Актуальный итог 16.10.2026: **Stage 4A–4E DONE / Stage 4 COMPLETE**. Stage 4E — **PRODUCTION DONE**, exact SHA `18d0a430299a3b20c36ddf725de2547aee16e2aa`, schema 7. Сайт открыт, frozen=false, исходный nginx восстановлен. [Handoff Stage 5](stage-5-handoff.md). Stage 5 здесь не начинать; более ранние статусы ниже — история.

> Актуальный статус 16.10.2026: **Stage 4D — PRODUCTION DONE / SUCCESS**. Production `d5f0ee90632339c8470cb9d710f32e99182098c2`, PostgreSQL schema 7. Maintenance/restore/migrations/session/data/mirror/backup/Postbox gates пройдены; тестовое письмо получено владельцем. Daily statistics timers включены на 10:00 МСК, первый отчёт 16.10 — отложенная проверка. [Итоговый отчёт](stage-4d-production.md). Stage 4E разрешён последующим запросом владельца. Прежние статусы ниже исторические.

> Maintenance gate: LOCAL FIX ACCEPTED / PR AUTHORIZED / PRODUCTION UNCHANGED. Diagnosis and isolated nginx proof accepted; 517/517 regression. Separate maintenance PR authorized; merge and production retry require new approval. [Diagnosis](stage-4d-maintenance-diagnosis.md), [retry plan](stage-4d-maintenance-retry.md).

> Current authorization 15.10.2026: owner VISUAL ACCEPTANCE complete (including package 1). Git branch/commit/push/PR and production READ-ONLY audit authorized. Merge, deployment, production changes and real emails require separate approval. LOCAL DONE / VISUAL ACCEPTED / PRODUCTION PENDING.

> Visual acceptance package 1: six authorized UI fixes implemented locally; regression 500/500, PG 111/111. User reacceptance ACCEPTED. Existing local stand updated; branch/commit/push/PR authorized, merge/deployment prohibited. [Report](stage-4d-visual-package-1.md).

> Stage 4D — **LOCAL DONE / PRODUCTION PENDING**, функциональный scope закрыт владельцем 15.10.2026. Все блоки приняты, финальные tests 488/488 + PG 111/111, audit 0; отдельный local manual stand запущен. Пользовательская visual acceptance ожидается до любых Git/production действий. Новые задачи до release не добавлять. [Итог](stage-4d-final-readiness.md), [порядок deployment](stage-4d-production-plan.md).

> Актуализация 15.10.2026: Stage 4C — DONE / PRODUCTION GO. Первоначальный выпуск `40ab34a19cd5d93d1c635ce1ee766011fc321e31`, затем routing/security fix PR #31; текущий production `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`. [Production report](stage-4c-production.md). Roadmap: 4A/4B/4C DONE → 4D UX / DATA POLISH NEXT → 4E PUBLIC PAGES / SEO PLANNED → 5A → 5B → 5C → 5D. Старые статусы и планы ниже — исторические; при расхождении действуют эта запись и основной backlog. Разрешены только локальные изменения документации; код 4D, commit/push/PR/merge и production operations ожидают отдельных разрешений.

Этот документ — основной backlog и roadmap. История этапов 1–3 сохранена; активные требования 4/5 находятся ниже. Подробнее: [план 4D](stage-4d-plan.md).

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

**Статус 15.10.2026:** 4A — DONE; 4B — DONE; 4C — DONE; 4D — NEXT; 4E — PLANNED. PostgreSQL — единственный основной источник данных; Google Sheets — резервное одностороннее зеркало владельца и отдельное хранилище Bug Reports. Без параллельной разработки. Roadmap находится в этом документе.

### 4A — PostgreSQL Foundation — DONE

Schema, migrations, owner-scoped repositories, atomic revisions/Transfer, importer и integration tests реализованы и приняты. [История и acceptance](stage-4a-postgresql.md), PR #25. Исторический результат 416 tests; это не текущий test run.

### 4B — PostgreSQL Production Migration — DONE

Cutover 04.10.2026, release `2ccb47b`, PR #26. PG — source of truth, PG→Sheets mirror, backup 7 daily + 4 weekly и restore rehearsal. [Production report](stage-4b-production.md). Исторические ограничения auth bridge заменены 4C.

### 4C — Multi-user Accounts & Authentication — DONE

Landing, принятый UI Collection/Wish-list, registration/OTP/login/logout/recovery, кабинет, PG sessions, Argon2id, CSRF/Origin/rate limits/enumeration protection, owner isolation, публичность, salePrice, смена пароля, самостоятельное удаление и restore quarantine/recovery завершены. [Production report](stage-4c-production.md): первый закрытый runtime `40ab34a`, последующий PR #31 и текущий runtime `f593b3f`. Переданные smoke результаты отделены от текущей read-only проверки; расширенные проверки остановлены владельцем и не заявляются выполненными.

Обязательный независимый S3 deletion ledger и Limited mode — **superseded**, не release blockers. Принят риск возврата удалённого аккаунта/данных из старого PG backup. Существующие quarantine/recovery и account deletion сохраняются. Необязательное редактирование ФИО — **deferred**, вне обязательного 4D до отдельного решения. Старый 4F объединён с 4E; дополнительного этапа нет.

### 4D — UX / DATA POLISH — NEXT

Цель — точечное улучшение принятого интерфейса, данных и выпуска для реальных пользователей. Без redesign, AI и новой инфраструктуры. Зависит от DONE 4C. Все результаты ниже — аудит кода, не новая browser acceptance. API по умолчанию — существующий внутренний API; внешние API/расходы отсутствуют, кроме явно указанных. Общий privacy/security риск — сохранение owner isolation и согласованного public projection.

#### 4D.1. Обложки

**Приоритет HIGH; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C.** В Add label «Добавить обложку»; в confirmation скрыта неактивная «Убрать файл», возврат к draft восстанавливает активную очистку выбора. В Edit существующей обложки добавлено «Удалить обложку» с отменой отметки; draft и preview явно показывают, что удаление произойдёт после финального подтверждения изменений. При Cancel сетевых удалений нет.

После подтверждения metadata PUT должен успешно вернуть проверенную запись, затем DELETE Cover идёт с её свежим If-Match и CSRF. Проверяются id/модель результата, auth epoch и отсутствие Cover. При конфликте отметка сбрасывается для нового подтверждения; при сбое Cover после сохранения metadata показан частичный результат, автоматических повторов нет. Существующий отдельный Cover dialog и ручная загрузка/замена сохранены. API и backend не изменены в этом блоке.

Приёмка локально: Add/no-cover/выбор/ошибка/редактирование/removal/cancel/undo/conflict/unknown result/смена сессии, оба списка, desktop/mobile; existing replace flow покрыт regression. Риск отдельных metadata/Cover requests явно обработан. [Отчёт](stage-4d-forms.md).

#### 4D.2. Формы добавления и редактирования

**Приоритет MEDIUM; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C.** Add CTA «Добавить», Edit CTA «Изменить»; оба по-прежнему сначала открывают preview/confirmation. Убраны «0 — бесплатно», placeholders годов альбома/пластинки и даты покупки. Дата DD.MM.YYYY, нулевая цена, required fields, input constraints, duplicates, revisions и untouched stored values сохраняются. Перенос Wish-list не переименован в Add/Edit.

Проверены обе формы на desktop/mobile. API: прежний CRUD. До финального подтверждения writes нет. [Отчёт](stage-4d-forms.md).

#### 4D.3. Жанровые фильтры

**Приоритет MEDIUM; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C.** Фильтр содержит только непустые genre/additionalGenre из полного актуального ответа текущего Collection или Wish-list. Частота — число записей с жанром, без двойного счёта внутри записи. Порядок frequency DESC, при равенстве алфавитный Intl.Collator ru с детерминированным fallback; регистр/пробелы группируются по прежнему normalize. Сохранены legacy genres, отсутствующие в closed GENRES.

Подсчёт выполняется до поиска, поэтому фильтр не сужается до displayedRecords. Другой список не загружается и не учитывается. На public profile источник — прежний public scoped API, только доступная проекция. Общего user/global frequency cache нет. При смене auth context, ошибке/private отказе варианты очищаются; запоздалый GET не возвращает старые жанры. До первой загрузки, в пустом списке или без genre остаётся «Любой жанр».

Доступный выбранный жанр сохраняется при перестановке вариантов. Исчезнувший выбор сбрасывается на «Любой жанр»; снимается только его criterion, остальные условия остаются. Match semantics (в том числе contains для genre) и сортировка пластинок не менялись. Clear/Favorite reset не переписывался. Варианты и порядок Add/Edit из GENRES оставлены прежними; старый план frequency ranking Add/Edit не выполнен в этом блоке и требует отдельного разрешения, не считается готовым.

Приёмка локально: regression 471/471, PG integration 100/100; A/B/guest/public и разные секции, stale response/logout/private, пусто/no genres/CRUD, desktop/mobile. Реальный изолированный Chrome 1440×1000 и 390×844 для обоих списков: выбор, Add/Edit/Delete и удаление исчезнувшей опции, JS errors 0. API/backend/migrations не менялись. [Отчёт](stage-4d-genres.md).

#### 4D.4. Тексты и подсказки

**Приоритет MEDIUM; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C.** По последнему прямому заданию владельца удалён intro «Найдите нужные пластинки…» из Collection и Wish-list на всех размерах. Остальные согласованные тексты реализованы в 4D.1/2; весь интерфейс не переписывался. Quote/background и reset/favorite не менялись. API: нет новых. [Локальная приёмка и скриншоты](stage-4d-forms.md).

#### 4D.5. Визуальная приёмка

**Приоритет MEDIUM; статус LOCAL DONE / PRODUCTION PENDING; итоговая ручная visual acceptance ожидается; зависимость 4D.1–4.** Результат: подтверждение сохранения дизайна Collection/Wish-list и главной, desktop/mobile, responsive spacing/type/loading/empty/error.

**Оформление цитат принято владельцем 15.10.2026.** Существующий фон Collection/Wish-list сохраняется без изменений. Замена фона, создание альтернатив и сравнение вариантов исключены из Stage 4D. Повторного согласования целевого блока не требуется.

Приёмка: локальные скриншоты desktop/mobile, формы, фильтры, адаптивность, loading/empty/errors. Найденные проблемы сначала представить владельцу; исправления только после согласования. Redesign и production operations не разрешены.

Локальный аудит 15.10.2026 завершён: desktop 1440×1000, mobile 390×844, дополнительно 320×740 и 768×1024. Блокирующих визуальных дефектов не обнаружено; P3 первоначального аудита: пустые preview значения; владелец согласовал `-`, исправлено в последующем локальном дополнении. Во время самого аудита код не менялся. [Результат](stage-4d-visual-audit.md).

#### Дополнения после визуального аудита 15.10.2026

**LOCAL DONE, принято владельцем:** согласованное V1 (пустые preview значения `-`), auth flash Collection/Wish-list, единый report/account button. Regression 479/479, PG 100/100 и Chrome desktop/mobile. [Результаты](stage-4d-ui-followup.md). Код удаления не менялся.

**LOCAL DONE / PRODUCTION PENDING — ежедневная статистика:** получатель `obratsev@yandex.ru`, 10:00 МСК, предыдущий календарный день. Migration 007 и runtime/backup grants, atomic registration/additions, DAU только по успешному авторизованному просмотру списка (не login/technical/guest), начало учёта без backfill, текущие totals и durable report snapshot, Postbox с max 3 attempts и unknown без автоматического resend. Existing PostgreSQL/Node/systemd, новых сервисов аналитики нет. Timer units подготовлены, не установлены. Regression 488/488, PG 111/111. [Локальный результат/runbook](stage-4d-statistics-local.md).

**LOCAL DONE / PRODUCTION PENDING — protected account UI:** решение Stage 4C подтверждено владельцем; initial owner и mirror accounts остаются защищёнными. Кнопка удаления скрыта, показан точный согласованный текст о связи с настройками сервиса и синхронизацией данных. У обычных users кнопка сохранена; server deletion rules не менялись. Guest/owner account label проверен: «Личный кабинет» без legacy login flash. [Исследование и принятое решение](stage-4d-owner-deletion-review.md).


#### 4D.6. Тестирование и локальная приёмка

**Приоритет HIGH; статус PLANNED; зависимость 4D.1–5,7,8.** Результат: подходящие regression/UI/security tests, PG integration при изменении данных, owner/guest isolation, privacy, desktop/mobile, npm audit, diff review и `git diff --check`. Baseline из PR #31: 433/433 + 87/87, не новый прогон.

Приёмка: новые сценарии и существующие обязательные suites проходят, ограничения явно отмечены; владелец принимает локальный результат. API: mocks/capture и существующая маркированная test PG DB, без реального owner destructive tests. Риск: принятие локальных mocks за реальную SMTP доставку; production tests только по отдельному запросу.

#### 4D.7. Безопасные production releases

**Приоритет HIGH; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C; первым в плане.** Цель — воспроизводимое обновление с минимально возможным downtime и сохранением данных/сессий. Сейчас один Node process за nginx, immutable release directories, current symlink, systemd restart, отдельные env/Covers и PG sessions; helpers freeze/backup/migrate уже есть. Добавлены локальные schema compatibility gate, read-only smoke и [release checklist](release-checklist.md); системный deployment не выполнялся. Zero-downtime не обещается.

Локальный результат: `release-policy.json`, `server/release-safety.mjs`, `scripts/release-check.mjs`, `scripts/release-smoke.mjs` и operator runbook. На существующем stack: закреплённый artifact + подготовка dependencies до окна; preflight, свежий проверенный backup, additive migration compatibility gate, короткое окно переключения/restart, автоматизированный read-only smoke; rollback только к совместимому приложению без destructive DB rollback. AUTH_SECRET/PG session data не ротировать при обычном выпуске. Mirror и backup timer должны вернуться в прежнее согласованное состояние и проверяться после выпуска. [Конкретное предложение и checklist](stage-4d-plan.md).

Приёмка: локально воспроизведён успешный upgrade и неуспешный smoke→совместимый app rollback; сессия обычного пользователя сохраняется, несовместимая schema останавливает выпуск до switch; данные/Covers/mirror state не теряются, timers восстановлены; зафиксированы фактическое окно недоступности и STOP rules. API: existing app/PG/systemd/SMTP config, без новых services. Риски: locks/DDL latency, in-flight requests, несовместимый старый binary; destructive migrations требуют отдельного решения и окна. Проверки 15.10.2026: regression 439/439, PG integration 88/88, дополнительные release PG 2/2 (в том числе migration lock timeout около 5 секунд); npm audit 0. HTTP/auth runtime пересоздан локально, прежний cookie/синтетическая запись/Cover hash/mirror сохранены. Фактические Linux systemd/timers/production downgrade не выполнялись. [Локальный отчёт](stage-4d-release-safety.md). Production changes отдельно согласуются.

#### 4D.8. Отчёт об ошибке и email-уведомления

**Приоритет HIGH; статус LOCAL DONE, принято владельцем 15.10.2026; зависимость 4C и принятый 4D.7.** Цель — сохранить принятый report и уведомить владельца через существующий Yandex Cloud Postbox.

**DONE по коду:** `prototype/app.js` скрывает кнопку от unauthenticated; `server/app.mjs` вызывает `requireOwner` (в multiuser это authenticated session+CSRF), лимит report и body 16 KiB; `server/bug-reports.mjs` валидирует и сохраняет в отдельный Sheets через очередь+appendVerified; существующий plain text/stringValue и лимит 2000 символов сохраняются. Busy/disabled кнопка защищает только от одновременного submit в одном UI. Отсутствует полноценная повторная идемпотентность после потери ответа.

**Локально реализовано 15.10.2026:** migration 006 добавляет одну таблицу `bug_report_deliveries` в существующий PostgreSQL. Аутентифицированный report с UUID request key, user UUID из server session, текстом, section/page/time/version атомарно сохраняется до HTTP 201. Повтор с тем же user/key возвращает прежний id; изменённое содержимое — 409. Сессия перепроверяется внутри transaction; persistent лимиты 3/15 min/user и 50/hour общие дополняют прежние IP/CSRF/Origin/body limits. User identity/recipient/From от клиента не принимаются. Query/token в page исключены.

Встроенный bounded worker текущего Node процесса продолжает писать отчёты в прежнюю отдельную Google Sheets-таблицу с прежними пятью колонками. Это доставка архива из durable PG, не замена PostgreSQL Sheets-данными. SMTP отправляется через прежний Postbox adapter с фиксированным verified From и отдельными `BUG_REPORT_NOTIFICATIONS_ENABLED` / `BUG_REPORT_EMAIL_TO`; получатель согласован и подготовлен только в приватном локальном env, не в Git/production. Notification содержит report id, UTC time, user UUID, section/page и описание, только plain text.

Сбой Sheets/SMTP не отменяет принятие. Known SMTP failure повторяется до 5 раз; ambiguous timeout/прерванный sending → unknown без автоматического resend. Для Sheets durable write intent + read-back по ID; после ambiguous append только сверка, без повторного blind append. Интервал 10 секунд, максимум один report за проход, advisory lock защищает от двух workers; freeze/restore quarantine сохраняются. Неопределённые/исчерпанные доставки требуют операторской сверки, exactly-once SMTP не обещается.

**Приёмка локальной реализации:** regression 443/443; полный PG suite 97/97 и дополнительные focused 10/10 после усиления NUL/retry exhaustion/grants; авторизация, повторные/конкурентные запросы, SMTP down/timeout, restart recovery и bounds проверены. Реальные Postbox письма не отправлялись; фактическая доставка получателю не заявляется выполненной. Перед production нужны отдельно разрешённые migration 006/grants/release и реальная delivery acceptance. Schema policy новой версии 6–6; совместимость старого rollback binary со schema 6 требует явного review и SHA-bound declaration с checksum migration 006. [Подробный локальный отчёт](stage-4d-bug-reports.md).

API: существующие Google Sheets и Yandex Cloud Postbox SMTP; новых services/providers/databases нет. Риски: privacy пользовательского текста, archive retention и ambiguous external results. Report archive остаётся независимым от удаления аккаунта, как существующий Sheets archive; хранится user UUID без email. Durable report/статусы входят в стандартный PG dump; backup-role SELECT grant добавлен. Не добавлять публичный inbox/status endpoint или произвольные recipients.

### 4E — PUBLIC PAGES / SEO — PRODUCTION DONE

Зависит от принятого и закрытого 4D. Цель — индексируемые public страницы без раскрытия private данных. Персональные URLs `/{login}/collection`, `/{login}/wishlist`, resolver/aliases и разграничение уже реализованы в 4C/PR #31; их не создавать заново. Collection индексируется; ранее согласованный Public Wish-list **noindex и вне sitemap** сохраняется до отдельного решения, metadata остаются корректными. Нового frontend framework и отдельных album pages нет. Все задачи HIGH для privacy, MEDIUM для остальных; статус каждой ниже указан отдельно; внешние API не нужны, кроме необязательной внешней post-deploy проверки поисковиков.

#### 4E.1. Server-side rendering — PRODUCTION DONE

Цель/результат: каталог public Collection в initial HTML через небольшой renderer текущего Node stack. Сервер выдаёт публичную проекцию записей в initial HTML; после успешной загрузки клиент заменяет её прежней таблицей/mobile list. При отказе доступа или ошибке начальный каталог удаляется. Зависимости: 4D. Приёмка: raw HTML без JS содержит только public allowlist; desktop/mobile и client search/sort/CSV/Streaming/Quote работают; owner management сохраняется. Риск: XSS, двойное состояние и private projection; API: existing public scoped reads.

#### 4E.2. SEO metadata — PRODUCTION DONE

Цель/результат: title/description/headings/canonical для root и персональных public URL; статические titles не считать полноценной реализацией. Зависит от 4E.1. Приёмка: уникальная escaped metadata, canonical без tracking/search дублей, корректные metadata Wish-list при noindex, auth/private не индексируются. Риск: вывести email/ФИО/покупки в metadata; API: нет новых.

#### 4E.3. Robots и sitemap — PRODUCTION DONE

Результат: robots.txt и dynamic sitemap.xml только для допустимых public активных Collection и root; private/auth/account/API/technical/Wish-list исключены. Зависит от 4E.1/2. Приёмка: XML валиден, закрытие/удаление исключает URL, robots не подменяет auth. Риск: sitemap/cache после privacy change; API: existing scoped DB read.

#### 4E.4. OpenGraph — PRODUCTION DONE

Результат: escaped title/description/URL и доступное public image при наличии. Зависит от 4E.2/5. Приёмка: private cover не попадает в OG, корректный fallback без обложки, персональные canonical URLs. Риск: social crawler cache; API: existing authorized Covers, без внешней выгрузки private images.

#### 4E.5. Приватность и индексация — PRODUCTION DONE, HIGH

Результат: распространить существующий server authorization на SSR/metadata/sitemap/cache. Зависит от 4E.1–4; тесты проектировать вместе с renderer. Приёмка A/B/guest: закрытые списки/Covers/CSV, toggle visibility, deleted/nonexistent account не раскрываются ни в HTML, ни в metadata/sitemap; salePrice только при разрешении; Email/ФИО/purchase/storeUrl/record UUID не публикуются. Риск: публичный кеш чужой owner projection; API: existing auth/public projection.

#### 4E.6. HTTP и SEO-корректность — PRODUCTION DONE

Результат: проверить существующие GET/HEAD/status/aliases/redirects и добавить SEO tests, canonical/query/noindex rules. Зависит от 4E.1–5. Приёмка: корректные 404 для private/nonexistent по принятому контракту, никаких session-dependent permanent redirects, duplicate URL не индексируются, служебные/API страницы исключены, escaped SSR. Проверить favicon/alt/semantic headings и сохранение release/backup readiness. Search Console/Яндекс Вебмастер/submission — отдельные согласованные post-deploy операции, не выполнены. Риск: кэш редиректа и stale sitemap; API: внутренние HTTP checks.

#### Итог публикации 4E — 16.10.2026

Exact production SHA `18d0a430299a3b20c36ddf725de2547aee16e2aa` (PR #35); schema **7**, новых миграций/grants/зависимостей нет. Candidate/rollback compatibility PASS. Fresh PG+Covers backup и реальное isolated restore PASS: все пользовательские записи, auth integrity и 74 Cover-файла сверены; тестовая копия удалена. Production PostgreSQL не восстанавливался, rollback приложения не потребовался.

Maintenance generation/retirement и 168/168 внешних 503 probes пройдены. После переключения первый private smoke завершился общей ошибкой и управляющая сессия прервалась из-за лимита approval; сайт остался в maintenance. По отдельному разрешению восстановление продолжено на исправном candidate. Подтверждён дефект порядка действий: Type=simple стал active в 09:30:18 UTC, Node listener готов в 09:30:20; smoke запускался без подтверждения listener readiness. Точный сетевой код первого сбоя не сохранён, поэтому startup race — вероятное объяснение, не доказанная единственная причина. Код приложения и release-скрипты не менялись; обязательный порядок фаз закреплён в AGENTS.md.

Доступ восстановлен **16.10.2026 17:21:06 МСК**. Maintenance с 12:29:02 МСК: **17 524,024 секунды (4 ч 52 мин 4 с)**, включая прерывание сессии. Длительная недоступность не скрывается за успешным итогом выпуска.

Финальные gates: private/public HTTP smoke 11/11; после возврата исходного nginx HTTP/HTTPS canonical/www baseline 56/56, markers отсутствуют; внешний SEO/privacy 34 проверки, включая 2 закрытые страницы и 2 приватных Cover URL. Отключённых аккаунтов в production не было: этот случай покрыт локальными PG tests, реальные аккаунты ради проверки не создавались/не менялись. Один промежуточный expanded network probe получил PROBE_UNAVAILABLE; успешный финальный baseline выполнен после фактического восстановления nginx, не подменяет первоначальный сбой.

Данные: 30 Collection, Wish-list 12 всего / 11 владельца, 6 Favorites, 37 Covers / 74 файла; hashes таблиц, активные сессии и Cover hashes совпали. Mirror 12/12, no_error; read-back Sheets совпал с PG (30/11). App/mirror/backup/health/statistics timers active, NRestarts=0, error-level журналов нет. Postbox TLS/auth PASS без отправки тестового письма. Ежедневный отчёт за 15.10 имеет sent/attempts=1; inbox — отложенная проверка.

Локальные проверки принятого кода: regression 520/520, PG 111/111, auth-copy 18/18, npm audit 0. Exact source archive hash проверен при подготовке runtime; дополнительная повторная финальная сверка файлов и запись SUCCESS.json не выполнены из-за двух timeout автоматического approval. Это не изменяло release или обязательные проверенные gates. Evidence/backup сохранены в существующем operation directory; пользовательские данные и backup не удалялись.

Поисковая индексация, Search Console/Яндекс Вебмастер и внешние OG кеши остаются внешними/необязательными проверками; регистрации в сторонних сервисах не выполнялись. Stage 5 — отдельный чат по компактному handoff.

## Этап 5 — AI / MUSIC DATA

**Статус: PLANNED, не начат.** Строго после всего Stage 4: **5A → 5B → 5C → 5D**. Каждый подэтап принимается отдельно. Направления согласованы; API, тарифы, лицензии и модель проверяются непосредственно перед реализацией. Ниже план исследований, не утверждение о текущих возможностях/ценах providers. Существующие Node.js/TypeScript/PostgreSQL + внешние music/LLM/Vision APIs по необходимости; без Redis/vector DB/локальных LLM/AI microservice/Kubernetes/новой очереди. Timeout, bounded retries/rate limits/cache, cost caps и sanitized logs; внешние сбои не блокируют обычный CRUD. Минимизация данных пользователя обязательна.

### 5A — Поиск обложки — PLANNED, приоритет 1

Цель: MusicBrainz + Cover Art Archive предлагают различимые конкретные релизы и обложки; пользователь подтверждает выбор в Add/Edit. Vinyl format, год/страна/лейбл/catalogue/barcode учитываются при наличии; отсутствие полей не означает разрешения расширить модель. Ручная загрузка остаётся. Недостаток данных не позволяет обещать точный прессинг. Общий gate: права на изображения и privacy запросов проверены до публичного использования.

#### 5A.1. API и условия

**Приоритет HIGH; статус PLANNED; зависит от 4E.** Цель и конкретный результат: проверить MusicBrainz/CAA endpoints, limits и условия

Приёмка: записаны актуальные первичные источники и политика запросов. API: MusicBrainz, CAA. Риски: изменение условий/доступности.

#### 5A.2. Поиск кандидатов

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.1.** Цель и конкретный результат: запрос по данным карточки

Приёмка: кандидаты найдены без private purchase data. API: MusicBrainz. Риски: неполные/одноимённые albums.

#### 5A.3. Ранжирование релизов

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.2.** Цель и конкретный результат: объяснимое сопоставление имеющихся edition признаков

Приёмка: неоднозначность видна, точное издание не выдумано. API: MusicBrainz. Риски: неверный pressing.

#### 5A.4. Обложки кандидатов

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.1–3.** Цель и конкретный результат: получение доступных изображений

Приёмка: no-cover и недоступный asset обработаны. API: CAA. Риски: размер/права изображений.

#### 5A.5. Выбор релиза

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.3/4.** Цель и конкретный результат: UI различимых изданий

Приёмка: показаны имеющиеся год/страна/лейбл/номер, выбор явный. API: внутренний API. Риски: смешение album и release.

#### 5A.6. Интеграция Add/Edit

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.5.** Цель и конкретный результат: подтверждённая обложка в существующем flow

Приёмка: нет автоматического сохранения, ручная загрузка работает. API: existing CRUD/Covers. Риски: orphan cover/conflict.

#### 5A.7. Cache и request control

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.1.** Цель и конкретный результат: ограниченный cache и throttling

Приёмка: timeouts/429/retries проверены, лимиты документированы. API: MusicBrainz, CAA. Риски: устаревание/рост storage.

#### 5A.8. Ошибки и неоднозначность

**Приоритет MEDIUM; статус PLANNED; зависит от 5A.2–7.** Цель и конкретный результат: empty/error/cancel/fallback состояния

Приёмка: API down не блокирует редактирование. API: внутренний API. Риски: повторные запросы.

#### 5A.9. Права на изображения

**Приоритет HIGH; статус PLANNED; зависит от 5A.1.** Цель и конкретный результат: проверка лицензий/атрибуции/хранения

Приёмка: условия зафиксированы, неподтверждённые права вынесены на решение. API: CAA/первичные условия. Риски: copyright/licensing.

#### 5A.10. Тесты и acceptance

**Приоритет HIGH; статус PLANNED; зависит от 5A.6–9.** Цель и конкретный результат: автотесты и пользовательская проверка

Приёмка: различимые варианты, явный выбор, ручной fallback, privacy и failure tests проходят. API: mocks + согласованные API checks. Риски: недостаточное покрытие.

### 5B — Цитаты из песен — PLANNED, приоритет 2

Цель: выбрать пластинку из Collection, определить треки, получить законно используемые данные о lyrics и короткую реальную цитату; ежедневная ротация с curated fallback. MusicBrainz/LRCLIB/Groq Cloud — кандидаты. Наличие текста в API не разрешает публикацию. Полные lyrics не хранить/публиковать без прав. Если законный способ не подтверждён, согласовать безопасную альтернативу до реализации public display. Не включать Wish-list автоматически.

#### 5B.1. API и права

**Приоритет HIGH; статус PLANNED; зависит от 5A.** Цель и конкретный результат: проверить MusicBrainz/LRCLIB/AI terms, copyright и допустимый public excerpt

Приёмка: права подтверждены либо предложена согласованная альтернатива. API: MusicBrainz, LRCLIB, Groq candidate. Риски: лицензия/полные lyrics.

#### 5B.2. Выбор пластинки

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.1.** Цель и конкретный результат: выбор из разрешённой Collection

Приёмка: не используются чужие private записи. API: existing Collection API. Риски: privacy outbound data.

#### 5B.3. Трек-лист

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.2.** Цель и конкретный результат: сопоставление подходящего релиза

Приёмка: неподтверждённый релиз помечен неоднозначным. API: MusicBrainz. Риски: неверные tracks.

#### 5B.4. Lyrics data

**Приоритет HIGH; статус PLANNED; зависит от 5B.1/3.** Цель и конкретный результат: получение только разрешённых данных

Приёмка: нет хранения/публикации полных текстов без прав. API: LRCLIB candidate. Риски: copyright/cache retention.

#### 5B.5. Выбор короткой цитаты

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.4.** Цель и конкретный результат: проверяемый excerpt и авторство

Приёмка: нет выдуманных строк, длина/использование соответствуют правам. API: AI provider при необходимости. Риски: hallucination/attribution.

#### 5B.6. Cache

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.1/5.** Цель и конкретный результат: минимальный cache разрешённых результатов

Приёмка: TTL/retention/права соблюдены. API: existing PG. Риски: лишнее хранение lyrics.

#### 5B.7. Ежедневная ротация

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.6.** Цель и конкретный результат: обновление в согласованной timezone

Приёмка: одна предсказуемая цитата за день. API: existing Node/PG. Риски: timezone boundary.

#### 5B.8. Повторы

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.7.** Цель и конкретный результат: учёт недавних excerpts

Приёмка: частые повторы исключены при наличии вариантов. API: existing PG. Риски: малый каталог.

#### 5B.9. Fallback

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.5.** Цель и конкретный результат: сохранить curated quotes

Приёмка: no-result/API down не ломают сайт. API: existing quote catalog. Риски: зависимость UI от API.

#### 5B.10. Расходы

**Приоритет MEDIUM; статус PLANNED; зависит от 5B.1.** Цель и конкретный результат: лимиты AI tokens/requests и budget ceiling

Приёмка: при исчерпании budget работает fallback. API: выбранный AI API. Риски: AI costs/provider limits.

#### 5B.11. Приватность

**Приоритет HIGH; статус PLANNED; зависит от 5B.2/7.** Цель и конкретный результат: ограничение выбора и публичной выдачи

Приёмка: private Collection не раскрывается через цитату/логи. API: existing auth/Collection. Риски: косвенное раскрытие tastes.

#### 5B.12. Тестирование

**Приоритет HIGH; статус PLANNED; зависит от 5B.5–11.** Цель и конкретный результат: licensing/privacy/fallback/rotation/cost acceptance

Приёмка: реальное авторство, failure и budget tests проходят. API: mocks/согласованные checks. Риски: непроверенные права.

### 5C — Добавление по фото — PLANNED, приоритет 3

Цель: фото → вероятные artist/album → MusicBrainz candidates → предварительное заполнение существующей формы → проверка/исправление → подтверждение пользователя. Vision не доказывает конкретный pressing. Ручной Add независим от Vision. Загружаемые фото private по умолчанию, условия передачи внешней модели изучаются до интеграции.

#### 5C.1. Vision API

**Приоритет HIGH; статус PLANNED; зависит от 5B.** Цель и конкретный результат: сравнить актуальные стоимость, лимиты, retention и доступность

Приёмка: provider и budget согласованы. API: Vision candidates. Риски: costs/privacy/vendor terms.

#### 5C.2. Загрузка фото

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.1.** Цель и конкретный результат: выбор фото в существующем Add flow

Приёмка: cancel не создаёт запись. API: existing app. Риски: неверный UI component.

#### 5C.3. Безопасность файла

**Приоритет HIGH; статус PLANNED; зависит от 5C.2.** Цель и конкретный результат: проверить content type/размер/декодирование

Приёмка: недопустимые файлы отклонены, bounded processing. API: existing image processing. Риски: malformed/decompression abuse.

#### 5C.4. Artist и album

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.3.** Цель и конкретный результат: извлечение вероятных значений

Приёмка: предположения явно помечены. API: Vision API. Риски: hallucination.

#### 5C.5. MusicBrainz

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.4.** Цель и конкретный результат: поиск releases по распознанным данным

Приёмка: есть candidates/no-result. API: MusicBrainz. Риски: неверное издание.

#### 5C.6. Выбор кандидата

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.5.** Цель и конкретный результат: UI сравнения вариантов

Приёмка: только явный выбор пользователя. API: existing app. Риски: одинаковые cover variants.

#### 5C.7. Предзаполнение

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.6.** Цель и конкретный результат: draft существующей формы

Приёмка: сохраняются validation/duplicates/confirmation. API: existing CRUD. Риски: слепая запись.

#### 5C.8. Неопределённость

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.4–7.** Цель и конкретный результат: показать сомнительные поля

Приёмка: нет утверждения о точном pressing без данных. API: existing UI. Риски: ложная уверенность.

#### 5C.9. Ручные правки

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.7.** Цель и конкретный результат: сохранить ручной Add/Edit

Приёмка: работает без Vision и после отказа распознавания. API: existing CRUD. Риски: API blocking CRUD.

#### 5C.10. Расходы

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.1/3.** Цель и конкретный результат: ограничить запросы/размер и budget

Приёмка: лимиты срабатывают до платного запроса, fallback доступен. API: Vision API. Риски: AI costs/retry storms.

#### 5C.11. Приватность фото

**Приоритет HIGH; статус PLANNED; зависит от 5C.1/2.** Цель и конкретный результат: минимизация retention/EXIF/доступа и передачи provider

Приёмка: чужое фото недоступно, правила удаления документированы. API: Vision + existing storage. Риски: personal data/provider retention.

#### 5C.12. Тестирование

**Приоритет HIGH; статус PLANNED; зависит от 5C.3–11.** Цель и конкретный результат: file/privacy/failure/confirmation acceptance

Приёмка: photo candidates исправимы, без confirmation записи нет, ручной Add работает. API: mocks/согласованные checks. Риски: неполная recognition accuracy.

### 5D — Поиск естественным языком — PLANNED, приоритет 4

Цель: фраза пользователя → LLM → ограниченные structured filters → server validation → parameterized application query → PostgreSQL. **LLM не генерирует исполняемый SQL.** Примеры: «британский рок семидесятых», «джаз, купленный в прошлом году», «мои Pink Floyd», «пластинки на продажу»; поддержка определяется фактическими полями, отсутствующие признаки не выдумывать. Обычные фильтры остаются fallback.

#### 5D.1. Поля и фильтры

**Приоритет MEDIUM; статус PLANNED; зависит от 5C.** Цель и конкретный результат: инвентаризация Collection model/query capabilities

Приёмка: известно, какие примеры выразимы текущей моделью. API: existing model/PG. Риски: расширение scope.

#### 5D.2. Типы запросов

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.1.** Цель и конкретный результат: согласовать поддержанные фразы и time semantics

Приёмка: неподдержанные признаки явно объясняются. API: existing UI. Риски: неоднозначность года/страны/продажи.

#### 5D.3. Строгая схема

**Приоритет HIGH; статус PLANNED; зависит от 5D.2.** Цель и конкретный результат: allowlist fields/operators/length/ranges

Приёмка: unknown fields, SQL и owner selector запрещены. API: structured JSON schema. Риски: schema bypass.

#### 5D.4. LLM parsing

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.3.** Цель и конкретный результат: текст → structured filters

Приёмка: выход модели не исполняется напрямую. API: выбранный LLM API. Риски: prompt injection/provider outage.

#### 5D.5. Валидация

**Приоритет HIGH; статус PLANNED; зависит от 5D.3/4.** Цель и конкретный результат: проверка schema/semantics/limits на сервере

Приёмка: malformed/unsupported filters отклоняются. API: existing server. Риски: untrusted model output.

#### 5D.6. Query builder

**Приоритет HIGH; статус PLANNED; зависит от 5D.5.** Цель и конкретный результат: parameterized query из проверенных filters

Приёмка: LLM SQL нигде не исполняется, queries bounded. API: existing PG. Риски: SQL injection/expensive query.

#### 5D.7. Owner isolation

**Приоритет HIGH; статус PLANNED; зависит от 5D.6.** Цель и конкретный результат: user scope только из session

Приёмка: A не получает private B независимо от prompt. API: existing auth/scoped repositories. Риски: data exfiltration.

#### 5D.8. Ввод запроса

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.2/5.** Цель и конкретный результат: небольшой UI рядом с обычным поиском

Приёмка: keyboard/mobile/error states доступны. API: existing app. Риски: redesign/UX overload.

#### 5D.9. Интерпретация

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.8.** Цель и конкретный результат: показать распознанные filters и неоднозначность

Приёмка: пользователь видит смысл фразы и может исправить. API: existing UI. Риски: неверная date interpretation.

#### 5D.10. Fallback

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.8/9.** Цель и конкретный результат: обычные фильтры при LLM failure

Приёмка: поиск не зависит от доступности AI. API: existing search. Риски: потеря state.

#### 5D.11. Лимиты и стоимость

**Приоритет MEDIUM; статус PLANNED; зависит от 5D.4/6.** Цель и конкретный результат: request/token/query caps и timeout

Приёмка: budget ceiling и provider 429 безопасны. API: LLM + existing PG. Риски: AI costs/abuse.

#### 5D.12. Security tests

**Приоритет HIGH; статус PLANNED; зависит от 5D.5–11.** Цель и конкретный результат: A/B/guest, injection, filter abuse и failure acceptance

Приёмка: чужие данные не раскрываются, SQL не исполняется моделью, fallback работает. API: mocks/marked test PG. Риски: неполное negative coverage.

### Отложенные направления Stage 5

Прежние общий AI-чат, автономные информационные уточнения и расширенная нормализация — **deferred**, не обязательный scope 5A–5D. AI-рекомендации, рецензии и социальные AI-функции не добавлены. [ai-stage.md](ai-stage.md) сохраняет исторические сценарии; при расхождении действует этот roadmap. Следующий подэтап не начинается без принятия предыдущего и согласования владельца.

<details>
<summary>История roadmap Stage 4/5 до актуализации 15.10.2026 — superseded</summary>

Эта сохранённая версия не является активным планом или списком blockers. Старый 4D profile/lifecycle включён в 4C либо deferred; 4F включён в 4E; старые 5.1–5.6 заменены 5A–5D. Обязательная реконструкция удалений/ledger отменена; старые placeholders и отдельный reset checkbox не действуют без нового согласования.

## Этап 4 — PostgreSQL и многопользовательский режим

**Статус: 4A реализован и принят владельцем по local visual acceptance.** Реализация в `feature/stage-4a-postgresql`; владелец разрешил commit/push/PR/merge без deployment. 4B production cutover выполнен; production использует PostgreSQL, 4C реализуется локально; остальные задачи 4D–4F не начаты. Приоритеты: data safety → ownership security → простой UX → минимальная эксплуатационная сложность → сохранение Stage 3 → SEO.

Согласованный порядок Stage 4:

1. **4A — PostgreSQL foundation — DONE.**
2. **4B — Production migration/cutover — DONE**, принят владельцем.
3. **4C — Registration/Auth/Recovery + согласованный кабинет/lifecycle subset (локально).**
4. **4D — Оставшиеся profile/lifecycle и release gates.**
5. **4D UX/Data polish** — отдельный пакет после основной реализации личного кабинета 4D.
6. **4E — Public /{login}/collection и SSR.**
7. **4F — SEO и release hardening.**

Stage 5 AI начинается только после полного Stage 4. Новый пакет согласован как backlog; 4C отдельно разрешён для local implementation; это не разрешение начинать реализацию polish.

User и ownership закладываются до миграции. До успешного cutover 4B действуют текущие Sheets contracts; после него PostgreSQL — единственный runtime source of truth Collection/Wish-list. Существующие owner Sheets становятся односторонним PG→Sheets mirror; PostgreSQL остаётся единственным source of truth, без dual-write transaction. Bug Reports остаётся отдельной системой на Google Sheets.

### 4A — Data foundation

Текущий результат: одна SQL migration, owner-scoped PostgreSQL repositories/services, atomic revisions/Transfer, fixture importer с dry-run/manifest protection, local-only backend и real PostgreSQL tests. [Schema, local setup и acceptance](stage-4a-postgresql.md). Принятый Stage 3 UI сохранён. Local acceptance выполнена успешно; функциональный scope 4A принят и закрыт. User-local PostgreSQL 16 используется только для fixtures; production installation/cutover не выполнялись.

Relational schema, versioned SQL migrations с checksum/lock, PostgreSQL repository/data layer и транзакционные services. Без ORM; простой Node stack с `pg`. С самого начала: User, CollectionRecord, WishlistRecord, Covers/references, ownership/FK; Favorite сохраняет семантику boolean собственной CollectionRecord, а не избранного чужих записей. Предусмотреть auth artifacts/sessions по мере реализации 4C.

Сохранить точные record fields, UUID, metadata, null/zero/false, dates/purchase information/storeUrl, cover references, Favorites, revisions/If-Match и правила дублей. Импорт сохраняет порядок; новые timestamps не выдаются за исторические даты создания. Owner-scoped queries, constraints/indexes и транзакционная защита конкурентных изменений обязательны. Transfer становится атомарным; идемпотентность create/transfer должна учитывать потерянный ответ.

Tests: schema/FK, repository parity, duplicates, revisions, concurrency и A/B isolation на реальном изолированном PostgreSQL. Production data не мигрируются; подготовленные additive changes не меняют source of truth. Rollback: код откатывается, неиспользуемая additive schema может оставаться; destructive downgrade не обещается.

### 4B — Owner migration и production cutover

Local acceptance принята, production cutover и verification выполнены 04.10.2026: additive 002, production-compatible owner bridge/config, media authorization, durable PG→Sheets owner mirror, freeze/drain, verification и backup/restore helpers. Production использует PostgreSQL, mirror synced; Timeweb daily VPS backup принят владельцем как infrastructure/offsite layer. Конкретный runbook и ограничения — [4B local](stage-4b-local.md), [cutover](stage-4b-cutover.md).

Зависит от 4A. Первый существующий владелец становится обычным User; все production Collection/Wish-list/Covers/Favorites принадлежат ему. **Оба его раздела остаются public.** До открытия регистрации доступен один пользователь, но runtime уже применяет ownership. Session определяет user server-side; client-supplied owner ID не даёт прав. Все private GET/mutations, transfer, covers и favorite проверяют владельца; ошибки/conflict/duplicate responses не раскрывают чужие данные.

Обязательный план: capacity preflight → rehearsal в изолированной БД → freeze/drain writes → согласованный backup Sheets/Covers (включая `.holds`) и DB → создание User → импорт → counts/checksums/UUID/fields/Favorites/FK/file reconciliation → переключение runtime при закрытых writes → smoke/acceptance → открытие writes. Import manifest и stable import key обеспечивают безопасный повтор; другой snapshot/конфликт останавливает импорт, blind upsert запрещён. Не исправлять production rows вручную и не терять unresolved holds.

Covers остаются на VPS filesystem; binary в PostgreSQL не хранить. Сохранить существующие UUID paths с DB ownership mapping. Private/public media authorization обязательна для GET/HEAD; знание cover UUID не даёт доступа. Подготовка файлов, ссылки и cleanup учитывают отсутствие общей транзакции DB/filesystem; durable deletion jobs, защита от гонок, orphan cleanup и quotas обязательны.

PostgreSQL на существующем VPS, без Docker/ORM/PgBouncer, если capacity preflight не выявит препятствий. Базовый план — PostgreSQL 16 из Ubuntu packages, актуальный security minor; local-only доступ (предпочтительно Unix socket), отдельные runtime/migration/backup permissions, секреты вне Git, небольшой connection pool, timeouts, systemd integration, monitoring диска/памяти/connections/WAL/autovacuum. Установка и cutover требуют отдельного production шага.

Backup: Timeweb daily VPS disk backup — согласованный infrastructure/offsite layer; PG/Covers logical backups на VPS — daily, 7 daily + 4 weekly. Проверены pre-migration snapshots/archive, pg_dump и три actual restore rehearsal. RPO logical schedule — до 24 часов при успешных запусках; полный disaster RTO не измерен. Контролируются результат/возраст backup и ресурсы; S3/SFTP не подключены.

Tests: повтор/прерывание импорта, changed manifest, missing covers, точное сравнение данных, A/B/Guest UUID attacks, UI regression, restore. Rollback разделён: до новых PostgreSQL writes можно вернуть прежний runtime и неизменённые Sheets; после них Sheets могут отставать. После открытия writes rollback на Sheets требует freeze, PG backup, reconciliation и read-back gate. Совместимый PostgreSQL code rollback/forward fix остаётся предпочтительным; автоматический destructive downgrade не обещается.

### 4C — Registration / Auth / Recovery

**Статус: local implementation разрешена; local acceptance ожидается.** [Архитектура, benchmark, schema и acceptance](stage-4c-local.md). Commit/push/PR/merge/deploy пока не разрешены. Public registration после будущего deployment 4C остаётся disabled до lifecycle/privacy acceptance.

Зависит от 4B. ФИО необязательно; Email и Login обязательны и уникальны. Регистрация: **ФИО + Email + Login → email code → проверка → Password + repeat → активный account**. Основной вход — **Login + Password**. Recovery: Email → одноразовый код → проверка → новый пароль дважды → отзыв всех sessions → повторный вход.

Login: 3–30 ASCII символов, первая буква, далее `a-z`, `0-9`, `_`, `-`; trim/lowercase, case-insensitive unique. Reserved names покрывают реальные и планируемые routes (`collection`, `wishlist`, `api`, `assets`, `src`, `media`, `prototype`, `u`, `account`, `login`, `logout`, `register`, `verify`, `reset`, `forgot-password`, `admin`, `support`, `system`). Email: единая normalization policy для signup/recovery, trim, нормализованный domain, case-insensitive identity; не удалять точки/plus tags по правилам отдельных providers. Login и Email immutable в первой версии Stage 4.

Выбран Node built-in Argon2id: versioned hash, параметры по local benchmark, bounded concurrency. Password 12–128 Unicode code points, без trim/truncation/composition rules. Legacy scrypt остаётся только для временного owner bridge. Сохранить Secure/HttpOnly/SameSite cookies, CSRF, Host/Origin и trusted-proxy protections; sessions привязаны к User и хранятся в PostgreSQL, поддерживают expiry/revocation. Verification/reset: bounded TTL/attempts/resend, purpose separation, безопасное hashing/HMAC codes, short-lived grants, atomic single-use и cleanup. Plaintext passwords/codes/tokens не хранить в БД/логах.

Rate limiting по IP и уместным account/login/email/challenge dimensions; auth/email limits переживают restart. Enumeration resistance, email bombing/reset abuse/brute force/credential stuffing/username squatting и bounded hashing/email queues входят в MVP. Маленький global limit не должен быть основным ограничением всех пользователей; общие resource/provider ceilings остаются последним предохранителем. CAPTCHA автоматически не добавлять.

**Email provider выбран: Yandex Cloud Postbox, SMTP через Nodemailer.** Local/tests используют capture adapter; production запрещает capture. Настройка Cloud/DNS и реальные письма требуют отдельного production разрешения. Существующий SPF/MX Timeweb сохранять; DKIM values не придумывать. До подключения проверить квоты/доставку, DNS authentication и bounce/complaint handling.

Tests: registration/login/logout, normalization/uniqueness races, expiry/replay/resend, enumeration/limits, sessions после restart, reset/revocation. Deploy допускается с registration disabled; rollback отключает новые регистрации, но сохраняет accounts/data и совместимость auth schema.

### 4D — Оставшиеся profile/lifecycle задачи

Уточнение владельца 12.10.2026 переносит в текущую local 4C: `/auth` как кабинет, общий checkbox публичности двух списков, salePrice и его публичность, change password с current password/session rotation, hard delete с повторным паролем/confirmation и durable Cover cleanup. Реализация локальная; финальная acceptance и Postbox остаются открыты. [Текущий contract и матрица](stage-4c-local.md).

Удалённый login не переиспользуется; Email/Login immutable. Новые accounts private, прежний owner public. Configured/mirror owner защищён от удаления. Остаток 4D: редактирование необязательного ФИО и эксплуатационное завершение lifecycle/restore. Перед открытием production registration необходима процедура применения удалений и login reservations при restore старого backup, чтобы не восстановить удалённые accounts. Backup retention продолжает действовать. Bug Reports остаются отдельным storage без account cascade. Эти оставшиеся работы не начаты в данной задаче.

### 4D UX/Data polish — отдельный пакет после личного кабинета

**Статус: согласован, не начат.** Выполняется после acceptance кабинета/lifecycle и оставшихся release gates и до 4E Public Collections. Только точечные изменения принятого Stage 3 UI, без redesign и AI.

#### 1. Цена продажи и user-level visibility — перенесено в local 4C

По уточнению 12.10.2026 реализовано необязательное `salePrice` в Collection и Wish-list, независимое от purchasePrice. User-level checkbox default false определяет передачу гостям; owner видит заполненное поле всегда. UI/CSV используют доступную проекцию. Это заменяет прежний план только для Collection. Остальные пункты polish ниже не начаты.

#### 2. Обложка в Add flow

Для Add Collection/Wish-list убрать отдельный текст **«Обложка (необязательно)»**, кнопку выбора файла назвать **«Добавить обложку»**. В confirmation screen перед созданием записи не показывать действие удаления выбранной обложки: текущая неактивная кнопка **«Убрать файл»** должна отсутствовать.

Отдельный Cover flow существующей записи сохранить. Действие удаления назвать **«Удалить обложку»** и показывать только там, где обложка уже существует и её действительно можно удалить. Desktop/mobile semantics одинаковы; Add confirmation и управление существующей Cover не смешивать.

#### 3. Поясняющий текст фильтров

На mobile убрать **«Найдите нужные пластинки...»**. Если достаточно обычного responsive CSS, desktop оставить без изменений. Удаление текста на всех размерах допустимо только если раздельное поведение существенно усложнило бы компонент; отдельную сложную UI-логику не вводить.

#### 4. Data-driven порядок жанров в Add/Edit

Ранжировать допустимые жанры по реальному использованию конкретным User, считая частоту совместно по **Collection + Wish-list**. Использованные жанры идут первыми: более частые выше, при равной частоте — стабильная алфавитная сортировка. Затем идут остальные допустимые жанры. Это обычная data-driven сортировка, не AI functionality.

#### 5. Контекстный Genre filter

В фильтре Collection показывать только жанры, реально присутствующие в Collection User; в фильтре Wish-list — только присутствующие в его Wish-list. Отсутствующие жанры и empty/null значения не включать. В отличие от Add/Edit ranking, здесь Collection и Wish-list **не объединяются**.

#### 6. Add/Edit CTA

В Add переименовать **«Проверить и просмотреть» → «Добавить»**, в Edit соответствующую кнопку назвать **«Изменить»**. Обе кнопки по-прежнему сначала открывают confirmation screen: Add не создаёт запись немедленно, Edit не сохраняет изменения немедленно. Это требование относится к Add/Edit, а не к похожим действиям других flows.

#### 7. Цена покупки

Убрать helper **«0 — бесплатно»**. Формат и validation существующей цены покупки не менять.

#### 8. Placeholders Add/Edit

Привести формулировки к стилю уже используемых фильтров: Год альбома — **«Например, 1979»**; Год пластинки — **«Например, 1979»**; Дата покупки — **«Например, 20.09.2026»**. Validation semantics не менять.

#### 9. Favorites filter reset

Снятие checkbox **«Только избранное»** должно выполнять тот же reset filter/search state, что кнопка **«Очистить»**, вместо сохранения остальных фильтров. Очистить остальные активные filters/search, снять Favorite filter и показать исходную Collection. Поведение должно соответствовать «Очистить».

#### 10. UX safety rule — не угадывать компонент

При реализации **ОСТАНОВИТЬСЯ и запросить уточнение у владельца**, если по существующему коду/UX нельзя однозначно определить окно, dialog, confirmation screen, Cover component, кнопку, desktop/mobile variant или состояние Add/Edit. При необходимости попросить screenshot с выделенным элементом. Не изменять «похожий» компонент по предположению. Цель — минимальные точечные изменения существующего принятого UI, без redesign.

### 4E — Public pages и SSR

Зависит от 4B–4D, включая завершение отдельного 4D UX/Data polish. Канонические public URLs по уточнению владельца 11.10.2026: **`/{login}/collection`** (Collection), **`/{login}/wishlist`**. Прежние `/u/{login}/…` сохраняются как совместимые redirects. Кабинет: `/auth`. `/collection`, `/wishlist` остаются legacy compatibility; `/{login}` — redirect в Collection. Старые ссылки должны иметь контролируемую совместимость без выдачи чужих private данных; session-dependent redirects не кешируются как постоянные.

Public API — отдельный allowlist-контракт, независимый от наличия visitor session. На своей странице authenticated owner получает management controls через private API; пользователь A на странице B остаётся public visitor. Сохранить текущие девять public metadata fields (включая note), cover presentation и favorite только Collection; не публиковать record UUID, purchase fields, storeUrl, Email/ФИО. Private разделы/media не выдаются гостю. Цена продажи обоих списков добавляется в public allowlist только при user-level «Показывать цену продажи» = true; при false поле отсутствует в API и SSR projection, согласно текущему local 4C contract.

**Public Collection индексируется и сразу содержит каталог в initial server-rendered HTML.** Небольшой renderer в существующем Node stack, без большого frontend framework migration. Существующие table/mobile UI, search/sort, scrollbar, Covers, Favorite, Transfer, Streaming, Quote, CSV и Bug Report — regression contract; общего redesign нет. Обоснованное изменение — каталог при открытии public Collection; management pages сохраняют прежнюю отложенную загрузку. SSR использует только public projection и escaping.

Public Wish-list доступен по разрешению владельца, но **noindex и вне sitemap в первой версии**. Отдельные страницы пластинок не создаются. Daily Quote остаётся curated, без AI и анализа коллекции пользователя; Streaming остаётся общей read-only функцией с automatic RU → US, ambiguity handling, player lifecycle/cache/limits и прежним UX. CSV использует только доступную проекцию.

Tests: A/B/Guest, общий переключатель visibility обоих списков, public/private responses/media, ownership controls, raw HTML без JS, stale requests/logout/смена пользователя, desktop/mobile parity. Public registration открывается только после совместной acceptance auth/recovery, isolation, lifecycle/deletion и privacy; deployment 4C сам по себе её не открывает. Rollback — только к multi-user-safe PostgreSQL release, не к Stage 3 runtime.

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


</details>

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

Stage 4B local phase: [implementation/acceptance](stage-4b-local.md), [gated production runbook](stage-4b-cutover.md). Production переведён на PostgreSQL 04.10.2026; owner Sheets — односторонний mirror.

## Production authorization — 04.10.2026

Local acceptance 4B успешно принята владельцем. Git finalization и production phase разрешены с последовательными verification gates; cutover выполнен 04.10.2026; verification и cleanup пройдены, freeze снят. Backup decision: Timeweb daily VPS disk backup + проверенные logical PG/Covers backups на VPS (7 daily + 4 weekly) + one-way owner Sheets mirror. S3/SFTP и новые providers/dependencies не добавлять. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён. Более ранние требования отдельного offsite provider и ожидания local acceptance выше заменены этим решением. Freeze только непосредственно перед cutover, снять после verification.

Фактический release, verification, backup/monitoring и ограничения: [production report 4B](stage-4b-production.md).

### Stage 4C — исторический local scope 12.10.2026 (superseded)

> Заменён production DONE 15.10.2026; прежние запреты отражают только ту фазу.


Canonical `/{login}/collection` и `/{login}/wishlist`, root landing, `/auth` guest/account. Старые короткие и `/u/…` ссылки обслуживает один resolver. Общая публичность двух списков заменяет раннее решение о независимых переключателях. Кабинет, salePrice, change-password и fixture-safe deletion реализованы локально по прямому разрешению владельца. Production остаётся 4B, реальная Postbox delivery не включалась. [Итоговый local report / acceptance matrix](stage-4c-local.md). Stage 4C не закрыт; commit/push/PR/merge/deploy запрещены до отдельного acceptance.
