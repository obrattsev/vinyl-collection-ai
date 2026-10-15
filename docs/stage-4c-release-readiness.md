# Stage 4C — Full release candidate, 14.10.2026

> Актуализация 15.10.2026: Stage 4C — DONE / PRODUCTION GO. Первоначальный выпуск `40ab34a19cd5d93d1c635ce1ee766011fc321e31`, затем routing/security fix PR #31; текущий production `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`. [Production report](stage-4c-production.md). Roadmap: 4A/4B/4C DONE → 4D UX / DATA POLISH NEXT → 4E PUBLIC PAGES / SEO PLANNED → 5A → 5B → 5C → 5D. Старые статусы и планы ниже — исторические; при расхождении действуют эта запись и основной backlog. Разрешены только локальные изменения документации; код 4D, commit/push/PR/merge и production operations ожидают отдельных разрешений.

**Статус: CONDITIONAL GO для release candidate. Deployment пока не разрешён.**

Окончательное решение владельца заменяет прежние планы обязательного deletion ledger, Yandex Object Storage и Limited mode. Выпускается весь согласованный Stage 4C, включая самостоятельное удаление аккаунта. Новые облачные ресурсы/ключи/базы не нужны. Исследования S3 прекращены. Restore-recovery: **LOCAL ACCEPTED / INTEGRATION PENDING**; адаптация без ledger проверена локально.

## Состав релиза

Новая landing; принятый дизайн Collection/Wish-list и фон цитат; email registration/OTP; login/logout; кабинет; email password recovery; смена пароля; самостоятельное удаление; персональные Collection/Wish-list; публичность; отображение sale price; ownership/CSRF/Origin/rate limits. UI удаления, API `/api/auth/delete-account` и сервисный `remove` остаются включены. Protected owner и mirror owner по существующему контракту не удаляются.

Принятый дизайн не менялся в этой итерации. Согласованные отклонения от макета сохранены; новый редизайн не выполнялся. Существующие UI/routing regression прошли. Повторная ручная визуальная приёмка в этой итерации не выполнялась.

## Принятое архитектурное ограничение

**Владелец осознанно принял:** восстановление PostgreSQL из backup до удаления может вернуть удалённый аккаунт, его данные и прежние reservations. Без независимой истории невозможно достоверно обнаружить все такие удаления. Это больше не release blocker. Не обещаем необратимость удаления относительно старого backup и не обещаем бессрочное резервирование логина через произвольный rollback базы.

Из текущей PostgreSQL удаление выполняется одной owner transaction: проверяются сессия/пароль/owner, сохраняется durable cover_cleanup, удаляются оба списка, Cover metadata, auth flows/OTP, User и каскадные auth/sessions/quarantine/grants. Login reservation остаётся в текущей базе. SQL ошибка откатывает весь DB этап; физический cleanup начинается только после commit. Сбой filesystem возвращает cleanupPending и оставляет информацию для retry. Повторный/конкурентный запрос не удаляет чужие данные и не использует отозванную сессию.

Production preflight: auth schema и cover_cleanup отсутствуют, 1 пользователь, migrations=2. Production работает на Stage 4B; признаков прежних production account deletions через Stage 4C нет. Это не forensic-доказательство отсутствия когда-либо выполненного ручного SQL, но оснований требовать S3 reconciliation перед этим релизом не найдено.

## Минимальные изменения

- Startup больше не требует ledger. Сохранены PostgreSQL/multiuser, production ACK/DB policy, HTTPS origin, сильный отдельный AUTH_SECRET, SMTP credentials/probe, явные registration/legacy flags. При явно injected непригодном adapter startup по-прежнему отказывает; штатный release его не подключает.
- Account-store уже поддерживал транзакционное удаление без ledger: работающий flow не переписывался. Исторические optional mock-ledger code/tests оставлены неактивными; это не вторая продуктовая архитектура и не инфраструктурная зависимость.
- Restore без ledger использует тот же quarantine transaction, но не реконструирует неизвестные удаления. Старые sessions/flows/OTP удаляются, auth_version повышается, пароли блокируются status=disabled, обе публичности выключаются. Повторный restore создаёт новый epoch и отзывает grants.
- Rehearsal CLI после восстановления применяет актуальные migrations перед quarantine. Это изолированный test-only инструмент, не production restore command.
- Mirror проверяет карантин своего owner перед каждым reconcile, под shared maintenance lock на весь внешний проход. Restore берёт exclusive lock. Даже уже работающий worker не выгружает данные quarantined owner. После recovery владельца существующий private owner archive может синхронизироваться; публичность сайта автоматически не включается.
- Для старой 4B DB без auth schema mirror сохраняет совместимость. Если auth schema есть, а restore schema отсутствует, worker отказывает до миграций. Startup safety нельзя заменить флагом обхода.

## Restore и backup

1. Остановить writers/app/mirror/cleanup, закрыть внешний ingress **до** восстановления. Disk restore может вернуть старый binary и автозапуск: это должно контролироваться оператором вне восстанавливаемого состояния.
2. Восстановить доверенный backup изолированно, проверить checksums/данные/Covers; применить актуальные migrations и grants.
3. Выполнить `quarantineRestoredAuth`/существующий restore flow. Не открывать сайт с восстановленными sessions до этой операции. Не снимать freeze автоматически.
4. Проверить новый epoch, отсутствие старых sessions/OTP, disabled auth, private списки и отказ mirror. Открывать только текущий release после проверок.
5. Новый OTP на ранее подтверждённый email → отдельный grant текущего restore → новый пароль. Прежний пароль повторно выбрать нельзя. Обычный disabled не eligible. Обе публичности остаются private до действия владельца.

**Ограничение:** если удалённый аккаунт вернулся из старого backup как active, quarantine включит его в recovery наравне с остальными. Внешней информации для исключения нет — именно этот риск принят. Уже находящиеся в Sheets архивы и ранее выданные клиентам данные нельзя отозвать блокировкой нового mirror. Mirror не является public API и не заменяет полный PG backup. Данные после даты backup могут быть потеряны.

## Удаление по обращению пользователя

Предпочтительно подтвердить владение аккаунтом штатным email recovery и выполнить удаление в кабинете. Если это невозможно, оператор отдельно подтверждает личность/UUID и полномочия; ручной запрос не исполняется автоматически и не допускает удаления по одному названному email. После отдельного согласования использовать те же транзакционные правила удаления, reservations и durable cover cleanup, проверить отзыв сессий. В этой задаче реальных удалений не было.

Объяснять: данные удаляются из активной БД, старые backups сохраняются по действующей политике. Не обещать немедленного удаления из всех исторических копий. При аварийном restore оператор учитывает известные обращения до открытия сайта, насколько они доступны; это организационная мера, не полный независимый журнал и не гарантия обнаружения всех удалений. Новый сервис/журнал не вводится, существующие backups не редактируются.

## Результаты локальных проверок

- Полный regression: **433/433**.
- PostgreSQL integration: **87/87**.
- Registration/login, recovery/change password, CSRF/Origin, rate limits, privacy/ownership/API/Covers, UI/routing: существующие suites прошли.
- Новые проверки: SQL failure после удаления дочерних rows полностью откатывает удаление; concurrent/repeated delete без S3; потеря доступа после удаления; другой пользователь сохраняет данные.
- Restore-recovery без S3: новый OTP/grant, неправильный/истёкший код, replay/expiry, старые credentials, повторный restore; существующие SMTP mocks.
- Mirror: после quarantine ни одного adapter call; после recovery синхронизация проходит, private settings сохраняются. CLI также не обходит карантин. Старые 4B retry/drift/concurrent-generation сценарии проходят.
- Production-config startup с mock SMTP работает без ledger; unsafe configuration по-прежнему отклоняется. Это не запуск нового приложения на VPS.
- npm audit: **0 vulnerabilities**.
- `git diff --check`: успешно; secrets scan и review изменённых исходников: credentials не добавлены.

Тесты используют существующую маркированную test DB и синтетические данные. Новые базы/облачные ресурсы не создавались. Реальных SMTP писем в этой итерации не отправляли; ранее Postbox delivery/registration/recovery приняты владельцем. Полные suites повторно прогнаны из-за изменения security boundaries.

## Read-only production configuration preflight

SSH — ранее согласованный `root@194.87.83.158`, BatchMode. Production не менялся.

- Release: `2ccb47b50cb3903d1542a273a84d963d4d98cc36`.
- App active, NRestarts=0, MemoryCurrent=104222720 bytes на момент проверки.
- PostgreSQL отвечает; users=1, migrations=2, user_auth отсутствует, cover_cleanup отсутствует.
- NODE_ENV=production, DATA_BACKEND=postgres, APP_ORIGIN=https://vinyl-collection.ru, MIRROR_ENABLED=true.
- OWNER_PASSWORD_HASH и DATABASE_URL присутствуют; значения не выводились.
- AUTH_SECRET, POSTBOX_KEY_ID, POSTBOX_KEY_SECRET отсутствуют. AUTH_MODE, AUTH_REGISTRATION_ENABLED, AUTH_LEGACY_ENABLED, EMAIL_ADAPTER не заданы.
- В просмотренной конфигурации нет ссылок на тестовый Timeweb bucket/endpoint. Это не разрешение на cleanup его ключей.

**Фактические deployment gates:** production пока не настроен для 4C. Нужны env, migrations 003–005, runtime/backup grants, безопасная активация текущего owner, SMTP probe и контролируемый smoke. Новый release с нынешним env не должен запускаться. CPU/Linux native-memory профиль проверяется при согласованном rollout: локальный Mac RSS benchmark не доказывает hard cgroup поведение VPS 512 MiB. Не снижать KDF автоматически.

## Порядок будущего deployment (отдельное разрешение)

1. Принять этот RC и отдельно разрешить Git finalization/deploy. Зафиксировать выбранный SHA; проверить актуальный production release, env и backup/restore артефакты.
2. Подготовить существующие backup/checksums и изолированную rehearsal без новых облачных сервисов. Согласовать окно maintenance, остановить writers и mirror; не запускать restore на production ради теста.
3. Применить migrations 003–005 и authGrants к runtime/backup ролям. Новых migrations сверх ранее принятой 005 в этой итерации нет.
4. Без вывода секретов настроить AUTH_MODE=multiuser, отдельный AUTH_SECRET, EMAIL_ADAPTER=smtp, POSTBOX_KEY_ID/SECRET, явные registration/legacy flags; сохранить существующие PG/Sheets/Covers/Bug Reports настройки. SMTP check должен пройти до открытия регистрации.
5. Текущий production owner не имеет user_auth. Выполнить уже существующий owner activation в закрытом окне: registration=false, legacy=true, действующий owner login → email OTP → пароль. Затем legacy=false, registration=true и restart. Не открывать общий release с незавершённой owner activation. Не выполнять это в рамках текущей задачи.
6. Запустить проверенный release, проверить startup/ресурсы, owner login, guest privacy, публичные страницы, CSV/Covers authorization, mirror и отсутствие технических ошибок SMTP. Новые write-smoke операции требуют отдельно согласованных тестовых пользователей; не удалять реального owner.
7. Открыть ingress/снять freeze после проверок, продолжить существующий backup режим. Никаких S3 credentials/flags не нужно.

## Rollback

До регистрации новых пользователей допустим откат release по согласованному runbook с закрытым ingress и проверкой совместимости schema/grants. После начала 4C writes нельзя слепо вернуть 4B binary: он не знает multi-user privacy/auth. Предпочтительны остановка ingress и исправление/возврат совместимого 4C release. Если необходим DB restore — только quarantine/recovery выше с явно принятым риском возвращения старых удалений. Не возвращать старые сессии/публичность ради быстрого открытия.

## Вывод

**CONDITIONAL GO:** локальный full RC готов, S3 не blocker. Критических дефектов в пройденных тестах не найдено. Production-конфигурация ещё требует перечисленных подготовительных действий и rollout verification; без них deployment не готов. Git, deployment, production/DNS/backups и реальные данные этой работой не изменялись. Stage 4C не объявляется опубликованным.


## Production release preparation

14.10.2026: выполнен повторный read-only preflight; точный порядок конфигурации, backup/migrations, owner activation, smoke и rollback — [deployment plan](stage-4c-deployment-plan.md). CONDITIONAL GO сохраняется; перед maintenance и любыми production changes необходимо отдельное разрешение. Код не менялся, тесты без необходимости не повторялись.


14.10.2026: владелец разрешил Git finalization и controlled production rollout по этому плану, включая backup/rehearsal, migrations/grants, env, owner activation и disposable smoke. STOP conditions сохраняются; итог rollout фиксируется отдельно.
