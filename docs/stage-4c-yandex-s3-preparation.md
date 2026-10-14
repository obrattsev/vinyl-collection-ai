# Stage 4C — Timeweb inventory / Yandex test configuration (отменённый план)

**14.10.2026: план Yandex/S3 отменён окончательным решением владельца. Ресурсы не создавать, исследования не продолжать. Ниже исторические результаты, не текущий release gate. См. stage-4c-release-readiness.md.**

14.10.2026. Только подготовка и чтение. Restore-recovery: **LOCAL ACCEPTED / INTEGRATION PENDING**. Production: **NO-GO**. Код recovery/ledger не изменён.

## Timeweb: факты текущей проверки

Read-only S3/IAM API, 14.10.2026 10:01 UTC:

- `vinyl-ledger-test-20261013` существует; в доступном S3 account виден только этот бакет. Панель подтверждает Standard, Private, лимит 1 ГБ.
- 34 ключа, 43 версии, 2 delete markers, суммарный размер версий 4718 байт. Префиксы `journal/` и `outside/` (последний — отрицательные тесты доступа).
- Versioning Enabled; Object Lock Enabled; default COMPLIANCE 1 день.
- GetObjectRetention проверен для каждой из 43 версий: все ещё защищены, истёкших/неизвестных нет. Максимальный RetainUntilDate: **2026-10-15 19:09:59.961894 UTC**. Это фактическое значение API, а не расчёт по имени бакета. Перед cleanup повторно читать retention; срок может измениться.
- IAM list_users показывает `vinyl-ledger-test-runtime`. Администратор — существующая учётная запись S3; не считать её одноразовым тестовым пользователем.
- Использованы ранее сохранённые тестовые credentials из защищённого локального файла; значения не выводились. Новых ключей и тестовых объектов не создавалось.

Последняя согласованная цена Timeweb — **1 ₽/месяц** за Standard 1 ГБ плюс исходящий трафик. Бакет остаётся выделенным; окончательная текущая детализация списаний в Billing в этом проходе не подтверждена. Возможная экономия после удаления — этот тариф, если он не менялся; не обещать прекращения списаний только от очистки объектов.

В локальных server/scripts/env и конфигурации не найдены ссылки на имя бакета/Timeweb endpoint; текущий app не имеет подключённого реального Timeweb adapter. Диагностические скрипты используют отдельные локальные credentials. Production env/processes заново не инспектировались, поэтому отсутствие любых других потребителей ключей пока не доказано. Это обязательная проверка перед отзывом ключей, а не основание менять VPS.

Кандидаты на последующее удаление, только после отдельного согласования и успешных Yandex tests:

1. Все тестовые версии и delete markers, после фактического окончания retention; обычный DELETE ключа не очищает историю.
2. Пустой тестовый бакет — прекращение оплаты выделенного ресурса подтвердить в панели.
3. Ключи и `vinyl-ledger-test-runtime`, после проверки отсутствия других потребителей.
4. Локальная тестовая конфигурация/credentials и временные diagnostic artifacts, после сохранения обезличенного отчёта.

Администратора S3, VPS, backups, Postbox и production данные не удалять. Других облачных тестовых ресурсов доступные S3/IAM списки не показали; это не глобальная инвентаризация всех сервисов Timeweb.

## Yandex: точная предлагаемая конфигурация

- Бакет: `vinyl-ledger-yc-test-20261014-9c299b80`. Глобальная доступность имени проверяется перед созданием; сейчас не резервировалось.
- Существующий согласованный folder проекта, регион Россия, S3 endpoint `https://storage.yandexcloud.net`, SigV4 region `ru-central1`.
- Standard; максимальный размер **1073741824 байт (1 GiB)**. Не считать этот лимит ограничением платы за запросы/трафик.
- Private ACL; публичное чтение, listing и статистика выключены; без anonymous grants.
- Versioning Enabled, Object Lock Enabled, DefaultRetention `{Mode: COMPLIANCE, Days: 1}` **до первой записи**.
- Без CDN, website, CORS, lifecycle rules, дополнительных сервисов и customer-managed KMS key. Никаких production подключений.
- Только synthetic UUID/login, небольшие JSON в `journal/`; PUT с Content-MD5; после ACK получить VersionId, прочитать конкретную версию и проверить retention.
- Тестовый runner ограничить ≤1000 PUT/LIST, ≤5000 GET/HEAD, ≤10 MiB данных/трафика; retries ограничены. Никаких бесконечных polling/нагрузочных тестов.

Object Lock защищает версии, не запрещает новые версии того же ключа или delete markers. COMPLIANCE нельзя сократить/снять до срока даже администратору. Default retention допускает переопределение при PUT: отдельно проверить, что runtime не может загрузить более слабо защищённую версию. До проверки не считать этот security gate закрытым.

## Runtime и административные права

Создать только один новый SA `vinyl-ledger-yc-test-runtime` и один static access key (Access Key ID + Secret). Не использовать Postbox SA/ключ. Runtime не выдавать folder-level `storage.editor`/`storage.admin` или общие роли на другие бакеты.

Предлагаемый access contract через bucket policy, Principal — ID этого SA:

| Область | Разрешения |
|---|---|
| `arn:aws:s3:::vinyl-ledger-yc-test-20261014-9c299b80/journal/*` | `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion` |
| только бакет | `s3:ListBucketVersions` с `StringLike: {s3:prefix: journal/*}`; `s3:GetBucketLocation`, `s3:GetBucketVersioning` |
| защита | чтение Object Lock configuration и retention конкретной версии; точное отображение прав в Yandex проверить до признания policy пригодной |

Явные запреты runtime на DeleteObject/DeleteObjectVersion и изменение ACL/Versioning/lifecycle/policy/защиты. Не выдавать admin ради успешного metadata GET. Документированный список policy actions не перечисляет весь Object Lock API; нельзя вслепую объявить AWS actions `GetObjectRetention`/`PutObjectRetention` поддержанными Yandex. Если узкую policy нельзя применить — STOP, без автоматического расширения.

Префиксные Resource и `s3:prefix` документированы. Реальная изоляция ListBucketVersions (включая запрос без prefix), version GET вне journal/, изменение retention/ACL через PUT headers и запрет удаления ещё не проверены. Наличие IAM роли само по себе не доказывает эти ограничения. Runtime не получает общий WRITE ACL. Все альтернативные пути IAM/ACL должны быть проверены отрицательными тестами.

Администратору для setup нужны права создавать bucket и управлять его versioning/lock/policy (`storage.admin` в выбранной области), создавать SA (`iam.serviceAccounts.admin`) и выпускать static key для него (`iam.serviceAccounts.accessKeyAdmin`, либо уже имеющиеся эквивалентные права). Эти полномочия не передаются runtime. Дополнительный административный SA/ключ по умолчанию не создаётся: использовать существующую авторизованную административную сессию/CLI; если её недостаточно для теста — отдельно согласовать.

Секреты хранить вне repo, в отдельном локальном каталоге 0700 и файле 0600; не выводить в чат, отчёты, argv или HTTP debug. Новые секреты пока не существуют.

## Стоимость и условия согласования

Официальная pricing page подтверждает ежемесячно бесплатные 1 GiB Standard, 10000 PUT/POST/PATCH/LIST, 100000 GET/HEAD/OPTIONS, 100 GiB исходящего трафика. В пределах неиспользованных квот предложенный тест ожидаемо стоит **0 ₽**. Остатки квот конкретного billing account не проверены; нельзя считать квоты выделенными отдельно каждому бакету.

Сверх квот оплачиваются хранение всех версий, операции (включая 403/404) и egress. Точные актуальные платные ставки пока **не подтверждены**: динамический прайс-лист вернул «Нет данных», консоль initially показывала ошибки загрузки. Числа в примерах расчёта pricing page не выдаются за действующий тариф. Перед созданием обязательно подтвердить ставки/остатки в панели; при платном варианте представить расчёт и запросить согласование. Не заявлять безусловный нулевой счёт.

Лимит размера бакета не ограничивает число запросов. Budget alert — уведомление, а не гарантированный hard stop. Предложенные ограничения runner уменьшают тестовые расходы, но не являются финансовым лимитом провайдера.

## Разрешение, которое потребуется

Отдельно согласовать: создание указанного private test bucket, SA и одного static key, настройку узкой policy, а затем synthetic cloud-write integration tests. Подтверждение стоимости в панели — предварительный gate. Timeweb cleanup в это разрешение не входит. До разрешения ничего не создавать.

Тесты проверят запись/VersionId/GET, immediate full version listing с обеими pagination markers и остановленными writers, другой клиент, одинаковые/разные concurrent keys, markers, retention/permissions, потерю ACK, idempotency/conflicts и неполную историю. Это практические результаты, не доказательство универсальной консистентности. Ответ автоматического ассистента Yandex не равен официальному подтверждению техподдержки; вопрос гарантии ListObjectVersions остаётся открытым для production.

## Источники

- [Pricing](https://yandex.cloud/ru/docs/storage/pricing), [динамический прайс](https://yandex.cloud/ru/price-list?services=dn2li5qddoc5cad2n6br).
- [Object Lock](https://yandex.cloud/ru/docs/storage/concepts/object-lock), [PutObjectRetention](https://yandex.cloud/ru/docs/storage/s3/api-ref/object/putobjectretention).
- [Policy](https://yandex.cloud/ru/docs/storage/concepts/policy), [actions](https://yandex.cloud/ru/docs/storage/s3/api-ref/policy/actions), [официальный исходник conditions](https://github.com/yandex-cloud/docs/blob/master/ru/storage/s3/api-ref/policy/conditions.md).
- [Максимальный размер](https://yandex.cloud/ru/docs/storage/operations/buckets/limit-max-volume).
