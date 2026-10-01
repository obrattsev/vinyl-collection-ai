# Production 3D — 30 September 2026

Runtime release: `9e4678f6aa8af38b26d1fc9d3d3de0638cf76d63`, merged [PR #21](https://github.com/obrattsev/vinyl-collection-ai/pull/21). Previous release `4c266df77eaf2f7ed1f749ba46ec6b35d4231316` remains available for code rollback. Repeat local acceptance was approved by the owner; final UI adjustments passed 301/301 tests and diff/security/data-integrity review. Final visual production acceptance belongs to the owner.

## Deployment and configuration

- Existing release archive process; Linux dependencies installed from lockfile with `npm ci --omit=dev --ignore-scripts`. Code remains root-owned and not writable by the application.
- Only `vinyl-collection-ai.service` was stopped/started for the release switch. No reboot. SSH, WireGuard, Zabbix and unrelated services/configuration were not changed.
- Added `COVERS_DIR=/var/lib/vinyl-collection-ai/covers`; directory `vinyl:vinyl 0700`, generated files `0600`. Existing app.env remains `root:vinyl 0600`; service-account JSON remains `root:vinyl 0640`. No credentials were committed or changed.
- Existing `ProtectSystem=strict` retained; application drop-in `/etc/systemd/system/vinyl-collection-ai.service.d/covers.conf` grants only `ReadWritePaths=/var/lib/vinyl-collection-ai/covers`.
- The site's original 64 KiB body limit remains for other routes. Only `/api/(collection|wishlist)/<id>/cover` has a 10 MiB limit. `nginx -t` passed and nginx was reloaded, not restarted; TLS configuration unchanged.
- Added only headers `Обложка ID`, `Избранное` to Collection and `Обложка ID` to Wish-list. Existing rows were not bulk-rewritten; blank favorite is false.

## Checks

- HTTPS HTML/API/quote catalog: 200. Six published HTML/CSS/JS/catalog resources match the merged release byte for byte. Public projection excludes private fields.
- All 54 public master/thumbnail endpoints returned 200 with image/webp after backfill. Restored archive ownership/modes match live storage; temporary source image staging was removed.
- Every Collection/Wish-list guest write route, including cover/favorite/transfer, rejects with 401. Reports GET rejects with 405.
- Owner logged in interactively; password stayed in the browser. Favorite toggle was confirmed by UI and public API, then restored to false and the original empty Sheets cell with explicit owner approval.
- One `Production acceptance test — 3D bug reports` row was checked for ID, UTC, text, collection section and exact runtime SHA, then deleted; reports values returned to the original empty state. Browser tooling later could not verify its administrative policy, so the post-send UI success state was not independently re-observed. Sheets persistence/cleanup was verified directly.
- Linux covers/API regression suite: 15/15 under MemoryMax=512M; peak RSS 231728 KiB. Production application peak observed 162926592 bytes, NRestarts=0. Backfill peak observed 243777536 bytes under its own 512 MiB limit.

## One-time initial cover backfill

This is a deployment/migration operation, not a persistent AI feature. No paid service or scheduler was added. Source metadata and artwork use [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) and [Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive/API). MusicBrainz requests use an identifying User-Agent and stay below [one request per second](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), with bounded backoff for temporary failures. CAA provides public archival access, not a blanket copyright licence. iTunes was not selected because its promotional-use requirements do not fit this UI.

Artist/Album/year matching excludes uncertain compilations and ambiguous versions. Fallback examines official vinyl releases within the confirmed release group. Only a single approved front image is accepted; back/booklet/medium/spine/tray and low-quality or inappropriate geometry are rejected. Selected artwork was visually checked for album identity, watermarks and mockups. Minimum short side 700 px. No metadata corrections were made to accommodate source differences.

Artwork is fitted without enlargement or cropping onto a 1200×1200 neutral square canvas, then passed through the existing 3D normalization service: WebP master 1200×1200 and thumbnail 144×144, with EXIF/originals omitted. The original master limit was not changed. Operations use the deployed presentation service, revision checks, shared queue within the migration process, verified Sheets writes and durable holds. Owner writes were suspended by agreement for the migration window; guest reads remained available.

The migration journal records intent before mutation and successful coverId afterward. Existing covers are skipped. An interrupted/unknown operation is not retried blindly, including after restart. Individual processing failures are isolated. Journal and source provenance remain in the private deployment backup; source image staging is removed after verification.

## Backup and restore

Private backup: `/var/backups/vinyl-3d-20260930` (root-only directory). Contains full Sheets grid snapshots and raw values before schema change, old app env/unit/nginx site, before/after cover archives, migration manifest/journal and verification results. Credentials and private snapshots remain outside Git. Original app/service/nginx backups are retained for rollback.

Before schema change the empty covers archive was restored into a separate staging directory and compared. After backfill the populated archive was restored into a separate directory; recursive content comparison and owner/mode comparison both passed. All 27 masters are 1200x1200 WebP and all thumbnails are 144x144; no unresolved holds remain.

For a future consistent backup: pause owner writes, wait for their completion, stop only the application, capture matching Sheets snapshots and `tar --acls --xattrs -cpf covers.tar -C /var/lib/vinyl-collection-ai covers`, including `.holds`, UID/GID and modes; then start the application and verify health. Protect archives with a root-only directory and mode 0600.

For restore: stop only the application; retain the current covers directory under a separate recovery name, restore the chosen archive into `/var/lib/vinyl-collection-ai`, and check owners/modes, every referenced master/thumbnail and `.holds`. Restore the matching Sheets snapshot only if data rollback is intended; do not replace newer legitimate writes with an old snapshot. Never delete unresolved holds or infer a failed Sheets write from a transient missing result. Start the application and check HTTPS/API/covers. Code-only rollback uses the retained previous release and does not automatically roll back Sheets or covers.

3B (including real reports) and 3C are complete. 3D is deployed; final visual production acceptance is pending. Streaming remains the last separate package of stage 3 and was not started. Dynamic/AI quote selection remains stage 4.

## Backfill result

| Section | Records | Already covered | Installed | Skipped | Write errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Collection | 28 | 0 | 21 | 7 | 0 |
| Wish-list | 12 | 0 | 6 | 6 | 0 |

All original cells, their formatting/validation/notes, UUIDs, metadata, favorite values and row order matched the baseline immediately after backfill. Later owner Favorite changes for Lou Reed - Berlin and Egor Letov - Concert in Leningrad were observed during final checks and preserved; the baseline is not a reason to overwrite subsequent user work.

Skipped records:

- collection: Love — Da Capo (Insufficient resolution or non-cover geometry).
- collection: The Velvet Underground — Live At Max's Kansas City (Insufficient resolution or non-cover geometry).
- collection: The Velvet Underground — Collected (No unambiguous album/year match).
- collection: Егор Летов — Концерт В Городе-герое Ленинграде (HTTP Error 404: NOT FOUND).
- collection: Kaleidoscope — Tangerine Dream (Insufficient resolution or non-cover geometry).
- collection: The Shangri-Las — Collection 20 Greatest Hits (No unambiguous album/year match).
- collection: Егор Летов — Русское Поле Эксперимента. Акустика (No unambiguous album/year match).
- wishlist: The Velvet Underground — Live With Lou Reed (No suitable high-resolution front in checked official vinyl releases).
- wishlist: The Kinks — The Best Of The Kinks (No unambiguous album/year match).
- wishlist: Гражданская Оборона — Live In San Francisco (No unambiguous album/year match).
- wishlist: The Velvet Underground — Andy Warhol's Velvet Undeground Featuring Nico (Insufficient resolution or non-cover geometry).
- wishlist: Гражданская Оборона — Попс (Insufficient resolution or non-cover geometry).
- wishlist: Jackson C. Frank — My Name Is Carnival (No unambiguous album/year match).
