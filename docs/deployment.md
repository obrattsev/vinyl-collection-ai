# Vinyl Collection AI — production

Развёрнуто 24 сентября 2026 на https://vinyl-collection.ru.
Первый production release: `e8d8bcc2296fbb7c2369cbece51aa95b20eb92ad` (PR #17).
Технические проверки первого deployment и ручная внешняя acceptance владельца (guest, оба раздела, поиск, login/logout) пройдены. Финальная правка канонических URL проверяется после развёртывания нового main. Активный SHA хранится в файле RELEASE и имени каталога current на VPS.

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
