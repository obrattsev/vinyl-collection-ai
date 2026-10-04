# Stage 4B — production report, 04.10.2026

Production cutover, owner smoke, final data verification and cleanup completed. PostgreSQL is the only runtime Collection/Wishlist source; existing owner Sheets are the one-way mirror. Stage 3 UI remains the regression contract. Stage 4C–4F and Stage 5 are not started. CSV file-saving verification has the browser limitation stated below.

## Release and database

Implementation commit: `40dab8a586d0a9f969327a0ec3a6c0da1fdf3d6e`; [PR #26](https://github.com/obrattsev/vinyl-collection-ai/pull/26); merge and active RELEASE/current: `2ccb47b50cb3903d1542a273a84d963d4d98cc36`. Previous Stage 3 release `da16da2dd257ee7175278ddb38ebee31aa7f2138` is retained. Documentation-only follow-up does not change the active application release.

PostgreSQL 16.15 (Ubuntu package 16.15-0ubuntu0.24.04.1), database `vinyl_production`, listener only `127.0.0.1:5432`, loopback SCRAM. No Docker, ORM or PgBouncer. shared_buffers 128MB, work_mem 4MB, maintenance_work_mem 64MB, max_connections 20. App pool 3, mirror pool 1. Two migrations: unchanged `001_data_foundation.sql` and additive `002_cutover_mirror.sql`; checksums/locking retained.

Separate non-superuser roles: `vinyl_migrator`, `vinyl_app`, `vinyl_mirror`, `vinyl_backup`. Runtime has no schema/database CREATE, user DELETE or visibility UPDATE; its required user row lock was verified with the actual app role. Backup can update only freeze/timestamp control columns besides SELECT; mirror can update only its synchronization metadata. Config files under `/etc/vinyl-collection-ai/` are root-owned 0600, outside Git. Existing owner password/hash was not changed.

First User UUID: `5c621d27-1477-46d3-a1f9-92311f53856d`; normalized login `obrattsev`, approved email `obratsev@yandex.ru`, full name null, both lists public. The existing owner session is mapped server-side only to this UUID. Client input cannot choose identity. Registration, email verification and account lifecycle remain future work.

## Backup and migration evidence

Protected operation directory: `/var/backups/vinyl-4b-20261004/`.

- `preflight-source/` and `final-source/`: raw/canonical snapshots, manifest/hash and complete cover inventory; final source matched preflight exactly.
- `covers.tar`, extracted `cover-extraction/`: 74 files, each SHA-256 matched. All 37 cover directories, including the known orphan, were preserved.
- `protected-config.tar`, `previous-release.txt`, `app-sheets.env`, `SHA256SUMS`: private config and rollback release evidence. No secret contents in this document.
- `empty-schema.dump`: custom dump and pg_restore inventory checked before import.
- `post-import/`: verified PG/Covers backup; actual marked-test-DB restore plus every cover checksum passed.
- `pg-roles.sql`, `postgresql-config.tar`, `PG-CONFIG-SHA256SUMS`: private role/config recovery material; not in Git.
- `/var/backups/vinyl-postgresql/20261004T111553Z`: first daily-unit backup, separately restored and compared.
- `final-clean/`: post-smoke backup, dump SHA-256 `b25a701aaca1af120778a0df3b86ef96177771d8f88a71579cf411942ea648c9`; third actual restore passed, including business_writes=8 and mirror 9/9.
- `restore-verification.json`, `daily-restore-verification.json`, `final-restore-verification.json`, `owner-smoke.json`: operation proofs. All three temporary databases were removed only after successful verification and test marker checks.

Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён.

No S3/SFTP provider added. Provider disaster restore/RTO was not exercised. Logical restore was exercised on this VPS in isolated databases, never by overwriting production.

## Data and cutover

| Check | Before | Final |
| --- | ---: | ---: |
| Collection | 29 | 29 |
| Wishlist | 12 | 12 |
| Favorites | 5 | 5 |
| Referenced covers | 36 | 36 |
| Cover directories/files | 37 / 74 | 37 / 74 |
| Missing cover files | 0 | 0 |

Canonical UUIDs/fields and every stored revision matched the source after import and again after smoke cleanup and application restart. canonicalizedIds=0. Final canonical hashes:

- Collection: `b4c8e0b22a28d88140238bbd47b2a5d5b5a18a08b1ddcadb5c8956eef3ba5b9d`.
- Wishlist: `d40334a13bf243164254232498323777466ebe259fba0dd4f19c4f4b173989cc`.

Legacy application stopped at 11:13:28 UTC; PG application started at 11:15:01 UTC (about 93 seconds maintenance). The separate precutover process initially failed because two env paths were interpreted as one filename; the temporary unit configuration was corrected before switching current. This was not resource pressure and did not alter data. Media and rollback gates then passed. PG writes were thawed after verification. A second short PG freeze for final cleanup/backup lasted roughly four seconds; reads remained available. Final frozen=false.

## Smoke, media and mirror

Actual owner login was performed by the owner in the browser; no password was requested in chat. Disposable-only UI checks passed: Add with Cover, Edit (including zero price), Favorite, reload, Wish-list Add, atomic Transfer, and Delete. Private purchase fields appeared only in owner detail. Original records were never modified for smoke.

The two resulting test Collection records were deleted through the normal UI. The transferred Wishlist row disappeared atomically. The one generated test Cover was removed only after confirming ownership, no references, absence from the original inventory and exact recorded UUID; metadata was retained until filesystem removal. All 74 original file checksums then matched. Known orphan `b6098f29-d064-4632-8c25-b228345abe26` remains preserved.

Before switching, all 36 referenced Covers passed GET and HEAD for image/thumb. Orphan GET/HEAD returned 404, with no filesystem fallback. Foreign/private/DB-failure cases passed isolated integration tests; no artificial DB outage or private user was introduced into production. No nginx filesystem alias or cache was added.

Controlled mirror test: pause worker, successful Favorite mutation → generation 4 / synced 3, then resume and verify synchronization. Final reconciliation after cleanup: generation=9, synced_generation=9, failures=0, last_error=null. Eight disposable business mutations committed; mirror read-back and frozen rollback gate both matched the original canonical data. After these writes, direct rollback to an unverified Sheet is prohibited; use freeze→backup→reconcile→read-back gate.

Guest pages/API, search, default Artist/Year ordering and compact responsive detail were checked. Streaming HTTP lookup returned 200/not_found for the selected query; playback availability remains Apple-dependent. Bug Reports remained on its separate Sheet: one disposable report was created, release SHA verified, only that exact row removed, and original zero-row state compared.

CSV UI action was invoked without JS errors, but the in-app browser did not deliver a download event, so an actual saved production CSV file was not verified. CSV generation/projection/escaping remain covered by the passing regression suite and prior local acceptance; this is an explicit manual-download check limitation, not a claim that a file was downloaded.

## Operations

- `vinyl-mirror.service`: enabled, running as vinyl, read-only filesystem, MemoryMax 192M, retry/reconciliation logic in the release.
- `vinyl-pg-backup.timer`: enabled, daily 03:20 UTC plus up to five minutes jitter; protected `/var/backups/vinyl-postgresql/`, 7 daily + 4 weekly. Dedicated role, freeze/drain/checksum/thaw, protected status.json, failed unit on errors. Never overlap manual cutover/freeze; a busy mirror/manual freeze defers with visible failure rather than claiming success. Retry deliberately after inspection.
- `vinyl-pg-health.timer`: every five minutes; checker `/usr/local/lib/vinyl-collection-ai/pg-health.mjs`, sanitized `/var/lib/vinyl-collection-ai/monitoring/health.json` and journal/failed-unit visibility. Checks DB connectivity/size, services, freeze, mirror lag/error/freshness, backup result/age, disk and RAM/swap. Zabbix agent/config/server alerts were not changed; external alert routing is not claimed.
- Restore: provision a new token-marked test DB owned by its connection role, run `scripts/pg-restore-rehearsal.mjs BACKUP NEW_COVERS_DIRECTORY` with its private test env, inspect comparison and remove only that verified test DB. Repeat monthly and after schema changes. Production disaster restore remains a reviewed operator action with role/config recovery.

1 GiB swapfile `/swapfile-vinyl` mode 0600 is active and persisted in fstab; no reboot. Final sample: about 1.5 GiB available RAM, 22 GiB disk free, zero swap usage, DB about 8.45 MB. App, PG and mirror healthy. Existing nginx, SSH, WireGuard and Zabbix PIDs/start times remained unchanged; no firewall changes.

## Tests, review and remaining scope

Full post-cutover regression + isolated PostgreSQL integration: 436 passed, 0 failed, 0 skipped. npm audit: 0 vulnerabilities. No new dependencies. Diff/secret review passed: no local credentials, fixture images, dumps or runtime artifacts committed. Self-review covered actual least-privilege roles, server-side owner selection, transactional revisions/Transfer/mirror generation, restore and post-write rollback evidence; no unresolved data-integrity/security blocker found.

Remaining limits: temporary single-owner auth bridge; asynchronous non-atomic cross-document Google mirror, no exactly-once guarantee; filesystem orphan/account cleanup deferred to 4D; provider backup timestamp/disaster RTO and production CSV file-save observation unverified; alert delivery outside systemd/health JSON not configured. Retention logic tested but multi-week operation naturally not observed yet.

4C is not started. Next separately authorized work: choose email provider, then registration/Login+Password/email verification/recovery and session lifecycle. Profiles/deletion, public URLs/SSR and SEO remain 4D/4E/4F; AI remains Stage 5.
