# Vinyl Collection AI — production

Актуальный статус 3E: deployment 02.10.2026 выполнен, технический production smoke пройден; [отчёт](stage-3e-production.md). Финальная визуальная production acceptance подтверждена владельцем; Stage 3 закрыт. 4A реализован и принят владельцем по local acceptance; 4B production cutover и data verification выполнены 04.10.2026; 4C–4F и Stage 5 не начаты.


Развёрнуто 24 сентября 2026 на https://vinyl-collection.ru.
Первый production release: `e8d8bcc2296fbb7c2369cbece51aa95b20eb92ad` (PR #17).
Технические проверки первого deployment и ручная внешняя acceptance владельца (guest, оба раздела, поиск, login/logout) пройдены. Канонические URL завершены в рамках Этапа 2 по подтверждению владельца. Активный SHA хранится в файле RELEASE и имени каталога current на VPS.

## Размещение

- Ubuntu 24.04.4, VPS `194.87.83.158`.
- Существующий nginx: HTTP → HTTPS, www → основной домен с сохранением пути/query. Исходный `default` сохранён.
- Node 24.19.0: `/opt/vinyl-collection-ai/runtime/node-v24.19.0-linux-x64/bin/node`.
- Релизы: `/opt/vinyl-collection-ai/releases/<полный SHA>`, `current` — symlink активного релиза.
- Приложение: `vinyl-collection-ai.service`, пользователь/группа `vinyl`, только `127.0.0.1:8000`, один процесс; автозапуск включён.
- `MemoryMax=512M`, CPU quota отсутствует. Код принадлежит root и недоступен приложению для записи. systemd ограничивает права и доступ к файловой системе.
- Конфигурация: `/etc/vinyl-collection-ai/app.env`, root, 0600.
- Хеш owner-пароля: `/etc/vinyl-collection-ai/owner-auth.env`, root, 0600. Создан владельцем интерактивно; пароль не передавался агенту.
- Service-account JSON: `/etc/vinyl-collection-ai/service-account.json`, root:vinyl, 0640. Каталог root:vinyl, 0750. Используются прежние два Google Sheets-документа и service account.
- Настройки nginx: `/etc/nginx/sites-available/vinyl-collection.ru` и одноимённая ссылка в `sites-enabled`. Маршруты HTML обрабатывает Node; для /collection и /wishlist nginx не требует изменений.
- Исходный nginx: `/var/backups/vinyl-deployment-20260923/nginx`; контрольные суммы и снимки состояния служб — там же.

## TLS и продление

Сертификат Let's Encrypt включает `vinyl-collection.ru` и `www.vinyl-collection.ru`; текущий срок до 23 декабря 2026 05:30:29 UTC. Сертификат и private key остаются в `/etc/letsencrypt/live/vinyl-collection.ru/`.

Certbot 2.9.0 установлен из Ubuntu; webroot — `/var/www/vinyl-acme`. ACME-аккаунт зарегистрирован без необязательного email. `certbot.timer` включён и активен. Hook `/etc/letsencrypt/renewal-hooks/deploy/vinyl-nginx-reload` выполняет `nginx -t` и `systemctl reload nginx`. Пробное продление с выполнением hook прошло успешно. Диагностическое сообщение nginx в stderr hook было успешным результатом проверки, а не ошибкой продления.

Команда повторной проверки из root SSH-сессии:

```sh
certbot renew --cert-name vinyl-collection.ru --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

## Выполненные проверки

- Оба HTML-интерфейса и клиентские ресурсы: HTTPS 200, проверка цепочки сертификата штатным curl.
- API: 26 записей Collection и 8 Wish-list на момент проверки, ровно девять разрешённых публичных полей, без UUID и приватных полей.
- Все пять изменяющих маршрутов отклоняют гостя с 401 AUTH_REQUIRED до бизнес-операций. Реальные данные не изменялись.
- `.env`, серверный модуль, package.json и credentials не раздаются.
- HTTP и www HTTPS перенаправляют на основной HTTPS с сохранением пути и query.
- TCP 8000 недоступен извне; Node слушает только 127.0.0.1.
- Смена клиентских X-Real-IP/X-Forwarded-For не обходит nginx: 60 session-запросов разрешены, следующие 5 получили 429. Отдельные доверенные IP и прямой loopback сохранили независимые buckets.
- Для синтетического IP login: пять запросов приняты обработчиком, шестой отклонён 429; другой IP не заблокирован.
- Одно заведомо неверное значение пароля проверено scrypt: 401, около 0.70 секунды. Память после проверки около 25 MiB, зафиксированный пик около 153 MiB; рестартов приложения нет. Это короткая проверка, не нагрузочный тест и не гарантия изоляции VPN.
- Исходные nginx.conf/default совпадают с контрольными суммами. MainPID и ActiveEnterTimestamp nginx, WireGuard, SSH и Zabbix совпали с начальным снимком; nginx только reload. Boot ID не изменился; wg0 по-прежнему UDP 38918.
- Рабочее дерево репозитория чистое; main == origin/main == SHA выше. Программный suite перед deployment: 173/173.
- Визуальная автоматическая проверка недоступна: браузерный инструмент не смог проверить административную политику; обход не выполнялся. Владелец отдельно подтвердил реальный guest/login/logout и интерфейс обоих разделов.

## Диагностика

Команды предназначены для оператора в уже авторизованной root SSH-сессии; пользователю не требуется вручную редактировать конфиги.

```sh
systemctl status vinyl-collection-ai --no-pager
journalctl -u vinyl-collection-ai -n 50 --no-pager
systemctl show vinyl-collection-ai -p MemoryCurrent -p MemoryPeak -p NRestarts
systemctl list-timers certbot.timer --no-pager
nginx -t
```

Не выводить содержимое env/JSON/private key и не прикладывать дампы окружения процесса. Диагностику журналов просматривать перед передачей третьим лицам.

## Последующие обновления и откат

1. Проверить и принять новый commit в main, выполнить соответствующие тесты и `git diff --check`. Сохранить SHA текущего релиза через `readlink -f /opt/vinyl-collection-ai/current`.
2. Подготовить `git archive` конкретного SHA на Mac и передать по SSH в **новый** каталог releases. Локальные `.env`, credentials и GitHub credentials на VPS не копировать. На VPS нет GitHub deploy key.
3. Выполнить `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` закреплённым runtime от пользователя vinyl в новом каталоге с отдельным временным npm cache. Затем вернуть код и зависимости root:root, запретить запись группе/остальным. Секреты остаются в `/etc/vinyl-collection-ai`.
4. Убедиться с владельцем, что нет незавершённых добавлений/удалений/переносов, и до конца обновления не выполнять новые изменения. Текущая версия не имеет graceful-drain очереди: нельзя перезапускать процесс посреди записи Sheets. Гостевое чтение не меняет данные.
5. Остановить **только** vinyl-collection-ai; заменить `current` атомарным переименованием временной ссылки на проверенный новый каталог; запустить сервис. В это короткое окно nginx может возвращать 502. Проверить loopback и публичный HTTPS, guest schema, журнал, обновить файл RELEASE.
6. При проблеме: остановить только приложение, вернуть current на сохранённый предыдущий каталог, запустить и проверить. Релизы до окончания acceptance не удалять. Сессии после любого рестарта теряются, нужен новый вход. Откат кода не откатывает записи Google Sheets.

При обновлении маршрутов предыдущий релиз e8d8bcc сохраняется для отката. При необходимости снять первую публикацию оператор восстанавливает сохранённый bootstrap-конфиг **только нового сайта**, проверяет nginx -t и выполняет reload, затем останавливает приложение. Не удалять исходный default и не менять глобальный nginx вслепую.

При дальнейших операциях не менять WireGuard, его NAT/forwarding, SSH, Zabbix, firewall/UFW и не перезагружать VPS без отдельного решения владельца.

## Закрытие и deployment пакета 3A

3A реализован и принят владельцем по итогам локальной acceptance. Независимый финальный review чистый, полный suite — 216/216. Deployment разрешён только из main после merge PR; фактический активный SHA проверяется по current и RELEASE на VPS. Миграция Sheets, новые environment-переменные, зависимости или изменения nginx/systemd/HTTPS не требуются. Применяется существующий процесс обновления; рестарт сбрасывает owner-сессии по прежнему контракту. В этой работе VPS и реальные Sheets не изменялись.

## Закрытие общего пакета 3B + 3C

3B не меняет схему deployment. Для реальных bug reports отдельно подключается новый документ по [инструкции](bug-reports-setup.md); без конфигурации приложение работает, форма получает REPORT_NOT_CONFIGURED. Во время разрешённого deployment запишите существующий marker `RELEASE` с полным SHA **в корень нового release до запуска приложения**: reports читает его один раз при старте. Не требуется runtime Git. Переменные reports меняются только после отдельного подтверждения владельца. В текущем цикле production, его конфигурация и реальные Sheets не изменялись.

Общий пакет 3B + 3C принят владельцем; итоговая дата UI DD.MM.YYYY, полный suite 260/260, self-review чистый. Разрешено закрытие через commit → push → PR → merge → deployment актуального main. На момент первоначального deployment Bug Reports Sheet ещё не был подключён; впоследствии он подключён и проверен владельцем; production env, nginx/systemd/HTTPS и защищённые службы не требуют изменения. Активный commit после deployment проверяется по current/RELEASE и соответствию публичных ресурсов, без реальных изменяющих acceptance-операций.

## 3D — развёрнут 30.09.2026

Runtime SHA: `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63` (PR #21). Схема, storage, backup/restore и initial backfill выполнены: 21/28 Collection и 6/12 Wish-list получили cover, 13 пропусков, 0 ошибок записи. Полные результаты, источники, ограничения проверки и процедура восстановления — [production-отчёт 3D](stage-3d-production.md). Финальная визуальная production acceptance подтверждена владельцем; Stage 3 закрыт.

3B/3C завершены, production Bug Reports подключён/проверен по подтверждению владельца; долг закрыт. Повторная local acceptance 3D принята; владелец разрешил финализацию Git, deployment после merge, согласованную схему Sheets и initial cover backfill. Требования новых колонок, COVERS_DIR, Linux sharp/MemoryMax=512M, body limit proxy и обязательный согласованный backup/restore Sheets + всего covers описаны в [3D](stage-3d-spec.md#перед-отдельным-production-deployment). Перед изменениями проверить фактический production state и отсутствие незавершённых owner writes. При необходимости интерактивного SSH входа остановиться на этом шаге.

### Initial cover backfill

Одноразовая deployment/migration operation после успешного deployment, не постоянная AI-функция. Только записи без cover; существующие covers, UUID, metadata, favorite и порядок строк сохраняются. Перед массовым поиском исследовать качество, условия использования и rate limits источников; сомнительные Artist/Album совпадения пропускать. Только front artwork без watermark. Для неквадратного artwork допустима квадратная подложка без обрезания и искажения, затем штатная нормализация WebP с существующим master до 1200 px.

До backfill сохранить согласованный snapshot Sheets и всего covers, включая `.holds`, владельца и режимы доступа. Пробное восстановление выполнять в отдельный каталог; проверить файлы и ссылки. При возобновлении сверять актуальный coverId и журнал неизвестных результатов, без слепого retry и удаления pending assets. Ошибка одной записи не блокирует остальные. В итоговом отчёте: counts already-covered/installed/skipped/errors и список пропусков. Финальную визуальную production acceptance выполняет владелец.

## 3E — разрешённый выпуск 02.10.2026

Владелец принял Streaming и финальные Add Cover/mobile Transfer правки, затем разрешил commit/push/PR/merge/deploy. Подтверждено отсутствие незавершённых owner writes и приостановка изменений на время выпуска. Применяется существующий runbook: архив merged main, закреплённый runtime/npm ci, RELEASE до запуска, атомарная смена current, restart только приложения. Новые зависимости, env, миграции Sheets и изменения nginx/systemd не нужны. Предыдущий release 9e4678f сохраняется для rollback. Production smoke — read-only, включая on-demand lookup; реальные CRUD/Cover writes не выполняются. Выпуск выполнен; финальная визуальная production acceptance подтверждена владельцем, Stage 3 закрыт. [Отчёт](stage-3e-production.md).

## Stage 4 — 4A local foundation, без production deployment

4A реализован и принят владельцем по local acceptance; [local PostgreSQL setup](stage-4a-postgresql.md). Исторически 4A не включал production deployment; guard осознанно изменён при 4B. 4B production cutover выполнен; 4C–4F не начаты.

Текущий runtime — `2ccb47b50cb3903d1542a273a84d963d4d98cc36` (PR #26), PostgreSQL 16.15 + filesystem Covers. Collection/Wish-list читаются и изменяются только в PG; owner Sheets — one-way mirror, Bug Reports — отдельный Sheet. Timeweb daily backup принят владельцем; logical backup, restore rehearsal и rollback gates выполнены. Email provider выбирается непосредственно перед 4C. Эксплуатационные пути и checks — в production report 4B.

Stage 4B local phase: [implementation/acceptance](stage-4b-local.md), [gated production runbook](stage-4b-cutover.md). Production переведён на PostgreSQL 04.10.2026; owner Sheets — односторонний mirror.

## Production authorization — 04.10.2026

Local acceptance 4B успешно принята владельцем. Git finalization и production phase разрешены с последовательными verification gates; cutover выполнен 04.10.2026; verification и cleanup пройдены, freeze снят. Backup decision: Timeweb daily VPS disk backup + проверенные logical PG/Covers backups на VPS (7 daily + 4 weekly) + one-way owner Sheets mirror. S3/SFTP и новые providers/dependencies не добавлять. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён. Более ранние требования отдельного offsite provider и ожидания local acceptance выше заменены этим решением. Freeze только непосредственно перед cutover, снять после verification.

Фактический release, verification, backup/monitoring и ограничения: [production report 4B](stage-4b-production.md).
