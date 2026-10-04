# Stage 4B — local implementation and production gates

Status: local implementation and owner acceptance complete; production phase authorized. The local phase preserved Stage 3 production. The subsequent approved 04.10.2026 rollout is recorded in the production report. Git finalization and gated production deployment are authorized. 4C–4F and Stage 5 are not implemented.

## Decisions and boundaries

After separately approved cutover PostgreSQL is the only Collection/Wishlist source of truth. Existing owner Sheets become a one-way PG→Sheets mirror; no Sheets→PG reads for runtime decisions and no dual-write transaction. Bug Reports remains an independent Sheets adapter. Stage 3 layout/flows are unchanged; one technical maintenance error message is added for WRITES_FROZEN. Public user URLs/SSR/SEO, registration and account deletion remain future stages.

Approved production owner input: login `Obrattsev`, normalized/stored login `obrattsev`, email `obratsev@yandex.ru`, full name null, both lists public. Existing 001 schema stores canonical lowercase login; future URL `/u/obrattsev` is compatible. Production UUID must be generated once and recorded in the approved owner manifest; the created production UUID is recorded in the production report. Local fixture uses a deterministic UUID and an example.test email, never production records.

Audit: Ubuntu 24.04.4, 1 vCPU, 1967 MiB RAM/1658 available, 23 GiB disk free, no swap; PG16 package available. 29 Collection, 12 Wishlist, 5 Favorites; 36 referenced covers, 37 directories, 74 files, empty holds, no missing references. Orphan candidate `b6098f29-d064-4632-8c25-b228345abe26` is retained and included in backups. Recheck under final freeze. 1 GiB swap is approved only for the separate production phase. Timeweb daily disk backup is the accepted infrastructure/offsite layer.

## Schema, identity and media

001 is unchanged. Additive 002 creates `runtime_control` (persistent freeze flag and business write counter) and `mirror_state` (owner FK, generation/synced_generation, dirty_since, attempt/success/next timestamps, sanitized error, failure count, verification JSON). Both runtime writes and mirror generation are committed in one transaction. Counter also rolls back with business data; import itself is not a post-cutover business mutation.

Existing successful owner authentication is temporarily mapped to configured PG_OWNER_ID on the server. Client IDs/headers do not select the owner. Repositories retain mandatory scope and composite Cover FK. Guest list reads check visibility; authenticated bridge reads expose only its configured owner's private projection. This is not registration or multi-user session auth.

GET and HEAD media resolve DB ownership/reference before filesystem access. Only configured owner media is exposed by current bridge routes. Owner may read referenced own covers; guest needs at least one reference in a public list. Foreign/private guest/orphan media returns 404. Shared same-owner references are allowed. DB failure returns a generic server error without filesystem fallback. `private, no-store` avoids stale visibility caches. Current nginx proxies media to Node; do not add filesystem alias or proxy cache. Existing binary paths remain unchanged.

## Configuration

Sheets remains default. PG is explicit `DATA_BACKEND=postgres`. Development/test keep the strict loopback fixture database allowlist. Production additionally requires `NODE_ENV=production`, `PG_PRODUCTION_ACK=stage4b`, database name `vinyl_production`, nonempty password and PG_OWNER_ID. Only 127.0.0.1 with explicit port is allowed; no query connection overrides. Startup refuses missing owner, privileged runtime role, schema/database CREATE privilege and mirror state/config mismatch. No automatic fallback. Pool: app 3, worker 1; bounded connection/query/lock/idle-transaction timeouts.

`MIRROR_ENABLED=true`, `MIRROR_OWNER_ID` equal bridge owner, and MIRROR_COLLECTION/WISHLIST_SPREADSHEET_ID plus SHEET_NAME select existing distinct documents server-side. They cannot equal Bug Reports document. Credentials remain outside Git. Fake file adapter is prohibited in production and cannot be combined with real mirror targets. Explicit `pg-mirror enable` provisions state; startup does not create/repair it.

## Mirror protocol

Worker holds one session advisory lock across consistent PG snapshot, Google reconciliation and verification. Snapshot uses REPEATABLE READ; transaction ends before Google calls. Both lists and G come from one snapshot. Compare-before-write recovers an unknown write outcome. Typed cell values preserve text/formula safety and numeric/boolean types. One batch per document updates canonical fields and clears stale rows without clearing formatting. Unexpected/reordered/extra headers fail closed: repair/approve schema explicitly, rather than destroying unknown columns. Canonical cell drift is overwritten from PG.

Read-back of both documents is mandatory before synced_generation=G. A simultaneous G+1 stays pending. Failure in either document retains dirty state and stores only fixed error codes; CRUD success is unaffected. Retry starts at 5 seconds with jitter and is bounded to about an hour. New clean-state mutations wake the worker; failed states respect backoff. Clean state is reconciled hourly to detect manual drift; force CLI needs no wait.

Separate process: `node scripts/pg-mirror.mjs worker`; operations: `enable`, `status`, `reconcile`. Worker polls every five seconds, stops on signals and uses no additional queue infrastructure. Status includes lag seconds, generation, last success/error and verification hashes/counts. Exit of manual reconciliation is nonzero unless verified. Zabbix can parse status via a dedicated configured service command; alert on failed status or pending lag >300 seconds. Also check worker liveness and overdue periodic verification. A stale status is not proof of present external Sheet contents.

Google is not a transaction participant. An in-flight remote request can have an uncertain result on network failure/crash; a restarted worker reconciles state rather than replaying Add/Edit/Delete. There is no cross-document atomicity or exactly-once external delivery. Stop worker during cutover/rollback. If DB connectivity/lock is lost during a remote request, reconciliation must be repeated; periodic comparison repairs external drift. No claim of instantaneous external consistency.

## Freeze and revisions

`pg-freeze on` obtains the exclusive advisory barrier, waits for all application write transactions and commits frozen=true. New mutations take shared barrier then reject with 503 WRITES_FROZEN and a Russian maintenance explanation; guest reads/auth/Streaming/Bug Reports continue. Status reports frozen and business_writes; a successful `on` reports drained. Lock timeout fails the command rather than claiming drain; retry only after resolving the active operation. `off` is an explicit operator action. No maintenance UI redesign.

The pre-cutover Stage 3 release lacks this barrier: stop only the application after owner ceases writes for final snapshot/import. PG freeze does not stop legacy Sheets writes or direct administrator SQL. Coordinate manual Sheet edits and admin operations too.

Importer preserves existing mappings/null/zero/false, UUID identities and owner-bound covers; dry-run and transactional repeat protection remain. `pg-verify source-raw.json` checks canonical lists, source/loaded digest and stored revision for every row. A nonzero canonicalizedIds report requires explicit review of revision continuity before migration; current production audit had zero. Full HTTP tests retain If-Match behavior. Unknown HTTP commit outcomes still require reading/reconciling before retry; no durable request receipts added.

## Backup and rollback tooling

`sheets-snapshot.mjs owner-manifest.json NEW_DIRECTORY` reads with Google read-only scope using existing COLLECTION/WISHLIST source config. It exports raw/canonical snapshots, checksums and cover inventory (including complete orphan candidates). It does not archive binaries itself: the runbook archives the full Covers directory separately before import. Never run against moving source during final migration.

`pg-backup.mjs NEW_DIRECTORY` requires freeze/drain; holds mirror lock and freeze barrier while writing canonical owner data, optional Sheet snapshots, full custom PG dump, Covers tar, file checksums and manifest. Destination must be new, separate from Covers. Symlinks/special cover files are rejected. Directory 0700/files 0600. Archive listing and pg_restore --list are checked, but success still requires restore rehearsal. No offsite transport or cleanup is inferred.

`pg-restore-rehearsal.mjs BACKUP NEW_COVERS_DIRECTORY` allows only a token-marked, empty local test database. It checks artifact hashes, rejects archive links/unsafe paths, restores via pg_restore --single-transaction --no-owner --no-privileges, compares owner canonical data and every cover file checksum. Use only trusted tool-generated backups; checksums are integrity checks, not signatures for arbitrary untrusted SQL archives. The full dump contains users, schema/history/mirror state; role provisioning/config/secrets are backed up separately by operator. Restore evidence is not a claim of production RTO until timed there.

`pg-daily-backup.mjs` is the daily timer entrypoint: explicit PG_BACKUP_ROOT, dedicated backup role, overlap lock, refusal of existing manual freeze, drain/backup/checksums/thaw, retention 7 daily + 4 weekly and protected status.json. Crash leaves persistent freeze fail-closed; alert and explicitly inspect before unfreezing. Do not overlap with manual cutover operations. Monthly and schema-change restore rehearsals remain operational requirements. Timeweb is the infrastructure backup layer; no separate transport is required.

`pg-verify rollback` is a read-only owner data gate requiring freeze and exact Sheets comparison. It does not change backend. Stop worker before running; preserve evidence and backups. Before first PG business write, verify original Sheets before reverting code/config. After any PG write, freeze→backup→PG→Sheets reconciliation→read-back gate→only then separately switch backend. If PG inaccessible or completeness unproved, remain in maintenance and restore PG. This is owner record rollback, not restoration of all DB system/auth state.

## Local acceptance

Current stand: http://127.0.0.1:8045/collection and /wishlist. Password `local-pg-only-password-4B`. Fixture root `/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4b-acceptance-VWQ4ks`; sample.png, source-manifest.json, covers/, mirror.json and private restart.env are outside Git. Streaming uses read-only Apple lookup; initial stand reports are memory-only. Normal restart via server/index.mjs leaves reports unconfigured unless separately set; do not load production .env.

From repository root, set these shell variables (no secret values printed):

```sh
node4b=/Users/obrattsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
env4b=/Users/obrattsev/vinyl-collection-config/stage4a-local/vinyl-4b-acceptance-VWQ4ks/restart.env
"$node4b" --env-file="$env4b" scripts/pg-mirror.mjs status
"$node4b" --env-file="$env4b" scripts/pg-mirror.mjs reconcile
"$node4b" --env-file="$env4b" scripts/pg-mirror-fixture.mjs show
```

Check guest pages/search/sort/Covers/Streaming/mobile; owner login/Add optional Cover/Edit/Delete/Favorite/Replace/Delete Cover/Transfer/CSV/reload. After a mutation status should be pending, reconcile→verified/synced, fake file matches PG. Test `pg-mirror-fixture outage`, mutate successfully, reconcile→failed, `recover`, reconcile→verified. Test `drift` then reconcile restores PG state. Automatic worker is optional: start `pg-mirror worker` in a separate terminal, stop it before fixture controls/manual freeze or backup. `pg-freeze on` blocks owner mutation; reads continue; `off` restores writes. Restart app using `"$node4b" --env-file="$env4b" server/index.mjs` only after stopping current stand. No reseeding existing DB.

Security tests prove denied private/foreign/orphan GET/HEAD using a second fixture user without adding new UI. Test suite requires isolated test.env; never use acceptance.env for destructive failure-injection tests. Accepted 001 migration remains byte-identical to main.

## Local validation evidence

Final full regression + PG integration: **436 passed, 0 failed, 0 skipped** (416 baseline + 20 new tests). `npm audit`: **0 vulnerabilities**, no new dependencies. `git diff --check` and changed-module syntax checks passed. Schema 001/auth/domain models remain unchanged; frontend diff is only the maintenance message. Normal server/index.mjs startup with the local bridge/fake config was checked on 8046 and stopped after HTTP parity smoke; the acceptance process remains on 8045.

Executed locally: importer DTO/stored-revision verification; fake mirror reconciliation; freeze/drain; custom-format PG dump + pg_restore --list; actual restore into a newly marked empty test DB plus separate cover directory; restored record hashes and all cover hashes matched; rollback gate returned verified under freeze. Stand was explicitly unfrozen afterward. Backup evidence is `/Users/obrattsev/vinyl-collection-config/stage4a-local/backup-4b-rehearsal`; test/audit logs are `final-4b-tests.log` / `final-4b-audit.json` in the local root, outside Git.

Self/security/data-integrity review checked SQL parameters, owner scope, public/private media, generation rollback, Google failure isolation, advisory lock lifetime, clean-state hourly drift checks, import repeat protection, freeze/unfreeze races, archive path/link checks and actual least-privilege runtime grants. Review fixes include immediate dirty wakeup, sanitized errors, rollback verification locking, stopped remote work after DB connection loss, separate Bug Reports target validation and UPDATE(updated_at) permission required for User row locking. A temporary test role is created and rolled back inside one isolated DB transaction; the local review did not provision production roles.

Production installation, roles/swap, source backup/import, restore rehearsal, media and owner smoke are complete; see the production report. No exactly-once claim across Google, no full account cleanup, no new auth/SSR/SEO. Local runtime credentials, fixtures, images and dumps remain outside Git.

## Production authorization — 04.10.2026

Local acceptance 4B успешно принята владельцем. Git finalization и production phase разрешены с последовательными verification gates; cutover выполнен 04.10.2026; verification и cleanup пройдены, freeze снят. Backup decision: Timeweb daily VPS disk backup + проверенные logical PG/Covers backups на VPS (7 daily + 4 weekly) + one-way owner Sheets mirror. S3/SFTP и новые providers/dependencies не добавлять. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён. Более ранние требования отдельного offsite provider и ожидания local acceptance выше заменены этим решением. Freeze только непосредственно перед cutover, снять после verification.

Фактический release, verification, backup/monitoring и ограничения: [production report 4B](stage-4b-production.md).
