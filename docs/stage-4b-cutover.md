# Stage 4B production runbook

Local acceptance and production phase were approved; execution completed 04.10.2026 (see production report). This remains a gated reference, not a script to rerun against the migrated database. Timeweb daily disk backup is the accepted infrastructure/offsite layer; no new provider is required. Disposable production smoke records are approved. Do not execute this document as one shell script. Stop on any failed check. See [local architecture](stage-4b-local.md).

## Gate 0: evidence and preparation

Record approved merged release SHA, current RELEASE/current symlink, service PIDs, disk/RAM, source counts/hashes and owner UUID. Reconfirm owner login/email/public flags. Do not infer UUID or email. Confirm no active owner operation and no manual Sheet edits. Retain orphan candidate. Record the owner-confirmed Timeweb daily backup; provider timestamp is unverified. Owner password/hash remains unchanged, outside Git.

Use Node `/opt/vinyl-collection-ai/runtime/node-v24.19.0-linux-x64/bin/node`; PG binaries `/usr/lib/postgresql/16/bin`. New code is installed as a separate immutable release using existing deployment procedure; current is not switched yet. Environment files root-owned 0600; service-account JSON remains root:vinyl 0640. Never print or commit them. Migration/backup/worker configs must have their own least-privilege connection roles. No real credentials in command arguments.

## Gate 1: install/configure (only after explicit production authorization)

```sh
apt-get update
apt-get install postgresql-16 postgresql-client-16
sudo -u postgres psql -v ON_ERROR_STOP=1
```

In psql, configure and provision once; stop if names already exist and inspect rather than resetting:

```sql
ALTER SYSTEM SET listen_addresses='127.0.0.1';
ALTER SYSTEM SET shared_buffers='128MB';
ALTER SYSTEM SET work_mem='4MB';
ALTER SYSTEM SET maintenance_work_mem='64MB';
ALTER SYSTEM SET max_connections='20';
ALTER SYSTEM SET password_encryption='scram-sha-256';
CREATE ROLE vinyl_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE vinyl_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE vinyl_mirror LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE vinyl_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password vinyl_migrator
\password vinyl_app
\password vinyl_mirror
\password vinyl_backup
CREATE DATABASE vinyl_production OWNER vinyl_migrator;
REVOKE ALL ON DATABASE vinyl_production FROM PUBLIC;
GRANT CONNECT ON DATABASE vinyl_production TO vinyl_app,vinyl_mirror,vinyl_backup;
```

Verify pg_hba.conf permits only intended local administration and loopback SCRAM roles/database; no trust host entries or public listen. Restart only newly installed PG cluster to apply startup settings, then check `ss -lnt`, `SHOW listen_addresses`, role flags and loopback connections. Do not open firewall or change nginx/WireGuard/SSH.

Separate optional approved swap step: first verify no existing swap/file. Only when absent:

```sh
test ! -e /swapfile-vinyl
dd if=/dev/zero of=/swapfile-vinyl bs=1M count=1024 status=progress
chmod 600 /swapfile-vinyl
mkswap /swapfile-vinyl
swapon /swapfile-vinyl
```

Add exactly one `/swapfile-vinyl none swap sw 0 0` fstab entry after review; verify `findmnt --verify`, `swapon --show`, file size/mode and persistence configuration. No reboot for this phase. Never overwrite an existing swapfile or duplicate fstab entries.

## Gate 2: schema, permissions and rehearsal

Create private `/etc/vinyl-collection-ai/pg-migration.env` with explicit production PG config/ack, migrator URL, approved owner UUID and Covers path; no runtime use of migrator. Run from prepared new release:

```sh
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-migrate.mjs
```

Connect as migrator to vinyl_production. Revoke PUBLIC schema rights and grant only needed access:

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA vinyl FROM PUBLIC;
GRANT USAGE ON SCHEMA vinyl TO vinyl_app,vinyl_mirror,vinyl_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA vinyl TO vinyl_app,vinyl_mirror,vinyl_backup;
GRANT INSERT,UPDATE,DELETE ON vinyl.collection_records,vinyl.wishlist_records TO vinyl_app;
GRANT INSERT ON vinyl.covers TO vinyl_app;
-- PostgreSQL row locking requires UPDATE privilege on at least one users column.
-- App only locks this row; it has no identity/visibility write privileges.
GRANT UPDATE(updated_at) ON vinyl.users TO vinyl_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA vinyl TO vinyl_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA vinyl TO vinyl_backup;
GRANT UPDATE(frozen,changed_at) ON vinyl.runtime_control TO vinyl_backup;
GRANT UPDATE(business_writes) ON vinyl.runtime_control TO vinyl_app;
GRANT UPDATE(generation,dirty_since,next_attempt_at) ON vinyl.mirror_state TO vinyl_app;
GRANT UPDATE(synced_generation,dirty_since,last_success_at,last_attempt_at,next_attempt_at,last_error,failures,verification) ON vinyl.mirror_state TO vinyl_mirror;
```

Future migrations explicitly review grants; runtime has no DDL or role ownership. Manual freeze/admin/enable commands use migrator operator config, not app URL. The daily backup role has only the two runtime-control column updates required to freeze/drain and thaw; no business-table writes.

Before importing production, create and verify initial empty-schema dump, archive immutable release metadata and privately preserve env/service config/secrets. Rehearse a snapshot in separate local marked test DB, never in production import namespace. Restore fixture rehearsal command:

```sh
node --env-file=/absolute/private/new-test.env scripts/pg-restore-rehearsal.mjs /absolute/backup /absolute/new-restored-covers
```

The helper intentionally does not restore into production. Actual disaster restore remains a separately reviewed operator operation, with roles/config restored too.

## Gate 3: final freeze and source backup

Current Stage 3 has no PG barrier. Owner stops writes and confirms no unfinished operation. Stop only `vinyl-collection-ai`; this creates a short visible maintenance window. Do not restart unrelated services. Reconfirm no manual Google edits. Any unexpected source change during freeze is a STOP condition; investigate before proceeding.

From prepared release using existing source configuration and explicit private owner-manifest JSON (`importKey`, `user` with approved UUID/login/email/flags):

```sh
node --env-file=/etc/vinyl-collection-ai/app.env scripts/sheets-snapshot.mjs /absolute/private/owner-manifest.json /absolute/new-source-snapshot
tar -cf /absolute/new-source-backup/covers.tar -C /var/lib/vinyl-collection-ai/covers .
tar -tf /absolute/new-source-backup/covers.tar
sha256sum /absolute/new-source-backup/covers.tar
```

Create backup destination privately beforehand, preserve full Covers including .holds/orphan. Verify extraction into separate directory and compare all cover hashes from snapshot. Package source snapshots, release SHA, rollback metadata and protected config backup. Verify actual file sizes, archive extraction and checksums. Timeweb daily VPS backup is owner-confirmed; deployment tools cannot verify its latest timestamp. No separate offsite upload is required.

## Gate 4: final import and compare

```sh
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-import.mjs /absolute/new-source-snapshot/source-raw.json --dry-run
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-import.mjs /absolute/new-source-snapshot/source-raw.json --apply
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-verify.mjs /absolute/new-source-snapshot/source-raw.json
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-freeze.mjs on
```

Require verified=true, exact UUID/count/field/revision equality, five audited favorites (or approved final count), complete cover inventory and no unexplained anomalies. Same import key/hash is no-op; changed source needs explicit investigation, not blind rerun/upsert. Register mirror state with `pg-mirror enable` using configured migrator mirror env; worker stays stopped. Take post-import backup and verify actual restore rehearsal. Record business_writes baseline=0.

## Gate 5: switch, smoke and mirror

Set explicit PG runtime config in protected app env; remove legacy Collection/Wishlist runtime selection as source (retain source config separately for rollback). Preserve existing auth env, Bug Reports and Covers path. Mirror worker env uses separate mirror role and server-side targets, never app request input. Switch current symlink to approved release and start only app with freeze still on. Owner sessions reset.

Read smoke: pages/API, guest/private projection, unauthorized media GET/HEAD, public Covers, owner login, CSV and Streaming. Run `pg-mirror reconcile` under mirror env, verify both documents and `status`. Writes remain blocked until operator `pg-freeze off` under migrator config.

After separately agreed write smoke: Add/Edit/Delete, optional Cover/replace/unlink, Favorite, Transfer, reload and app restart persistence; verify mirror and Bug Reports separately. Use approved disposable records only; remove via normal UI afterward and verify mirror again. Never delete pre-existing records for testing. Failure → freeze and choose rollback gate below.

## Worker, backups and monitoring

Prepare a separate systemd worker: User/Group vinyl; WorkingDirectory current release; protected mirror EnvironmentFile; ExecStart pinned Node + scripts/pg-mirror.mjs worker; Restart=on-failure; RestartSec=10; NoNewPrivileges=true; ProtectSystem=strict; no Covers write permission. Worker grants listed above. Enable only after initial reconciliation. Existing app ReadWritePaths stays Covers only.

Daily backup timer uses a distinct one-shot operator-controlled backup unit and a unique timestamped new destination, 0700. Stop worker first or retry if its lock is busy; never overlap manual cutover/freeze. Run scripts/pg-daily-backup.mjs with the dedicated backup role, PG_BACKUP_ROOT and PG_BIN. It refuses an existing manual freeze, drains mutations, verifies checksums, thaws, then retains 7 daily + 4 weekly artifacts. status.json and the systemd result expose failures. Timeweb daily disk backup is the separate infrastructure layer; no provider dependency is installed. Perform monthly and schema-change restore rehearsal.

Zabbix: service status/connectivity; disk/RAM/swap/DB size; app/worker errors; age of local/offsite/restore verification; mirror generation lag/error/last_success. A root-controlled checker may read private config and emit only sanitized JSON; do not give Zabbix secret file read access. Avoid frequent Google calls from monitoring: inspect PG status; hourly reconciliation detects external drift. Suggested alerts: mirror lag >300s, backup older than 26h, low disk <20%, sustained memory/swap pressure. Tune after real measurements.

## Rollback gates

Before first new PG business write: keep freeze, stop worker; compare current Sheets to final source snapshot, preserve PG backup, return old release/env and start only app. No automatic rollback command.

After any PG business write:

```sh
node --env-file=/etc/vinyl-collection-ai/pg-migration.env scripts/pg-freeze.mjs on
# stop mirror worker; preserve current PG+Covers verified backup
node --env-file=/etc/vinyl-collection-ai/mirror.env scripts/pg-mirror.mjs reconcile
node --env-file=/etc/vinyl-collection-ai/mirror.env scripts/pg-verify.mjs rollback
```

Require verified=true under stable freeze. Only then operator may restore Stage 3 code/env and restart app. PG and files retained; no DB downgrade/drop. If PG unreadable, mirror state alone is insufficient evidence: maintenance→restore PG→reconcile/verify. Never return to an unverified stale Sheet. Sheets cannot restore DB system/auth state.

## Production authorization — 04.10.2026

Local acceptance 4B успешно принята владельцем. Git finalization и production phase разрешены с последовательными verification gates; cutover выполнен 04.10.2026; verification и cleanup пройдены, freeze снят. Backup decision: Timeweb daily VPS disk backup + проверенные logical PG/Covers backups на VPS (7 daily + 4 weekly) + one-way owner Sheets mirror. S3/SFTP и новые providers/dependencies не добавлять. Timeweb daily VPS backup подтверждён владельцем; timestamp последнего provider backup средствами deployment environment не подтверждён. Более ранние требования отдельного offsite provider и ожидания local acceptance выше заменены этим решением. Freeze только непосредственно перед cutover, снять после verification.

Фактический release, verification, backup/monitoring и ограничения: [production report 4B](stage-4b-production.md).
