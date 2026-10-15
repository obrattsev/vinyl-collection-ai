# Stage 4D.7 — безопасные релизы: локальный результат, 15.10.2026

> Актуальный итог: **LOCAL DONE / PRODUCTION PENDING**. Функциональный scope принят/закрыт владельцем; финальные checks завершены, ручная приёмка локального stand ожидается. Исторические статусы ниже относятся к предыдущим итерациям. [Финальный отчёт](stage-4d-final-readiness.md).

**LOCAL DONE — принято владельцем 15.10.2026.** Выполнен только первый пункт согласованной последовательности. Production, реальные данные, SMTP и облачные ресурсы не затрагивались. Код и новые документы 4D.7 не коммитились и не отправлялись. Документационные десять файлов 4C/roadmap отдельно опубликованы в [PR #32](https://github.com/obrattsev/vinyl-collection-ai/pull/32); merge не выполнен.

## Текущий процесс

Один Node 24 process за nginx, immutable release directories, current symlink и systemd restart. Env и Covers вне releases, PostgreSQL sessions. Уже есть freeze/drain, backup/migration/mirror helpers, checksum/advisory lock migrations. Это достаточная основа без новой инфраструктуры. App restart допускает краткую недоступность; фактический downtime не измерялся на production.

## Подготовленный процесс

1. Закреплённый SHA, проверенный artifact/lockfile и dependencies до окна, предыдущий совместимый runtime записан.
2. Свежий проверенный PG+Covers backup; record исходных mirror/timer/freeze/config states. Обычный update сохраняет AUTH_SECRET и auth_sessions.
3. Read-only preflight target/rollback/schema. Для code-only update migration не запускается. Любая неизвестная/изменённая migration или недоказанная rollback совместимость — STOP.
4. Короткое maintenance окно и завершение принятых запросов, атомарная смена current, restart приложения. Для DDL полный ingress gate и остановка app: business freeze не блокирует все auth writes.
5. Read-only HTTP smoke и after schema gate; проверка mirror, backup timer и freeze перед открытием ingress.
6. При ошибке — app rollback только на версию, совместимую с фактической БД. Никаких автоматических down migrations, PG restore или удаления sessions. При несовместимости — закрытый ingress и forward fix/решение владельца.

## Локальные изменения

- `release-policy.json`: multiuser, schema 5–5; будущие неизвестные migrations запрещены по умолчанию.
- `server/release-safety.mjs`: inspection RELEASE/policy/SQL без выполнения candidate code; проверка prefix/checksums/range обоих binaries и projected schema; READ ONLY DB transaction; freeze и configured mirror owner/lag/error gates.
- `scripts/release-check.mjs`: read-only CLI before/after, sanitized errors; не переключает release и не мигрирует БД.
- `scripts/release-smoke.mjs`: GET без cookies/redirect following, timeout, root/auth/assets/guest API/session checks и опциональный уже публичный profile с public projection validation.
- `docs/release-checklist.md`: пошаговые команды проверок и операторская процедура switch/rollback/backup/timer/mirror/secret gates.
- Новые regression и PG tests; backlog/deployment/план содержат актуальный локальный статус.

Дополнительных сервисов, БД, npm dependencies и CI/CD не добавлено. Runtime приложения и существующий migrator не изменены. Существующий pool уже ограничивает lock_timeout=5s и statement_timeout=10s; реальное ожидание advisory migration lock проверено локально.

## Проверки

| Проверка | Результат |
| --- | --- |
| Regression suite | 439/439 (включая 6 release unit tests) |
| Release unit tests после усиления mirror gate | 6/6 |
| PostgreSQL full suite | 88/88 |
| Дополнительный focused PG run | 2/2, включая новый lock timeout и повторную rehearsal |
| npm audit | 0 vulnerabilities |
| git diff --check / whitespace / secret review | passed |

Первый regression запуск был ограничен sandbox listen EPERM, затем полный suite прошёл с разрешёнными локальными sockets. Первый новый PG test использовал неполное login session представление; исправлен вызов штатного store.session, повторные suites прошли. Ошибок продукта этими двумя неуспешными попытками не обнаружено.

Rehearsal: маркированная test DB, синтетический пользователь и запись, capture email; свежий HTTP/auth runtime принимает прежний cookie после candidate switch и возврата previous. Local current symlink переключён, simulated unavailable candidate не прошёл smoke. Запись/UUID/auth hash/auth version/Cover hash и mirror state сохранены, schema не откатывалась. Это HTTP/auth-runtime rehearsal в одном test process, не перезапуск Linux systemd. Advisory lock wait завершился timeout приблизительно через 5 секунд, migration history не изменилась. Существующий integration suite проверяет DDL failure/rollback и checksum mismatch.

## Ограничения и следующий gate

Для первого upgrade старого 4C artifact без policy нужен отдельно проверенный внешний SHA-bound rollback contract; автоматической догадки о совместимости нет. Автоматический preflight не проверяет свежесть backup, стабильность config secrets или реальные systemd/timer состояния: это явные operator gates. Policy не доказывает безопасность SQL — нужен review/rehearsal. Smoke не проверяет доставку email/все CRUD и не удостоверяет target SHA; runtime current/RELEASE/artifact проверяются отдельно. Производственный downtime и реальные nginx/systemd rollback/timer transitions в этом цикле не тестировались.

Блок цитат не менялся. Фактически фон подключён к `.collection-surface .daily-quote` в Collection/Wish-list; root landing отдельного quote block не содержит. Asset `prototype/assets/quote-background.webp` — изображение потёртых конвертов, а не CSS-рисунок. До подтверждения владельца дизайн не менять. Предоставленная копия asset — не screenshot всего интерфейса.

Следующий шаг — приёмка **4D.7** владельцем. Только после неё переходить к Bug Reports/Postbox; recipient ещё не запрашивается и не назначается автоматически. Commit/push/PR для кода 4D.7 и любой production deployment требуют отдельного разрешения.

Последующее решение владельца: production deployment/rollback проверить в ближайшем согласованном релизе, отдельно сейчас не выполнять. PR #32 слит, локальный main синхронизирован; все 11 файлов 4D.7 восстановлены по SHA-256. Последующая 4D.8 использует schema 6 и дополняет явные compatibility attestations для additive migration, без автоматического разрешения неизвестного DDL.
