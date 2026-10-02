# Последние две правки Stage 3E

Local acceptance Streaming/controlled rollback **пройдена по подтверждению владельца**. После неё разрешены только optional Cover при первоначальном Add и primary variant mobile Wish-list Transfer. Эти правки реализованы в `feature/stage-3e` и приняты владельцем с одной поправкой: блок обложки в Add перенесён наверх, перед полями пластинки, в обоих разделах, как в подтверждении. Дальнейшее функциональное расширение Stage 3 прекращено. Финальная правка порядка обложки принята 02.10.2026; владелец разрешил commit/push/PR/merge/deploy. Результат выпуска фиксируется отдельно.

## Optional Cover только при Add

В существующих Add Collection/Wish-list — необязательный file input, небольшой preview до 100px по высоте и «Убрать файл». Выбор файла не входит в metadata `name`/draft/JSON, duplicate rules, search/sort или CSV. Edit и Transfer скрывают этот блок. При cancel/reset/close/auth change файл и preview очищаются; поздний FileReader callback не восстанавливает старую картинку. Во время проверки/подтверждения выбор блокируется, чтобы файл не менялся между просмотром и записью.

Существующий Cover dialog не меняет структуру или поведение: Add/Replace/Delete/Save/× работают по Stage 3D. Из него выделена только общая функция клиентской проверки MIME и размера, используемая обоими входами: JPEG/PNG/WebP, до 10 MiB; HEIC по-прежнему исключён. Оба используют FileReader для локального preview. Изображение, фактический формат, предел 16 мегапикселей, нормализация, storage и durable holds проверяются прежним server pipeline, который не изменён. Клиентский preview не является доказательством валидности изображения: такой файл может быть отвергнут сервером после успешного metadata Add, с частичным успехом ниже.

Последовательность без новой транзакции:

1. Прежний metadata POST и подтверждение создания. Если файл не выбран, дальнейшее поведение идентично прежнему Add.
2. Если файл выбран, полная возвращённая запись проверяется действующей моделью и на соответствие отправленным metadata. Нет подтверждённой корректной записи — нет Cover PUT, действует прежний RESULT_UNCONFIRMED guard.
3. Для подтверждённого ID выполняется ровно один прежний `PUT /api/{collection|wishlist}/{id}/cover`, с CSRF, MIME и If-Match ревизией ответа Add. UI остаётся busy до завершения обоих шагов; duplicate click не создаёт повторных запросов.
4. Успех — прежнее сообщение Add и прежний refresh полного списка; активная сортировка сохраняется, thumbnail приходит в ответе GET без ручного reload. Поиск после Add работает как прежде, не как Edit.
5. Metadata error/unknown — Cover не отправляется, прежнее сообщение/блокировка Add сохранены.
6. Metadata success + Cover error — созданная запись не удаляется; сообщение «Пластинка добавлена, но обложку добавить не удалось…». Можно открыть обычный Cover dialog позже.
7. Неизвестный Cover result — отдельное сообщение «Пластинка добавлена, результат добавления обложки не подтверждён…». Слепого retry/rollback нет; после чтения списка включается прежний requireRefresh guard для RESULT_UNCONFIRMED/RECORD_CHANGED/NOT_FOUND. Durable holds и ограничения Sheets не менялись.

## Mobile Wish-list Transfer

Единственное изменение — существующая кнопка «Добавить в коллекцию» больше не получает `button-secondary`. Используется прежний default primary style: тёмный фон, белый текст. Текст, порядок, размер, spacing, handlers и handoff в старый Transfer dialog не менялись. Desktop Transfer не изменён. CSS существующей `.button-secondary` содержит только цвета, поэтому удаление класса не меняет геометрию.

## Проверки

Полный suite: **386 passed, 0 failed, 0 skipped**. Сохранены все Streaming/Stage 3 проверки. Добавлены 23 tests: 21 UI и 2 реального service/storage pipeline. Старое утверждение, запрещавшее вообще слово cover в Add HTML, заменено точным контрактом: metadata поля coverId/favorite отсутствуют, optional file input не имеет metadata name.

UI tests для Collection/Wish-list: без файла, с файлом, MIME/size, metadata failure/unknown, Cover failure/unknown, некорректный metadata response, неверный ID cover response, cancel/reopen/clear, pending/stale FileReader, busy и double confirm. Новая кнопка Transfer проверяется на класс, прежний порядок и прежний handoff. Полный suite включает ограничения изображения/мегапикселей, storage integrity, auth, CSRF, unknown writes и отсутствие опасных retry.

Два integration tests вызывают настоящие Add и Cover services на memory repositories и temporary storage: corrupted image после Add оставляет запись с coverId=null и не создаёт assets; последующий явный корректный Cover PUT связывает ресурс только с созданным ID, сохраняет нормализованные файлы, освобождает hold и не вызывает удаления записи. Проверка не утверждает транзакционность Sheets: ограничения прежней архитектуры и сохранение hold при неопределённом результате остаются.

Browser, только localhost и вымышленные данные:

- Collection Add без Cover: обычный success и строка без thumbnail.
- Collection Add с PNG: обычный success, thumbnail сразу в новой строке. Открытый существующий Cover dialog имеет прежние title/preview/file/Delete/Save/×, без новых Add controls.
- Wish-list Add с PNG: форма заполнена на desktop, затем проверена и сохранена на mobile; thumbnail сразу доступна в compact list и desktop table.
- 390/360px Add: body равен viewport, dialog 352/322px, preview 100px; при 390px содержимое 1274px прокручивается внутри окна 814px. Кнопки доступны внизу, горизонтального overflow страницы нет.
- Mobile Owner Wish-list: Transfer тёмная с белым текстом, на 360px размер 284×44px; порядок после Edit/Delete сохранён. Нажатие открывает прежний Transfer dialog с тремя purchase fields, нового Cover input там нет; операция отменена без переноса.
- Desktop Wish-list после Add: clientWidth=1168, scrollWidth=2052, native scrollbar 14px; row actions в последней ячейке. Table CSS/row density этой правкой не менялись.
- Desktop Streaming The Wall: прежний автоматический RU → US, US URL и iframe 1065975633; после закрытия iframe отсутствует. Apple код/CSP/lookup/mobile mount и lifecycle этой правкой не менялись; утверждение о новом аудио-тесте не делается.

`git diff --check` проходит. Self-review: существующий UI меняется только в Add block и цветовом классе mobile Transfer. Security review: upload остаётся same-origin owner/CSRF/version protected; ID проверяется до построения Cover URL; metadata не содержит File; внешний HTML не вставляется. Data-integrity review: Cover начинается только после подтверждённого Add, PUT на тот же ID с актуальной ревизией, отсутствие rollback/retry, отдельный partial/unknown status. Backend/models/Sheets mapping/duplicate rules/CSV/dependencies этой правкой не изменены.

## Короткая acceptance

Стенд http://127.0.0.1:8014/collection и http://127.0.0.1:8014/wishlist. Пароль `local-acceptance-only`. Стенд перезапускается после проверки, вымышленные изменения сбрасываются; `.env`/Google clients не используются.

1. Добавить по записи с Cover в Collection/Wish-list; thumbnail должна появиться сразу. Проверить также Add без файла и cancel/reopen.
2. Открыть Cover у существующей записи: прежний dialog.
3. На mobile проверить Add scrolling и тёмную «Добавить в коллекцию» на прежнем месте.

02.10.2026 владелец принял финальные правки, включая верхнее положение блока обложки, и разрешил commit → push → PR → merge → deployment. Production smoke выполняется без изменения реальных записей; финальная визуальная production acceptance остаётся за владельцем.
