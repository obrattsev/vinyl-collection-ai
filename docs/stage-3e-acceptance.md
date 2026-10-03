# Controlled rollback 3E — 02.10.2026

Актуальный статус 3E: deployment 02.10.2026 выполнен, технический production smoke пройден; [отчёт](stage-3e-production.md). Ожидается финальная визуальная production acceptance владельца.


Статус: local acceptance 3E после controlled rollback **пройдена по подтверждению владельца**. Ниже сохранён исторический отчёт агентской проверки. Две последующие финальные правки описаны в [отдельном отчёте](stage-3e-final-polish.md) и приняты владельцем; Git/deployment разрешены 02.10.2026; Git/deployment разрешены владельцем 02.10.2026.

Ветка `feature/stage-3e`; HEAD/UI baseline `fb073dbe219d602890b66ad6253824507eb86a29`. Commit/push/PR/merge/deploy не выполнялись. Production использовался только read-only, реальные Sheets не менялись.

## Baseline и классификация diff

Presentation в `fb073db` идентичен runtime 3D `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63`. Публичные production `app.js`, `styles.css`, `cover-ui.mjs`, `mobile-records.mjs` скачаны read-only и побайтно сравнены с baseline: все совпадают. Source files восстановлены непосредственно через `git show`, исходное состояние сохранено в `/tmp/vinyl-3e-before-controlled-rollback`.

A. Сохранены backend/domain/security: streaming service, API, fixed iTunes upstream, matching/ambiguity, URL safety, cache/coalescing/limits/timeouts, отдельный ingress limiter, CSP frame-src, server tests. Automatic RU → US сохранён в независимом player module; fallback только при настоящем no-result, не при ошибке/ambiguity.

B. Повторно наложены минимальные additions: desktop Album button без увеличивающих высоту padding/min-height; отдельный read-only Streaming dialog; мобильные mount/cleanup hooks; safe external link, iframe lifecycle; по четыре строки HTML для нового dialog на каждой странице. Дополнительно разрешённые пользователем table fixes: native scrollbar CSS и удаление одного wishlist override вертикальных row actions.

C. Удалены: общая desktop/mobile presentation, экспорт mobile open для desktop, desktop-only фильтрация metadata и CRUD внутри mobile-модуля, `presentationOnly` в displayRecord, `openPresentationCover`, новые подписи Cover, изменения fallback сломанной thumbnail, desktop grid/ширина/позиционирование общего detail, изменения размеров/закрепления header существующего mobile detail. `cover-ui.mjs`, displayRecord, старые Cover/detail HTML blocks восстановлены. Record presentation, search/sort/columns/CRUD и responsive CSS совпадают с baseline за указанными additions/исключениями.

Существующие Stage 3D tests возвращены к прежнему Cover UX. Изменены только три assertions, непосредственно ожидавшие текстовую Album cell без дочерних элементов: теперь в ней согласованная Album button. Остальные старые проверки не переписаны под новую архитектуру.

## Визуальное сравнение

Production Guest Collection и Wish-list открыты и визуально сопоставлены с локальным UI. Действующей production Owner session в доступном браузере нет: owner сравнен с изолированной копией точного pre-3E кода на тех же вымышленных fixtures, а не объявлен проверенным в production. Эта копия использует localhost:8015, без Google/.env/реальных записей. CSS/JS её UI проверены на равенство production выше.

Сохранены структура таблиц, сортируемые headers, первая группа Favorite/Cover, публичные и owner columns, controls в последней колонке. Album стал единственным desktop Streaming entry. По содержимому новый dialog одинаков для ролей и не содержит metadata/CRUD/Favorite/Cover management.

## Native horizontal scrollbar: mouse drag

Проверка во встроенном браузере при viewport 1280px. Полоса физически видна непосредственно под таблицей; высота 14px. Во всех четырёх случаях thumb перетащен мышью до правого края и обратно. При правом крае геометрия последней ячейки подтверждает полную видимость; screenshot подтверждает конечные owner actions.

| Режим | clientWidth | scrollWidth | scrollLeft: начало → конец → начало |
| --- | ---: | ---: | --- |
| Guest Collection | 1168 | 1366 | 0 → 198 → 0 |
| Owner Collection | 1168 | 1966 | 0 → 798 → 0 |
| Guest Wish-list | 1168 | 1320 | 0 → 152 → 0 |
| Owner Wish-list | 1168 | 2052 | 0 → 884 → 0 |

Collection owner справа видит Delete/Edit и purchase поля; Wish-list owner — Link, Delete/Edit/Transfer. Вертикальная прокрутка страницы до нижнего края таблицы не двигает horizontal scroll; перетаскивание thumb двигает только таблицу. Отдельных JS scrollbars/стрелок нет.

Guest Wish-list при 1440px: clientWidth=scrollWidth=1328, scrollbar height=0. При 1121px: clientWidth=1009, scrollWidth=1320, scrollbar height=14. Полоса появляется только при переполнении. Collection при 1440/1280/1121 — desktop table с overflow; 1120/390/360 — compact list. Breakpoint не изменён. Браузеры без WebKit scrollbar pseudo-elements используют системную полосу; Firefox и реальные телефоны отдельно не проверены.

## Row height

Причина из pre-3E: `body[data-section="wishlist"] .row-actions { flex-direction: column; ... }` складывал три кнопки по 50px с gap, растягивая всю строку примерно до 197px. Удалён только этот override; работает общий `.row-actions` как в Collection. Состав и порядок кнопок не изменены, ширина actions column естественно увеличилась. Фиксированные row height/min-height не добавлены.

| Fixtures при 1280px | Pre-3E | Local 3E |
| --- | ---: | ---: |
| Collection Guest, короткий Album | 73.875–74.375 | 73.875–74.375 |
| Collection Owner, короткий Album | 80.5–81 | 80.5–81 |
| Collection, длинный Album | 117.75 | 117.75 |
| Wish-list Owner, короткий Album | 196.5–197 | 80.5–81 |
| Wish-list Owner, длинный Album | 197 | 117.75 |
| Wish-list Guest, короткий/длинный Album после исправления | — | 73.875–74.375 / 117.75 |

Проверены строки с Cover, без Cover, с owner Add Cover `+`, Link, Note, коротким и многострочным Album, owner actions. Высота определяется содержимым и прежними cell padding/alignment. Скрывать проблему фиксированной высотой не пришлось.

## Cover

`cover-ui.mjs` побайтно совпадает с baseline. Cover открывает `Обложка: Artist — Album`, preview, file picker, Delete/Save/×; Streaming отсутствует. Окно Owner Wish-list на одинаковом fixture: и baseline, и local — 440 × 491.1875px, одинаковые controls.

В браузере на локальном Wish-list выполнены Replace → выбор sample.png → Save; повторное открытие; Delete → Cancel (cover сохраняется); Delete → Confirm; затем Add (file picker и правильная подпись), ×. Add/Replace/Delete с Save для обоих разделов дополнительно покрыты прежними Stage 3D tests, не подменёнными новыми flow. Production mutations не выполнялись. Стенд перед передачей перезапускается, чтобы сбросить эти тестовые изменения.

## Mobile и Streaming

390/360px: прежний compact list/full detail, Guest 9 полей без private metadata; Owner Collection 12 полей, Favorite/Cover/Edit/Delete; Owner Wish-list 10 полей, private Link/Cover/Edit/Delete/Transfer. Detail CSS/controls восстановлены из baseline. Streaming добавлен после существующего содержимого, перед прежними mobile actions.

Новый desktop dialog: The Wall после одного «Прослушать» дал US album URL/iframe `/us/album/the-wall/1065975633`, без ручного fallback. Mobile Wish-list повторил этот результат. После × iframe отсутствует; reopen начинает с «Прослушать». На 360px body=360, прежний detail=322, iframe=284px; горизонтального overflow страницы нет. Автотесты проверяют полный RU → US порядок, ambiguity, оба no-result, ошибку и abort/stale responses.

Во встроенном браузере Apple iframe остаётся about:blank: созданный URL и удаление iframe проверены, playback в этом браузере не подтверждён. Попытка открыть Safari для повторной проверки playback/остановки после rollback остановлена системным сообщением о заблокированном Mac. Пользователю предложено разблокировать Mac; до этого playback check pending. Предыдущие успешные Safari проверки до rollback не подменяют эту проверку. Real iOS/Android также не проверены.

## Tests и reviews

Полный `node --test tests/*.test.mjs`: **363 passed, 0 failed, 0 skipped**. Исходные Stage 3D Cover/Favorite проверки проходят; новые проверки закрепляют Album-only dialog, независимость Cover, прежние table/mobile role fields/actions, automatic fallback, no preload, URL safety и cleanup. Layout не объявляется доказанным по unit assertions: реальные измерения и mouse drag приведены выше.

`git diff --check` проходит. Self-review каждого UI diff: app.js — только Streaming import/Album/mount/reset/dialog guard; mobile-records — только mount/cleanup; HTML — новый отдельный dialog; styles — scoped Streaming CSS плюс ровно два разрешённых table fixes. Старые dialog/Cover/layout правила не переработаны.

Security review: backend/security не изменялись при rollback; upstream фиксированный HTTPS, redirect error, только публичные artist/album/year/storefront, response/URL validation, bounds/cache/rate limits сохранены. Dynamic текст через textContent; ссылки noopener/noreferrer; iframe без autoplay, no-referrer; CSP расширена только embed origin. Новый read-only dialog не даёт owner прав.

Data-integrity review: Streaming не получает repositories и не пишет records/Sheets/UUID/revisions/CSV; модели, projection, CRUD/transfer contracts и зависимости не менялись. Только disposable local fixtures изменялись при Cover-проверке. Production/реальные Sheets read-only. Roadmap Stage 4/5 не реализуется, прежние согласованные задачи сохранены.

## Изолированный стенд и следующий шаг

Collection: http://127.0.0.1:8014/collection

Wish-list: http://127.0.0.1:8014/wishlist

Пароль owner: `local-acceptance-only`.

Запуск: `node scripts/local-acceptance.mjs --streaming` (Node 24). Без `.env`/Google clients, данные в RAM, sample covers во временной директории. Перезапуск сбрасывает записи/session/cache. Реальный iTunes вызывается только по «Прослушать».

Историческая блокировка Safari относилась к агентской проверке выше; после неё владелец подтвердил local acceptance 3E. Финальные правки также приняты владельцем 02.10.2026. Checklist: обе таблицы Guest/Owner — mouse drag до конечных actions и обратно; компактность Wish-list; Cover открывает прежний dialog без Streaming; Album открывает отдельный Streaming dialog; один клик The Wall; mobile 390/360 full detail и остановка playback после ×. Отдельное разрешение на Git finalization/PR/deploy получено 02.10.2026.
