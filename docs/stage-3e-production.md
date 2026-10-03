# Stage 3E — production release

Deployment выполнен 02.10.2026, итоговая проверка VPS завершена 03.10.2026. Runtime SHA: `da16da2dd257ee7175278ddb38ebee31aa7f2138`, [PR #23](https://github.com/obrattsev/vinyl-collection-ai/pull/23). Local acceptance Streaming и всех финальных правок, включая верхнее положение Cover в Add, принята владельцем; commit/push/PR/merge/deploy явно разрешены. Отсутствие незавершённых записей и приостановка owner writes подтверждены перед переключением.

## Результат

Архив merged main установлен в новый release, зависимости из lockfile установлены от vinyl с `--ignore-scripts`, код возвращён root:root без group/other write. RELEASE записан до запуска. Linux sharp 0.35.5 проверен. Current атомарно переключён; перезапущен только vinyl-collection-ai. Новые зависимости, env, схема Sheets и миграции не требовались. Сессии сброшены штатным рестартом.

Предыдущий runtime `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63` сохранён для rollback по [runbook](deployment.md). Секреты, covers и данные не переносились и не переписывались.

## Проверки

- Полный suite: 386/386 локально и 386/386 на Linux VPS от пользователя vinyl.
- HTTPS: Collection/Wish-list и восемь HTML/CSS/JS ресурсов доступны; ресурсы побайтно совпадают с merged main. CSP разрешает официальный Apple embed.
- Публичные API: 29 Collection, 12 Wish-list; schema без приватных полей валидна. Ответы API до/после deployment побайтно совпадают. Это проверка публичной проекции, не полный приватный snapshot Sheets.
- Thumbnail обеих коллекций — HTTP 200. Guest session и запрет guest POST — штатные; .env/server/package.json не раздаются. Реальные CRUD/Cover acceptance writes не выполнялись.
- Read-only Apple lookup Pink Floyd / The Wall / 1979: RU — 200 not_found, US — 200 matched, album 1065975633. Некорректный запрос — 400. Это проверка lookup; воспроизведение звука в production отдельно не проверялось.
- 03.10 current и RELEASE совпадают с SHA выше. Сервис active, NRestarts=0; MemoryCurrent 45,731,840 bytes, MemoryPeak 176,107,520 bytes при лимите 512 MiB. Журнал показывает штатный stop/start, без ошибок приложения в просмотренном фрагменте.
- PID и время запуска nginx, SSH, WireGuard unit и Zabbix совпадают с состоянием до deployment; конфигурация этих служб не менялась.

Последняя SSH-проверка 02.10 была остановлена лимитом автоматической проверки разрешений после успешного deployment и публичного smoke; 03.10 она выполнена успешно без повторного deployment.

## Статус Stage 3

3E развёрнут, технический production smoke пройден. Функциональный scope Stage 3 заморожен. Финальная визуальная production acceptance владельца остаётся открытой: обе коллекции, Streaming, Add Cover, mobile Transfer. До неё Stage 3 формально не закрывается. Stage 4/5 не начаты. Приостановка owner writes завершена; после рестарта нужен новый вход.
