# Stage 4D — жанры и фильтры: локальный результат

> Актуальный итог: **LOCAL DONE / PRODUCTION PENDING**. Функциональный scope принят/закрыт владельцем; финальные checks завершены, ручная приёмка локального stand ожидается. Исторические статусы ниже относятся к предыдущим итерациям. [Финальный отчёт](stage-4d-final-readiness.md).

**LOCAL DONE, принято владельцем 15.10.2026.** Блок форм/обложек/текстов принят владельцем как Local DONE; реализован только следующий разрешённый жанровый фильтр. Production и реальные пользовательские данные не затрагивались.

## Поведение

- Collection и Wish-list получают независимые варианты из полного, успешно проверенного ответа своего текущего API. Поля genre/additionalGenre учитываются вместе; пустые значения исключены. Частота — количество записей, в которых жанр встретился хотя бы раз.
- Варианты сортируются по частоте убывания; при равенстве — по алфавиту (Intl.Collator ru, deterministic fallback). Регистр и пробелы группируются прежним normalize; известные жанры имеют привычные подписи, legacy значения не пропадают. Исходные records и закрытый GENRES не изменяются.
- Подсчёт идёт до применения поиска, а не по displayedRecords. Выбор жанра не убирает остальные доступные варианты. Дополнительных запросов к другому списку и общего frequency cache нет.
- Public profile использует только прежний scoped public API и его доступную проекцию; genres private/foreign списка не участвуют. Auth-context change, denied/private или failed load очищают варианты. Load version guard не позволяет старому ответу вернуть жанры предыдущего пользователя.
- До первой загрузки, при пустом списке и отсутствии жанров доступен только «Любой жанр». Выбранный существующий жанр сохраняется при смене ранга; исчезнувший сбрасывается на «Любой жанр», при обновлении снимается только его criterion, остальные условия сохраняются.
- После Add/Edit/Delete варианты и частоты обновляются из свежего GET. Сам поиск сохраняет прежнюю semantics, включая contains-match жанров; порядок самих пластинок и activeSort не менялись.

## Изменения

`src/genres.mjs`: добавлен pure helper genresInRecords; GENRES прежний. `prototype/app.js`: dropdown теперь data-driven, очищается на auth/read boundary; используется существующий list request. Backend, API, schema и migration files не изменены. Test harness получает новый helper; два старых tests с требованием полного статического справочника в пустом фильтре обновлены под текущий контракт, сохранив year/reset и полный Add/Edit catalog assertions.

Add/Edit ranking не реализован: последнее задание касается только фильтров. Его прежнее предложение остаётся вне выполненного scope и требует отдельного разрешения. Обработчики Clear/Favorite, quotes/background/CSS, record matching/sorting и ранее принятые формы/обложки не менялись.

## Проверки

- **471/471 regression**, включая 12 новых genre/helper/UI tests.
- **100/100 PostgreSQL integration**, включая новый A/B/Guest/public scoped HTTP test с настоящими локальными PG accounts/records.
- Реальный Chrome на loopback synthetic memory stand: Collection и Wish-list × desktop 1440×1000/mobile 390×844. В каждой комбинации проверены initial variants, поиск, Add нового жанра, Edit с исчезновением выбранного жанра и reset выбора, Delete последней записи нового жанра. JS errors: 0. Сохранены четыре screenshots и JSON результатов; desktop/mobile screenshots просмотрены.
- Empty/no genres, frequency ties, primary/additional deduplication, case/spacing/legacy, input immutability, сохранение active choice, data changes, поздний ответ после смены пользователя, failed/private read и отсутствие запросов к другому списку покрыты tests.
- npm audit: **0 vulnerabilities**; git diff --check, syntax/link/secret review — passed. Dependencies не добавлялись.

PG tests выполнялись только на маркированной test DB с ownership guard, с синтетическими аккаунтами/capture email. Browser работал с memory fixture stand без PG/Sheets/Postbox, внешние запросы блокировались. Реальных SMTP писем/Google writes, production changes, Git commits/push/merge не было.

До начала сохранён snapshot 34 предшествующих локальных файлов с SHA-256. До обновления статусов 33 файла оставались побайтово прежними; только app.js получил добавочные genre hooks. Старые 4D.7/4D.8/формы сохранены; последующая документация изменена только для актуальных разрешений/статусов. Никаких операций с тестовыми Timeweb ресурсами не выполнялось.

После подготовки работа остановлена для приёмки этого блока. Полный Stage 4D этим отчётом не закрывается: дальнейшая визуальная/релизная приёмка выполняется отдельно по разрешению владельца.
