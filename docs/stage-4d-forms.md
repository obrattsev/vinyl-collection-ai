# Stage 4D — формы, обложки и тексты: локальный результат

> Актуальный итог: **LOCAL DONE / PRODUCTION PENDING**. Функциональный scope принят/закрыт владельцем; финальные checks завершены, ручная приёмка локального stand ожидается. Исторические статусы ниже относятся к предыдущим итерациям. [Финальный отчёт](stage-4d-final-readiness.md).

**LOCAL DONE — принято владельцем 15.10.2026.** Выполнен только разрешённый блок 4D.1/2/4. Предыдущие локальные 4D.7/8 сохранены; 4D.8 принят владельцем, SMTP/migration006/production smoke остаются на общий выпуск.

## Реализованы все восемь изменений

1. В Add confirmation не показывается неактивная «Убрать файл». При возврате к редактированию draft активная очистка выбранного файла доступна.
2. Edit существующей записи с Cover содержит «Удалить обложку». Действие ставит отметку, которую можно отменить. Draft и confirmation сообщают о будущем удалении; Cancel формы не удаляет Cover.
3. Intro «Найдите нужные пластинки…» удалён из обоих разделов.
4. «Обложка (необязательно)» заменена на «Добавить обложку».
5. Add CTA — «Добавить».
6. Edit CTA — «Изменить».
7. Убрано «0 — бесплатно» из placeholder цены покупки/продажи.
8. Убраны placeholders годов альбома/пластинки и даты покупки; существующие input masks и validation не менялись.

Изменены только prototype/index.html, wishlist.html, app.js, cover-ui.mjs плюс tests/docs. CSS и quote/background assets не менялись. Перенос Wish-list сохраняет собственный прежний preview flow.

## Подтверждение и целостность

Add/Edit CTA сохраняет прежний шаг проверки/preview; первый клик не записывает данные. Required fields, даты, цены (включая ноль), legacy values, duplicates и UUID/revisions остаются прежними.

Удаление обложки в Edit выполняется только после финального подтверждения: успешный metadata PUT → проверенный ответ той же записи → DELETE Cover с актуальным If-Match и CSRF. Сессия/auth epoch проверяются перед второй операцией; двойной confirm блокируется. На конфликте старая отметка удаления сбрасывается. До confirmation, после cancel, при ошибке metadata или смене сессии DELETE не отправляется.

Metadata/Cover остаются двумя запросами, как прежняя Add+Cover операция. Если поля сохранены, а Cover delete не удался/не подтверждён, UI явно сообщает частичный результат и необходимость обновить список, без автоматического повторения. Backend API/ownership contracts не изменялись. Отдельный Cover dialog, upload/replace pipeline и ограничения типов/размеров сохранены.

## Проверки

- Full regression: **459/459**, из них 16 новых UI tests.
- Full PostgreSQL integration: **99/99**, включая ownership/session/revisions/Covers и сохранённые release/report tests.
- Реальный изолированный Chrome: Collection и Wish-list, desktop 1440×1000 и mobile 390×844 — четыре комбинации. В каждой проверены Add с upload/preview/confirmation, Edit/undo/remove mark/confirmation, сохранённый note и coverId=null; JS errors: 0. Mobile dialog укладывается по ширине, финальная кнопка доступна через штатную прокрутку. Скриншоты сохранены отдельно.
- Новые негативные tests: cancel/undo/no-cover, guest, metadata conflict/error/wrong id, cover error/unknown result, смена сессии, duplicate confirmation, сохранение field constraints и возврат clear-file action из confirmation в draft.
- npm audit: **0 vulnerabilities**. git diff --check и syntax/secret review — passed.

Браузер работал с существующим memory acceptance stand и вымышленными записями/изображениями, без PostgreSQL/Google Sheets/Postbox. Внешние браузерные HTTP запросы блокировались. PG tests использовали отдельно маркированную fixture DB с ownership guard. Production и реальные данные не менялись.

Хеши всех 29 предшествующих локальных файлов сохранены до начала. До обновления документации 28 оставались побайтово неизменными; общий app.js получил только добавочные UI изменения с сохранёнными hooks 4D.8. Последующие docs менялись только для актуальных статусов/разрешений. Quote code/assets, styles.css, жанры и reset/favorite handlers не тронуты. Операций с тестовыми S3 ресурсами не было.

Commit/push/merge/deployment не выполнялись. После подготовки работа остановлена для приёмки этого блока. Жанры/фильтры и визуальная приёмка цитат не начинались.

Последующее решение: жанровый фильтр разрешён отдельным локальным блоком. Отдельного production-релиза форм нет; quote/background по-прежнему не менять.
