# Stage 5 handoff — Vinyl Collection AI

**Состояние на 16.10.2026: Stage 4A–4E DONE / Stage 4 COMPLETE. Stage 5 не начат; выполняется в новом чате.**

## Проект и production

Сайт https://vinyl-collection.ru; репозиторий obrattsev/vinyl-collection-ai. Node.js 24, обычные HTML/CSS/JS modules и собственный HTTP API, PostgreSQL 16. Nginx → приватный Node listener, systemd. Действующий подтверждённый SHA `18d0a430299a3b20c36ddf725de2547aee16e2aa`, PostgreSQL schema **7**. Covers — локальные WebP image/thumb; Sheets — односторонний mirror первоначального владельца и архив Bug Reports. Yandex Cloud Postbox — регистрация/recovery, Bug Reports и ежедневная статистика (10:00 МСК, retries 10:05/10:10).

Секреты и конфигурация вне Git. PostgreSQL — единственный источник пользовательских данных. Auth: серверные сессии, CSRF, ownership; приватность проверяется сервером, включая Covers. Нельзя обращаться к Sheets из браузера. Owner/mirror-linked аккаунты защищены от самостоятельного удаления.

## Реализовано в этапах 1–4

- 1–2: модель Collection/Wish-list, validation/UUID, CRUD с подтверждением, поиск, публикация и защита изменения данных.
- 3: Edit/Transfer, сортировка/CSV, mobile detail, Bug Reports, Favorites/Covers, curated quotes, streaming lookup/preview.
- 4A–4C: PostgreSQL foundation/cutover, backup/restore и mirror; регистрация с email verification, recovery, личный кабинет, настройки публичности, password/session lifecycle и самостоятельное удаление обычных аккаунтов.
- 4D: безопасные releases/rollback с проверкой nginx generation и старых workers; durable Bug Reports + Postbox; формы/обложки/пустые значения/жанровые фильтры; PostgreSQL daily activity/addition counters и email statistics.
- 4E (PRODUCTION DONE): public Collection initial HTML, escaped metadata/OG/canonical, robots/sitemap только активных публичных Collection; private HTML 404/noindex, API privacy сохраняется. Wish-list noindex/вне sitemap. Записи внутри Collection, без отдельных URL. Schema/dependencies не меняются.

## Согласованный Stage 5: 5A → 5B → 5C → 5D

Каждый подэтап принимается отдельно. Детальный scope — основной backlog; перед реализацией проверить актуальные первичные API/лицензии/тарифы, не расширять модель без необходимости.

- **5A:** поиск релизов/обложек MusicBrainz + Cover Art Archive в существующих Add/Edit. Кандидаты и неоднозначность видны; сохранение только по выбору пользователя; ручная загрузка остаётся. Проверить права использования изображений.
- **5B:** реальные короткие музыкальные цитаты по Collection, ежедневная ротация и curated fallback. MusicBrainz/LRCLIB/Groq — кандидаты, не обещанная интеграция. Публичное использование lyrics требует прав; полные тексты не хранить/публиковать. При отсутствии законного способа согласовать альтернативу.
- **5C:** фото → распознавание → черновик существующей формы, кандидаты и ручное подтверждение. Минимизировать передачу персональных данных, ограничить файлы/стоимость/время.
- **5D:** естественный язык → строго проверенные фильтры → параметризованный запрос только в пределах session user. Обычные фильтры остаются fallback.

## Ограничения и решения

Использовать существующий стек. Без frontend/SSR framework, CMS, Redis, vector DB, локальных LLM, AI microservice, Kubernetes и новых очередей: текущий объём этого не требует. Внешний AI не обходит auth/validation/confirmation; сбои не блокируют CRUD. Общий чат и автономное обогащение вне scope.

Release: соблюдать три обязательные фазы из AGENTS.md. В выпуске 4E initial smoke выполнялся без подтверждения готовности listener, затем approval/session interruption оставило maintenance на 4 ч 52 мин; причина первого сетевого отказа точно не сохранена. Расследование и документы выполнять после восстановления доступности. Точный разрешённый SHA, compatibility, maintenance generation + retirement старых nginx workers, backup и фактический isolated restore обязательны. Rollback только приложения; автоматический PG restore запрещён. Runbooks: stage-4d-production-plan.md и stage-4d-maintenance-retry.md. Не менять production без разрешения. Самостоятельные UI проверки не проводить; при явной необходимости поднять изолированный стенд и попросить владельца проверить конкретный сценарий.

Финальные проверки: HTTP 11/11, routing 56/56, SEO/privacy 34; данные/сессии/Covers сохранены, mirror read-back PASS, backup/restore PASS, Postbox TLS/auth PASS, timers active, frozen=false. Ежедневный отчёт за 15.10: sent, attempts=1. Отложено: подтверждение его получения в ящике и внешняя индексация/Search Console/Вебмастер. Bug Report email получен владельцем. Сторонние поисковые/OG кеши не удаляются мгновенно при закрытии коллекции; сервер немедленно прекращает выдачу по новым запросам.

**Первый шаг Stage 5:** прочитать этот handoff и актуальный backlog, затем исследовать только 5A: MusicBrainz/CAA API, права, лимиты и минимальный flow выбора обложки. Не повторять аудит завершённых этапов без причины.
