# Local acceptance 3D

Статус: основная функциональность и повторная local acceptance UX-коррекций приняты владельцем. Финальные правки геометрии ♪ и кнопки × в detail проверены автоматически, без новой ручной приёмки. Каталог из 10 цитат предоставлен и согласован владельцем, текст и переносы сохранены дословно. Production deployment и initial backfill выполнены; [отчёт](stage-3d-production.md). Финальная визуальная production acceptance подтверждена владельцем; Stage 3 закрыт.

## Стенд

Node 24: `node scripts/local-acceptance.mjs`. Открыть http://127.0.0.1:8013/collection или http://127.0.0.1:8013/wishlist. Пароль `local-acceptance-only` предназначен только для этого стенда.

Нет загрузки .env/credentials и обращения к Google Sheets. Записи и reports в памяти, covers/образцы файлов в отдельном временном каталоге `vinyl-3d-acceptance-*`; путь печатается при запуске. В нём доступны sample.png, sample.jpeg, sample.webp. Перезапуск сбрасывает записи и создаёт новый каталог. Старые каталоги содержат только вымышленные тестовые данные и могут быть удалены после завершения соответствующего стенда.

## Короткий сценарий владельца

1. Guest, оба раздела: «Показать…». Есть запись с cover и без него. Проверить desktop (>1120 px) и mobile (~390 px): отсутствие placeholder/пустой области, отдельные thumbnail/record/favorite, компактную цитату и отсутствие большого заголовка. Клик cover открывает только просмотр; у Collection нота ♪ readonly.
2. Войти. У записи без cover нажать «+», выбрать один из sample-файлов, проверить preview и отмену. Повторить и сохранить: окно закрывается, вместо «+» появляется thumbnail. Изменить cover, затем удалить с подтверждением. Повторить в Wish-list; metadata Add/Edit не содержит управления изображением.
3. Mobile: открыть detail по тексту записи. Проверить увеличенный cover, «Заменить»/«Удалить», отсутствие вложенных окон, доступность кнопок при прокрутке, возврат focus. Без cover guest сразу видит данные.
4. Collection: включить/выключить ноту без confirmation; применить «Только избранное» вместе с поиском/сортировкой. Выключение последнего favorite даёт пустой результат. Скачать CSV: только отфильтрованные строки, прежние 9 колонок, никаких URL cover/coverId/favorite. Wish-list фильтра/favorite не имеет.
5. Проверить refresh: цитата раздела в пределах локального дня остаётся той же. Смена дня и fallback проверяются автоматическими тестами; часы компьютера менять не нужно. Проверить светлый компактный quote block и сохранение переносов строк в согласованном каталоге.

## Выполненные проверки

- Полный Node test suite: **301/301**, `git diff --check` — чисто; включая новую обработку JPEG/PNG/WebP, ограничения пикселей/размера, повреждённые файлы, нормализацию и отсутствие оригиналов/EXIF.
- Add/replace/delete обеих коллекций, metadata сохраняет coverId/favorite, shared references, transfer, version conflicts, lost response, unknown outcome и сохранение durable holds после restart, отсутствие blind retry/orphan deletion при ошибках.
- Owner/guest, CSRF/Origin/If-Match, публичная проекция без private fields, отсутствие directory listing, ограничение одновременной загрузки; прежние auth/bug-report regression tests.
- UI обеих ролей/разделов с cover и без него, отдельные интерактивные элементы, confirmation удаления, отмена/preview/busy/error/recovery, подтверждённый результат без повторного GET, favorite filter и CSV.
- Date+section quote selection, refresh stability, переход полуночи, пустой/невалидный источник, сохранённый accessible heading.
- Браузер на локальном стенде: guest view без controls, mobile без placeholder; owner PNG upload/preview/save, detail и подтверждённое удаление; favorite toggle и фильтр; desktop thumbnail измерен 36×36, mobile Wish-list — 48×48, hidden h1 — 1 px, nested interactive controls — 0. Это результаты технической проверки; владелец затем отдельно принял повторную local acceptance.
- `npm audit --omit=dev`: 0 известных уязвимостей на момент проверки. Lockfile содержит optional sharp binaries для Linux x64; установка и декодирование на Linux VPS проверены при deployment 30.09.2026.

## Review и границы

Self-review включает diff, shared queue, обработку ролей и stale responses, typed Sheets writes, public projection, scope CSV, пути файлов/лимиты декодера. Неизвестные операции сохраняют holds; автоматический сбор оставшихся файлов не реализован намеренно. Удаление самой записи может оставить неиспользуемый файл до отдельной сверки. Прямые параллельные правки ссылок в Sheets не защищены транзакцией.

HEIC/HEIF отложены по решению владельца. Реальный curated source содержит согласованные 10 цитат; стенд использует его без override. Linux/RSS внутри MemoryMax=512M, backup/restore и новые заголовки Sheets проверены при разрешённом deployment; см. production-отчёт. 3B/3C и подключённый production reports считаются завершёнными; Streaming вынесен в отдельный 3E, актуальный статус — в [backlog](backlog.md). Финализация Git, deployment и initial cover backfill разрешены; фактический production результат фиксируется отдельно.

## UX-коррекция после основной acceptance

Финальные правки после повторной приёмки: визуальный фон ♪ — 36×36 на desktop и 48×48 на mobile, hit area не уменьшена и не зависит от active. Detail обоих разделов использует × с aria-label «Закрыть» и общий стиль report/cover/detail; обработчики Escape/backdrop/focus сохранены. Полный suite после этих правок: 301/301.

Проверить: первая общая компактная колонка перед Исполнителем (Collection: ♪ + cover, Wish-list: cover), одинаковое положение ноты при разных длинах Album. CRUD остаётся справа, сортировка и CSV прежние. Неактивная нота нейтральна, активная имеет тёплый фон; touch targets не меньше 44 px. Tab/Enter/Space работают как у native buttons, focus после favorite остаётся на ноте, после закрытия viewer — на cover control.

Viewer закрывается × справа сверху или Escape; owner дополнительно видит управление, guest — только изображение. В строке действий «Удалить» слева, «Сохранить» справа. Светло-серый quote block без рамки и тени сохраняет все строки и меньший attribution на desktop/mobile. Обновлены regression tests структуры колонок, сортировки/CSV, focus, порядка действий, multiline и точности каталога. Backend/API/Sheets/storage/permissions в этой UX-коррекции не менялись; сохранены их security/data-integrity regression tests.

Повторная техническая проверка в браузере: desktop 1440×1000 и mobile 390×844; первая колонка и выравнивание нот, переключение Enter с возвратом focus, закрытие viewer через ×/Escape с возвратом focus, расположение owner-действий. Mobile: thumbnail 48×48, нота 44×44, nested interactive controls — 0. В гостевом Wish-list запись без cover содержит только действие просмотра записи, без placeholder и controls изменения. Многострочная цитата сохраняет переносы и помещается в компактный блок. Повторная visual acceptance принята владельцем.
