# 3E — Streaming по требованию

Актуальный статус 3E: deployment 02.10.2026 выполнен, технический production smoke пройден; [отчёт](stage-3e-production.md). Ожидается финальная визуальная production acceptance владельца.


Статус: реализация в `feature/stage-3e`, local acceptance после controlled rollback подтверждена владельцем; [две финальные правки](stage-3e-final-polish.md) приняты владельцем; Git/deployment разрешены 02.10.2026. База — main `fb073dbe219d602890b66ad6253824507eb86a29`, включает runtime 3D `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63` и production-отчёт. 3D deployment/backfill выполнены; финальная визуальная production acceptance в предыдущем отчёте остаётся pending. 3E — последний функциональный пакет Stage 3; до local acceptance, разрешённой финализации Git, deployment и production acceptance пакет и этап не считаются завершёнными. Deployment разрешён владельцем 02.10.2026; схема и данные Sheets не меняются.

## Пользовательский контракт после controlled rollback

UI baseline — `fb073dbe219d602890b66ad6253824507eb86a29`; файлы presentation в нём совпадают с runtime 3D `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63`. Presentation восстановлен непосредственно из Git, затем наложены минимальные Streaming hooks. Общего desktop/mobile detail нет.

Desktop сохраняет прежние table wrapper, columns по роли, padding/alignment, сортировку, первую Favorite/Cover группу, конечную колонку CRUD, поиск и breakpoint 1120px. Единственный desktop-вход Streaming — название Album: нативная кнопка без добавочных padding/min-height, не увеличивающая строки. Она открывает отдельный read-only `streaming-dialog`: Artist — Album, существующая обложка при наличии, «Прослушать», результат/выбор кандидата, Apple player и внешняя ссылка, ×. Никаких record metadata, CRUD, Favorite или cover-management действий. Семантика одинакова для guest/owner Collection/Wish-list.

Cover control полностью сохраняет Stage 3D: отдельный Cover dialog с прежними preview, owner file picker/Add/Replace/Delete/Save/Cancel/×. Cover не является Streaming entry point; Streaming в Cover dialog отсутствует. Поведение Cover dialog восстановлено из baseline; финальная правка Add Cover выделяет только общую проверку типа/размера файла без изменения dialog UX.

Mobile ≤1120px сохраняет прежние compact list → full detail, поля по роли, Favorite/Cover и Owner actions. В `mobile-records.mjs` добавлены только mount/cleanup Streaming. CSS, структура и логика существующего mobile detail не переработаны.

Два явно разрешённых исключения из production baseline: (1) существующий `overflow-x:auto` получил native CSS scrollbar track/thumb высотой 14px через `::-webkit-scrollbar`, чтобы полосу было видно и можно было перетаскивать мышью в проверенном WebKit; никаких JS scrollbar/стрелок; (2) удалён только wishlist override, ставивший `.row-actions` вертикально. Обе таблицы используют прежний общий горизонтальный flex, padding и vertical alignment; фиксированной высоты строк нет. Колонка действий Wish-list естественно становится шире, строки ниже. В браузерах без этих scrollbar pseudo-elements остаётся системный native scrollbar; их визуальное поведение отдельно не проверено.

До «Прослушать» нет Apple lookup/iframe/artwork. Один клик автоматически запускает RU → US: только валидный `not_found` RU запускает US. Matched или ambiguity останавливают цепочку; ambiguity требует выбора из максимум пяти кандидатов, без загрузки Apple artwork. Ошибка останавливает цепочку и не подменяется no-result. После no-result в обоих storefront показано «Альбом не найден». Кнопки ручной смены каталога нет; storefront пользователю выбирать не нужно. Повтор после ошибки начинает ту же цепочку с использованием cache.

Однозначный результат или выбор кандидата создаёт один официальный iframe и постоянную безопасную ссылку «Открыть в Apple Music ↗». Звук запускается пользователем в Apple player, autoplay не используется. Приложение не обещает наличия preview, фиксированных 30 секунд или доступности US по месту нахождения. Выбор transient и не записывается в пластинку.

Закрытие desktop Streaming dialog/mobile detail уничтожает iframe, abort/ignore незавершённого UI lookup; повторное открытие начинает с «Прослушать». Resize через breakpoint закрывает Streaming; переход из mobile detail к CRUD/Cover также очищает player. Desktop focus возвращается к Album, при переключении на mobile — к сортировке. Существующий mobile focus lifecycle сохранён. Native × и Escape работают в документе приложения; cross-origin Apple iframe может перехватывать Escape. Обходить same-origin boundary нельзя.

## API и matching

`POST /api/streaming/lookup`, same-origin JSON для guest/owner, без необходимости UUID или owner CSRF. Существующая origin-проверка применяется до route; owner authorization остальных изменяющих API не меняется. При отсутствии auth configuration POST fail-closed. Другие методы — 405.

Разрешены ровно `artist`, `album`, `albumYear`, `storefront`. Artist/Album: непустые строки до 300 символов без control characters; год — четыре цифры; storefront — ru/us. Body ≤4 KiB, ожидание body ограничено 5 сек. В provider уходят только публичные artist/album и region, не request headers/cookies/session/CSRF/UUID/private metadata. Год используется локально в matching/cache.

Fixed upstream: `https://itunes.apple.com/search`, `media=music`, `entity=album`, `country`, `limit=50`, term Artist + Album. Если среди ответа нет подходящих кандидатов, допускается один дополнительный поиск Album с `attribute=albumTerm` в том же storefront. Redirect запрещён, credentials omit. Никаких user-supplied upstream адресов.

Техническая нормализация: Unicode NFKC, lowercase, trim/сжатие пробелов, типографские кавычки/дефисы. Без AI, транслитерации и fuzzy correction. Artist должен совпадать. Album должен совпадать либо отличаться только распознаваемым конечным edition suffix в скобках (remaster/deluxe/anniversary/expanded/live/remix); suffix остаётся видимым. Единственный кандидат с точным title и годом — `matched`. Несколько подходящих изданий или несовпадение года — `ambiguous`, даже если один кандидат точный. Нерелевантный первый результат не выбирается. Порядок: exact, близость года, title, URL; dedup по ID; ответ максимум пять кандидатов. Альтернативные написания могут давать no-result — это сознательная граница matching.

Проверяется структура JSON, resultCount, поля album, releaseDate, целочисленный collectionId и совпадение ID в URL. Только HTTPS `music.apple.com`, пути `/ru|us/album/[slug/]numeric-id` соответствующего storefront, без credentials/нестандартного порта/hash; query удаляется. Iframe строится заменой строго проверенного host на `embed.music.apple.com`, сохранением пути и региона. URL/ID не доказывает availability embed, поэтому внешний fallback обязателен.

Успех: `{status: matched|ambiguous|not_found, storefront, candidates: [{artist,album,year,url}]}`. Ошибки: 400 INVALID_STREAMING_REQUEST/INVALID_REQUEST; 504 STREAMING_TIMEOUT; 429 STREAMING_RATE_LIMITED (либо отдельный ingress RATE_LIMITED); 502 STREAMING_INVALID_RESPONSE; 503 STREAMING_UNAVAILABLE/STREAMING_BUSY; 500 INTERNAL_ERROR. Retry-After для ограничений. UI различает ошибки и даёт «Повторить поиск», начинающий ту же RU → US цепочку с использованием существующего cache.

## Ограничения нагрузки

- Самостоятельный ingress limiter: 10 запросов/мин/IP, 100/мин суммарно. Не расходует лимиты login/read/reports; использует существующее доверенное определение client IP.
- До двух параллельных разных lookup. Одинаковые coalesce до ограничения concurrency.
- До 15 upstream requests за скользящую минуту, включая второй запрос; обработка provider 429 и ограниченного Retry-After (1–3600 сек).
- Каждый upstream request ≤5 сек включая чтение body; один региональный lookup — максимум два последовательных requests. Автоматическая RU → US цепочка — до двух API lookup и четырёх upstream requests (до 20 сек upstream deadlines плюс накладные расходы), если нет cache и лимиты позволяют; каждый запрос учитывается прежними ограничителями. Response ≤512 KiB по header и фактическому stream; проверка JSON Content-Type, включая iTunes text/javascript без JSONP.
- RAM LRU ≤500 metadata entries: успешные/неоднозначные 1 час, no-result 5 минут; ошибки не кэшируются. Key: версия нормализации + Artist/Album/Year/storefront. Возвращаются clones, shared cache нельзя изменить через ответ. После restart cache пуст.

## Privacy, безопасность и данные

CSP дополнена только `frame-src https://embed.music.apple.com`; script-src/connect-src/img-src и остальные ограничения сохранены. Iframe получает title, высоту 450px, `allow=encrypted-media; fullscreen`, `referrerpolicy=no-referrer`; не получает autoplay permission. Native iframe без экспериментального credentialless и без sandbox, который сломал бы официальный player. Apple остаётся отдельным origin и может использовать свои cookies/storage/telemetry. `no-referrer` проверен с playback в desktop Safari. Ненавязчивая подпись сообщает provider, без дополнительного blocking consent modal.

Никаких MusicKit API/JS/developer tokens, собственного audio/previewUrl, audio proxy/cache/download, scraping или внутренних Apple API. Используются публичный Search API и официальный embed, в контексте альбома и с постоянным переходом к Apple. Официальные основания принятого решения: [Search API](https://performance-partners.apple.com/search-api), [Apple marketing tools](https://artists.apple.com/support/1117-apple-music-marketing-tools), [Music Web privacy](https://www.apple.com/legal/privacy/data/en/apple-music-web/), [identity guidelines](https://marketing.services.apple/apple-music-identity-guidelines). Эти источники не дают SLA доступности RU/US или гарантии длительности preview.

Record models, Google Sheets mapping, UUID, revisions, duplicate rules, CSV, CRUD, transfer, public projection, Covers/Favorites, quotes/reports остаются прежними. Streaming service не получает repository/Google clients и не выполняет записи. Зависимости не добавлены/изменены. Google Sheets действуют до будущего 4A; Stage 4/5 сейчас только roadmap.

## Проверка

[Local acceptance и ограничения](stage-3e-acceptance.md). Automated suite использует fixtures/mocked fetch и не зависит от живого Apple.
