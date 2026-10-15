# Stage 4D — план локальной реализации, 15.10.2026

**Статус: предложен, ожидает согласования. Код не изменён.** Единственный backlog — [backlog.md](backlog.md); здесь последовательность реализации и приёмки, а не второй tracker. 4C DONE по [production report](stage-4c-production.md). Новых production checks в этом цикле нет.

## Порядок и разумная группировка

1. **4D.7, HIGH — release safety.** Сначала локальный runbook/helpers на текущем single-process deployment, проверка schema compatibility и сохранения PG sessions. Это основа следующих выпусков, без изменений VPS.
2. **4D.8, HIGH — reports + Postbox.** Сохранить существующие authenticated UI/API и Sheets storage; добавить identity/page, persistent notification state, bounded retry и deduplication. Сначала решить recipient и минимальное место хранения состояния, затем реализовывать. Новый provider/queue/service не нужен.
3. **4D.1/2/4 — формы, Cover и copy.** Одна компактная итерация для обоих списков: labels/CTA/placeholders, Cover actions и отсутствие неактивной кнопки в confirmation. Сохранить preview, validation, UUID/revision и существующий Cover pipeline.
4. **4D.3 — genres/filter state.** Отдельная итерация, поскольку данные/доступ важнее copy: scoped frequencies, только присутствующие filter genres, стабильные ties. Favorite reset через «Очистить» уже есть — regression, не повторная разработка.
5. **4D.5/6 — итоговая локальная приёмка.** Desktop/mobile, loading/empty/errors, owner/guest/A/B privacy, подходящие suites и diff review. Владелец принимает локальный результат; Git/release/deployment затем отдельно разрешаются.

Итерации выполняются последовательно. Это группировка работы, не разрешение на PR/commit и не обязательное число PR.

## Минимальный release process для 4D.7

Исходное состояние по `docs/deployment.md`: nginx → один Node process на loopback, systemd, immutable `/opt/vinyl-collection-ai/releases/<SHA>`, current symlink, env вне release, filesystem Covers вне release. Сессии уже в PostgreSQL; текущие auth config и secret остаются стабильными. Существуют pg-migrate/backup/freeze/mirror helpers и checksum/advisory-lock migrations. Это read-only анализ кода/runbook, не новая инспекция VPS.

Предлагается один короткий checklist и небольшой операторский helper на существующем Node/shell, если он сокращает ручные ошибки. Blue/green и второй app process не вводятся. Один процесс при restart допускает краткий downtime; длительность определяется локальной rehearsal и фактическим окном, zero-downtime не обещается.

### Reviewable checklist до любого будущего разрешённого выпуска

- Зафиксировать целевой SHA, прошлый совместимый runtime, lockfile, tests и scope; собрать artifact/Linux dependencies заранее вне активного release. Не запускать production из незакреплённой рабочей копии.
- Preflight: app/PG resources, schema checksums, отсутствие незавершённого backup/freeze, состояние mirror/backup timer, auth config presence без значений. Зафиксировать исходные состояния для точного возврата. Не менять AUTH_SECRET и не очищать PG sessions при обычном code update.
- Проверить backup по действующему процессу; не совмещать backup freeze с ручным maintenance. Совместимость target/current/schema описать до switch. При migration использовать существующий migrator с advisory lock, checksum и privileged connection; runtime права не повышать.
- Additive совместимую migration подготовить с ограниченным lock/statement timeout. Если старый binary не совместим с расширенной schema или migration destructive/долгая — отдельное окно и решение до запуска, не автоматический эксперимент на живой БД. Каждая migration транзакционна отдельно, пакет не обещает общей atomicity.
- Перед switch управляемо остановить/drain новые mutations настолько, насколько позволяет текущий механизм; подтвердить отсутствие in-flight writes. Если код не обеспечивает безопасный drain, включить в минимальные локальные изменения короткий maintenance/admission gate, сохраняя read availability где возможно. Mirror не должен пересекаться с несовместимым DDL; не менять mirror данные ради smoke.
- Переключить current на подготовленный artifact, restart приложения; существующие nginx/systemd/env/storage пути сохранить. Остальные службы менять только при необходимости и отдельном согласовании.
- Автоматизированный **read-only smoke** с timeout и ожидаемыми status/redirect: root/auth, static assets, guest denial unscoped API, explicit public profile по настроенному fixture, auth/session response без печати cookies/PII. Не включать реальную регистрацию, reset, delete, sends и owner mutations. Authenticated session persistence доказать на локальном fixture/rehearsal; production сессия только в явно согласованном сценарии.
- Проверить app health/resources, mirror состояние/сходимость, backup timer и отсутствие зависшего freeze/maintenance. Если timer/worker временно остановлены — вернуть записанное исходное состояние. Зафиксировать SHA, время окна, результаты и ограничения.

### Failure и rollback

При провале smoke закрыть mutations и оценить совместимость. Вернуть current на предыдущий **совместимый multiuser** release и restart; повторить read-only smoke. Не откатывать автоматически БД, не выполнять down migrations/restore и не включать 4B binary после multiuser writes. Если предыдущий app несовместим со schema — STOP и forward fix/решение владельца при закрытых writes. Не удалять принятые пользовательские данные, auth sessions или Cover resources для «исправления» проверки. Backup restore остаётся отдельной аварийной процедурой с quarantine/recovery и принятым риском старых удалений.

### Локальная проверка release helpers

На маркированной изолированной PG DB и fixture Covers воспроизвести success switch, startup failure, failed smoke, compatible rollback, migration checksum mismatch/lock timeout и несовместимую schema. Проверить session до/после restart с тем же AUTH_SECRET, неизменность fixture rows/revisions/Covers и отсутствие автоматического DB downgrade. Для systemd/SMTP/Sheets использовать mocks/локальные adapters там, где настоящий сервис не нужен. Новые production smoke этим планом не разрешаются.

## Reports: минимальный дизайн перед реализацией 4D.8

Хранение report остаётся существующим Sheets flow. Сейчас пять колонок: id/time/text/section/version; user identity/page и notification status отсутствуют. Сначала документировать совместимое расширение storage и server contract, включая судьбу уже существующих rows. Изменение реальной Google Sheets schema — отдельное разрешение, локальные fixtures разрешены после принятия плана.

Server session задаёт userId/email, клиент не выбирает identity. Recipient — фиксированная конфигурация, выбранная владельцем. From — существующий Postbox sender; безопасный text body, HTML только с escaping при необходимости, без пользовательских header fields. Page принимать только как нормализованный same-site путь без чувствительных query/token параметров. Дата/timezone явно обозначены.

Для повторов: request id/idempotency привязаны к user и содержимому; повтор с тем же ключом возвращает прежний accepted report, несовпадающее содержимое конфликтует. Сохранение report предшествует email; persistent pending/sent/error/attempt state позволяет bounded retry после restart. Предпочесть поля рядом с существующим report, если API/конкуренция позволяют; иначе предложить минимальное применение существующего PG без новой базы/сервиса. Не обещать exactly-once SMTP delivery при потерянном подтверждении; повтор письма возможен, duplicate reports предотвращаются. SMTP failure не отменяет accepted report, UI не провоцирует повторный submit.

Тесты: anonymous/expired session/CSRF/Origin denial; A/B server identity; concurrent/replayed submit и lost HTTP response; accepted report + SMTP error/timeout/restart/retry; 429 и quotas; text/header/formula injection; фиксированный recipient и отсутствие секретов. Отдельная acceptance после разрешения: один тестовый report в согласованном storage + реальная доставка владельцу через существующий Postbox; не использовать owner для destructive tests.

## Визуальные и data gates

Проверять Collection и Wish-list на desktop и mobile, пустые/загруженные/error состояния, Add/Edit preview/cancel/conflict, Cover no/add/replace/delete/error. Изображение потёртых конвертов уже есть и связано с quote block страниц коллекций; root landing отдельного quote block не содержит. Визуальное соответствие и точный целевой блок подтвердить у владельца, новый дизайн не предлагать автоматически.

Filter genres строятся только по доступному каталогу. Add/Edit ranking своего пользователя учитывает оба его списка, visitor не должен читать закрытый список ради частоты. Проверить пустые жанры, ties, дополнительный жанр, no favorites, combined filters, reset/logout/stale response. Переключение favorite checkbox не расширять новым reset поведением без решения владельца.

## Решения владельца до зависимых изменений

1. Принять порядок 4D.7 → 4D.8 → 4D.1/2/4 → 4D.3 → 4D.5/6 либо скорректировать приоритеты.
2. Указать email получателя уведомлений и разрешённый адрес для будущей проверки доставки; старый owner email автоматически не назначать.
3. Подтвердить, что «блок цитат на главной» означает существующий блок страниц Collection/Wish-list; если имеется в виду root `/`, уточнить отдельно без начала redesign.
4. При локальной спецификации зафиксировать единицу genre frequency (рекомендация: число записей с жанром, без двойного счёта одинаковых primary/additional в одной записи) и конкретное место действия Delete Cover в Edit, если UI неоднозначен.

Прежний Wishlist noindex сохраняется для 4E; редактирование ФИО и прочие profile enhancements deferred. Это не блокирует подготовку 4D. Git и production разрешения не входят в согласование локального плана. После подготовки документации работа остановлена до ответа владельца.
