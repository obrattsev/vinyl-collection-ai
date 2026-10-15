# Stage 4D — диагностика maintenance gate

**LOCAL FIX ACCEPTED / PRODUCTION UNCHANGED / NO-GO для повторного deployment.** Диагностика ниже зафиксирована до публикации исправления. Владелец принял её и разрешил отдельный maintenance PR; merge и новый выпуск требуют отдельного разрешения.

## Что установлено

В операторском `backup-restore.py` flag создавался **до** изменения nginx config и reload. После `nginx -t` и `systemctl reload nginx` выполнялся один немедленный curl, после которого требовался статус 503. Готовность новой конфигурации и уход старых workers не проверялись.

На production `ExecReload` — `nginx ... -s reload`. Этот процесс посылает HUP master и завершается, не дожидаясь смены workers. Нельзя считать завершение systemctl reload доказательством закрытого ingress. В nginx 1.24.0 master запускает новое поколение, делает `ngx_msleep(100)`, затем запрашивает graceful shutdown прежнего поколения. Даже первый ответ 503 от нового worker не доказывает, что старые workers уже перестали принимать запросы.

Это подтверждённая ошибка синхронизации и полноты release gate. Она воспроизведена на настоящем nginx 1.24.0 в локальном изолированном окружении: после успешного reload немедленный запрос возвращает 200 от **того же прежнего PID**, после retirement старого worker — 503. Отдельный детерминированный тест задерживает только fixture-master и доказывает тот же результат без кеша.

Источники: [официальный порядок reload](https://nginx.org/en/docs/control.html), [исходный код nginx 1.24.0](https://github.com/nginx/nginx/blob/release-1.24.0/src/os/unix/ngx_process_cycle.c#L219).

## Граница доказательства исторического HTTP 200

Для конкретного production-запроса PID обслужившего worker, generation marker, response headers и миллисекунды запроса **не записывались**. Поэтому утверждать с абсолютной достоверностью, что именно тот запрос обслужил старый PID, нельзя. Установлены дефект gate и точное воспроизведение такого HTTP 200; это наиболее подтверждённое объяснение исторического результата, но не сохранённая трассировка его worker.

Нельзя заменять недостающую телеметрию утверждением «точный исторический PID доказан». Перезапуск maintenance на production ради получения такого доказательства не выполнялся и сейчас запрещён.

## Проверенные альтернативы и хронология

| Проверка | Подтверждение |
|---|---|
| Правильный URL | Проверялся `https://vinyl-collection.ru/`, canonical server_name на 443. curl сохранил Host/SNI, использовал --resolve к VPS и --noproxy '*', redirects не следовал |
| Должен ли быть 503 | Да, после применения правил, при существующем flag и отсутствии IP exception: server rewrite return выполняется до выбора `/` или regex Cover location |
| IP exception | Исторический запрос не был loopback и не совпадал с разрешённым операторским IP, проверено по access log без вывода адресов |
| Кеширование | В effective config proxy_cache off для обоих проксирующих locations; другого cache configuration не найдено. Проверка была прямым новым curl к VPS, не браузерным кешем или CDN |
| Ошибка синтаксиса | nginx -t прошёл; в error log за момент нет ошибки применения конфигурации. Это не доказывает готовность workers |
| Время | systemd завершил первый reload в 14:47:05.734641 UTC; reload исходной конфигурации начался в 14:47:05.867450 UTC; весь интервал до возврата исходной конфигурации около 0,16 секунды |
| Фактически закрыт ли доступ тогда | Не доказано: именно поэтому 200 корректно остановил выпуск; выдавать этот ответ за «503 из кеша» нельзя |

Точные параметры первоначального probe и исходный конфиг сохранены в защищённом operation directory. Секретные env и пользовательские данные в отчёт не включены.

## Дополнительные дефекты старого временного gate

1. Правила устанавливались только на canonical HTTPS. HTTP и www возвращали 301, не собственный 503. Это не причина 200 на выбранном canonical HTTPS URL, но недостаточная полнота gate.
2. IP exceptions разрешали **все методы**. В isolated nginx POST регистрации и GET auth bootstrap от операторского IP дошли до synthetic upstream и считались записью. Полагаться на freeze как защиту всех auth writes нельзя: GET bootstrap записывает rate-limit row, auth flows не полностью покрыты business freeze.
3. Проверялась только главная, не API/auth/cover regex. Не было уникального window marker, проверки старых workers и трёх последовательных проходов.

## Подготовленное минимальное исправление

Изменены только локальные operator tools/tests/docs; app/auth/PG/statistics/integrations не изменены:

- `ops/maintenance-gate.mjs`: параметризованный nginx snippet, baseline/armed verification, bounded worker retirement и строгая проверка 503.
- `scripts/maintenance-check.mjs`: read-only CLI, не меняет flag/config/services и не отправляет POST. Проверяет 14 URL/method combinations на каждом origin три раза, без cookies, redirects и X-Collection-View. Для `/api/auth/bootstrap` используется HEAD, поскольку GET может писать в БД.
- Два test files: unit и isolated real-nginx integration.

Новый порядок: установить snippet **с отсутствующим flag**, подтвердить baseline и уникальный generation marker на HTTP/HTTPS canonical/www, дождаться завершения всех прежних workers, затем создать flag **без reload**. Любой 200/redirect, чужой marker, ошибка сети или timeout после активации — немедленный STOP, не повторять до случайного успеха.

У активного gate public IP exceptions отсутствуют. Public HTTP/HTTPS всех hostnames возвращает 503 с уникальным marker, Retry-After и Cache-Control no-store. Gate применяется до любых proxy locations/записей, включая auth/bootstrap и regex Cover endpoint. Операторский read-only smoke использует существующий private Node listener 127.0.0.1:8000 без cookies/заголовка учёта активности; нового listener/proxy/service нет.

Снятие flag восстанавливает исходные маршруты без reload. Временный snippet затем удаляется только по согласованному плану с проверкой baseline. Fresh backup/restore proof по-прежнему обязателен до migrations 006/007.

## Результаты и ограничения

Реальное isolated воспроизведение: nginx upstream 1.24.0 на macOS, TLS с отдельным доверенным fixture certificate, только loopback; Ubuntu packaged binary на production не перезапускался. Локальный source download/build не устанавливал service или системный nginx.

- Full regression: **517/517**, включая реальные nginx tests, без skips. В сохранённом диагностическом natural run **5/5** немедленных probes вернули 200 от прежнего PID за 4–10 мс после возврата reload; затем корректно загруженный gate даёт 503.
- **168** строгих read-only 503 probes за три прохода четырёх origins.
- **576** комбинаций host/scheme/route/method, включая GET/HEAD/POST/PUT/PATCH/DELETE; upstream calls/writes при maintenance — **0**.
- Проверены auth/bootstrap/registration/login/logout/recovery/settings/account deletion, API списков и Reports, regex Cover endpoints, assets/media, HTTP/www redirects, IP/header spoof attempts.
- Existing keep-alive socket после активации flag получил 503.
- Private Node read-only smoke остаётся доступным. После снятия flag прежняя маршрутизация и synthetic write handler восстановились.
- Ошибки сети, неверный marker, upstream 503, кешируемый ответ, redirect, 200, worker timeout и incomplete armed baseline отказывают безопасно.

Синтетический upstream доказывает, что nginx не проксирует запросы; это не запуск production auth/SMTP/PG и не реальное изменение пользовательских данных. Live gate остаётся непроверенным до отдельного разрешения.

## Production и решение

Read-only проверками подтверждены прежний release `f593b3f6e86d81f53fd4e490f87bf8c39b136ebc`, schema 5, frozen=false, активные app/mirror/backup timer; исходный nginx site побайтно совпадает с backup, flag отсутствует. Mirror 11/11, ошибок нет.

**NO-GO для повторного deployment сейчас.** Локальный вариант проверен; production nginx/helper не менялись. Требуется согласование системного изменения и нового запуска по отдельному retry plan. Доступный исторический log не позволяет ретроспективно доказать PID конкретного 200; новая процедура устраняет этот пробел до закрытия ingress, с проверяемым retirement прежних workers.

Проверка перед публикацией maintenance PR: full regression повторно **517/517**, failures/skips **0**, включая isolated real-nginx integration. PostgreSQL/app/migrations не изменялись; необходимая integration suite этого исправления — nginx с synthetic upstream. Production для этой проверки не использовался.
