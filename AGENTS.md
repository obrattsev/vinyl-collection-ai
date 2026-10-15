# Работа над Vinyl Collection AI

> Authorization update 15.10.2026: maintenance fix and isolated tests accepted. Branch/commit/push/separate PR for maintenance tools, release checks and documentation authorized. Merge and all production mutations (maintenance, deployment, backup/restore, migrations, real email) remain prohibited pending separate approval. Functional Stage 4D scope unchanged. [Retry plan](docs/stage-4d-maintenance-retry.md).

> Current authorization 15.10.2026: owner VISUAL ACCEPTANCE complete (including package 1). Git branch/commit/push/PR and production READ-ONLY audit authorized. Merge, deployment, production changes and real emails require separate approval. LOCAL DONE / VISUAL ACCEPTED / PRODUCTION PENDING.

> Актуальное разрешение: локально исправить шесть UI замечаний visual acceptance (пакет №1), regression и desktop/mobile проверки обеих ролей; обновить существующий стенд без сброса данных. Production и любые Git publication operations запрещены. Повторная приёмка остаётся за владельцем.

> Последующее решение владельца 15.10.2026: весь функциональный scope Stage 4D принят и закрыт — **LOCAL DONE / PRODUCTION PENDING**. Финальные проверки и local manual stand подготовлены; ожидается пользовательская visual acceptance. Новые задачи не добавлять. Git finalization (commit/push/PR/merge) и production operations запрещены до отдельного согласования. [Итог](docs/stage-4d-final-readiness.md).

> Последующее разрешение 15.10.2026: предыдущие UI дополнения приняты Local DONE. Разрешена локальная реализация ежедневной статистики (предыдущий календарный день МСК, 10:00, Postbox, existing PG/systemd), только успешные авторизованные просмотры списков для DAU; hide protected delete button/точный новый текст без изменения server deletion rules. Production и commit/push/deploy запрещены. Сохранить прежние изменения, после реализации остановиться для приёмки.

> Последующее разрешение 15.10.2026: локально исправить пустые значения preview как `-`, auth flash Collection/Wish-list и привести Bug Report button к account button. Статистика 10:00 МСК и удаление первоначального владельца — только исследование/предложение; механизм удаления не менять. Все предыдущие локальные изменения сохранить. Production/Git operations запрещены.

> Актуальное разрешение 15.10.2026: жанры/фильтры приняты как Local DONE. Разрешена локальная визуальная приёмка desktop/mobile и обновление backlog; найденные проблемы сначала представить владельцу, код без согласования не исправлять. Текущий фон цитат полностью принят: замена, альтернативы и сравнение исключены из Stage 4D. Все прежние локальные изменения сохранить. Production и commit/push/merge/deploy запрещены.

> Последующее разрешение 15.10.2026: формы/обложки/тексты приняты как Local DONE. Разрешён только локальный жанровый фильтр по текущему доступному списку, frequency DESC/alphabetical ties, затем остановка для приёмки. Не менять правила поиска/сортировки пластинок, quotes/styles, Clear/Favorite и production; прежние локальные 4D.7/8/формы сохранить. Commit/push/merge/deploy не разрешены.

> Последующее разрешение 15.10.2026: 4D.8 принят как Local DONE, получатель подтверждён. Разрешены только локальные формы/обложки/тексты 4D.1/2/4 с остановкой для приёмки. Не менять quote/background, фильтры и production; никаких операций с двумя тестовыми S3 ресурсами (владелец удаляет сам). Commit/push/merge/deploy не разрешены; локальные 4D.7/8 сохранить.

> Разрешение владельца 15.10.2026 (последующее): 4D.7 принят как Local DONE; PR #32 разрешён к merge и слит после CLEAN/MERGEABLE проверки. Разрешена локальная 4D.8, затем остановка для приёмки. Production/реальные данные не менять. Проверка двух тестовых S3 ресурсов — только read-only; удаление не разрешено. Commit/push/PR для кода 4D не разрешены. Оформление цитат Collection/Wish-list принято, не менять.

> Разрешение владельца 15.10.2026: план 4D принят; реализовать локально только 4D.7 и представить результат перед переходом к 4D.8. Для десяти подготовленных Markdown-файлов разрешены commit/push/PR после проверки; merge и production не разрешены. Для кода 4D отдельного разрешения commit/push/PR нет. Эта запись заменяет прежнее ожидание согласования плана.

> Актуализация 15.10.2026: Stage 4C — DONE / PRODUCTION GO. Первоначальный выпуск `40ab34a19cd5d93d1c635ce1ee766011fc321e31`, затем routing/security fix PR #31; текущий production `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`. [Production report](docs/stage-4c-production.md). Roadmap: 4A/4B/4C DONE → 4D UX / DATA POLISH NEXT → 4E PUBLIC PAGES / SEO PLANNED → 5A → 5B → 5C → 5D. Старые статусы и планы ниже — исторические; при расхождении действуют эта запись и основной backlog. Разрешены только локальные изменения документации; код 4D, commit/push/PR/merge и production operations ожидают отдельных разрешений.

> Актуализация 12.10.2026: функциональность и UI Stage 4C приняты владельцем. Разрешена локальная Postbox-проверка на ранее согласованный адрес; прежний запрет реальных локальных отправок заменён этим разрешением. SMTP TLS/auth проверены; владелец подтвердил реальную доставку, регистрацию и recovery с отзывом прежней сессии. Production readiness gates остаются в отчёте. Stage 4C открыт; Git finalization и deployment запрещены. [Текущий отчёт и checkpoint](docs/stage-4c-release-readiness.md).

Актуальный статус 3E: deployment 02.10.2026 выполнен, технический production smoke пройден; [отчёт](docs/stage-3e-production.md). Финальная визуальная production acceptance подтверждена владельцем; Stage 3 закрыт. 4A реализован и принят владельцем по local acceptance; 4B production cutover и data verification выполнены 04.10.2026; 4C реализуется локально, local acceptance ожидается; остальные задачи 4D–4F и Stage 5 не начаты.


- Перед изменениями читать README, относящиеся к операции docs и backlog.
- Roadmap определяется docs/backlog.md. Этапы 1–3 завершены по подтверждению владельца; Stage 3 опубликован в runtime da16da2, production smoke и финальная visual acceptance пройдены, baseline 386/386. Архитектура Stage 4 согласована: 4A Data foundation; 4B Owner migration и production cutover; 4C Registration / Auth / Recovery; 4D Profile и account lifecycle; 4E Public pages и SSR; 4F SEO и release hardening. 4A реализован и принят владельцем по local acceptance; 4B production cutover и data verification выполнены 04.10.2026; 4C реализуется локально, local acceptance ожидается; остальные задачи 4D–4F и Stage 5 не начаты. AI, включая Dynamic Daily Quote с curated fallback, остаётся Stage 5.
- Соблюдать статусы документов. Не реализовывать неподтверждённые продуктовые решения; при неоднозначности спрашивать владельца. Продолжать независимую согласованную работу.
- Доступ к данным: UI → собственный API → слой доступа к данным → PostgreSQL в production с 04.10.2026. Sheets используются только отдельным mirror worker и Bug Reports; dual-write отсутствует. Не обращаться к Sheets API из браузера: UI использует внутреннюю модель без деталей Sheets и авторизации Google. Контракты — в README, общие модели, JSON mapping, правила UUID обеих коллекций, миграции и целостности данных — в docs/data-rules.md.
- Общие правила данных находятся в docs/data-rules.md; не дублировать их расходящимися версиями.
- Работать небольшими итерациями в отдельных Git-ветках; сохранять чужие и незакоммиченные изменения.
- Выполнять тесты, соответствующие изменению, проверять git diff --check и содержимое diff; сообщать результаты review и ограничения.
- Различать «согласовано», «реализовано» и «проверено». Завершённость этапа 1 не означает реализации будущих задач этапов 2–5.
- Не хранить ключи и секреты в Git или браузерном коде. Подключение реальных таблиц и изменения данных должны соответствовать согласованному сценарию подтверждения.
- Обычный GET не создаёт и не исправляет ID. Текущим таблицам миграция не нужна; legacy-миграция — условная отдельная работа вне этапов при появлении записей без UUID. Приложение нельзя делать публично доступным до защиты всех изменяющих данные коллекций API аутентификацией owner; выбраны пароль owner, серверная сессия и CSRF; актуальный контракт и acceptance — docs/stage-2-auth.md.
- Не расширять продукт, не публиковать приложение и не включать AI раньше согласованного этапа.

- Пакет 3B: согласованный публичный POST /api/bug-reports имеет отдельную same-origin политику и лимиты; не даёт прав на коллекции. Контракт — docs/stage-3b-spec.md. Реальный документ reports подключён и проверен в production по подтверждению владельца; долг закрыт.

- 3E — последний функциональный пакет Stage 3: динамический read-only iTunes lookup → официальный Apple iframe по нажатию → постоянная внешняя ссылка. Без MusicKit, audio proxy/cache и streaming fields в моделях/Sheets/CSV. Контракт docs/stage-3e-spec.md. Controlled rollback: UI baseline fb073db. Desktop: прежняя таблица/CRUD + отдельный Streaming dialog только через Album; Cover — прежний 3D dialog без Streaming. Разрешённые table fixes: native scrollbar и общий горизонтальный layout row actions вместо вертикального override Wish-list; mobile: compact list → полный detail со Streaming. RU → US fallback автоматический по одному клику. Последние разрешённые изменения Stage 3: optional Cover только при Add Collection/Wish-list через прежний Cover pipeline после подтверждённого metadata POST, и primary variant mobile Transfer без смены геометрии. После них функциональный scope Stage 3 заморожен. Local acceptance всех финальных правок пройдена. 02.10.2026 владелец разрешил commit/push/PR/merge/deployment и подтвердил приостановку owner writes на время выпуска. Реальные изменяющие acceptance-операции не входят в выпуск. Принятый Stage 3 UI — regression contract Stage 4; общий redesign не выполнять. Исторический scope 4A: local acceptance и Git finalization без deployment. Production cutover выполнен позднее в 4B. AI остаётся Stage 5.

- Stage 4B local phase разрешена: код/migrations/tests/docs/fixture stand. Local acceptance пройдена; commit/push/PR/merge и production phase со swap/cutover разрешены владельцем; Timeweb daily VPS backup принят владельцем как infrastructure/offsite layer. Архитектура: docs/stage-4b-local.md; runbook: docs/stage-4b-cutover.md.

## Production authorization — 04.10.2026

Local acceptance 4B успешно принята владельцем. Git finalization и production phase разрешены с последовательными verification gates; cutover выполнен 04.10.2026; verification и cleanup пройдены, freeze снят. Backup decision: Timeweb daily VPS disk backup + проверенные logical PG/Covers backups на VPS (7 daily + 4 weekly) + one-way owner Sheets mirror. S3/SFTP и новые providers/dependencies не добавлять. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён. Более ранние требования отдельного offsite provider и ожидания local acceptance выше заменены этим решением. Freeze только непосредственно перед cutover, снять после verification.

Фактический release, verification, backup/monitoring и ограничения: [production report 4B](docs/stage-4b-production.md).

## Stage 4C local phase

Local implementation разрешена; acceptance владельца ожидается. [Schema, Argon2 benchmark и local acceptance](docs/stage-4c-local.md). Production остаётся 4B; public registration disabled, legacy owner bridge до отдельной production acceptance. Postbox выбран, но Cloud/DNS/email setup не выполнялся. Commit/push/PR/merge/deploy в этой фазе запрещены.

Уточнение scope 12.10.2026: по прямому запросу владельца в local 4C включены `/auth` кабинет, общая публичность Collection/Wish-list, salePrice, смена пароля и удаление с durable Cover cleanup. Это заменяет ранние независимые toggles/URL-планы; остальные 4D polish, SSR/SEO и AI не начинались. [Текущий contract и acceptance matrix](docs/stage-4c-local.md). Реальные Postbox отправки в этой задаче запрещены; production не менять.
