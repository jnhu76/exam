# Backup and Recovery Guide

> **Authority:** canonical operator guide for portable persistence, cold
> filesystem backup, and disaster recovery of a single-node Exam deployment.
> Companion to [`mvp-deployment-runbook.md`](./mvp-deployment-runbook.md).
>
> Scope: LAN/on-premise, single-tenant. Do NOT use this guide for any
> multi-tenant, cloud, or Phase 4 deployment — those modes are not
> implemented.

---

## One-Compose model (read first)

There is **exactly ONE production/operator Docker Compose entry point**:

```text
docker-compose.yml
```

Normal operations are always:

```bash
docker compose up -d
docker compose down
```

There is **no** alternative production startup command involving another
Compose file. Optional PostgreSQL capabilities such as PITR are **database
configuration**, not an alternate Docker topology:

```text
Docker/container topology  !=  PostgreSQL backup policy
PITR                        =  optional PostgreSQL cluster capability
PITR                        != alternate Exam deployment topology
```

Development/test Compose files (`docker-compose.dev.yml`,
`docker-compose.test.yml`) are development infrastructure and may remain;
they are NOT operator entry points.

---

## 0. Read this first — what is authoritative

```text
PostgreSQL                  = authoritative durable Exam state
                              (attempts, answers, grading, results, audit, …)
Redis                       = non-authoritative (rate-limit counters only;
                              TTL-bounded; may be lost without consequence)
application filesystem      = no durable application writes
```

The PostgreSQL data directory is the **only** bytes you must preserve to
keep the same Exam system. Everything else — Redis, container writable
layers, `/app/data`, logs, browser storage — is disposable.

> **Host persistence is not backup.** The live `./data/postgres` directory
> keeps the system running, but a copy on the same failing disk is a weak
> local copy, **not** disaster recovery. A real backup lives on an
> **independent failure domain** (NAS, another server, a separate disk).

---

## 0.5 Evidence ledger (P7-E2B) — what the product knows about backups

The backup scripts record **durable evidence** of every run into the
PostgreSQL evidence ledger (`backup_runs`, `backup_run_events`,
`restore_drill_runs`) via the typed operator command
`backup-evidence.js` (runs in the app container). The product reads this
ledger to answer "last backup", "last **verified** backup", "last failure",
and restore-readiness — the Admin/Maintainer Operations views.

```text
backup SUCCESS  =  artifact produced
                AND artifact readable
                AND required verification passed
                AND durable evidence committed
```

Consequences:

- `pg_dump` exiting 0 is **not** success; `file exists` is **not** success.
  A run only becomes `succeeded` when its completion evidence carries the
  verification result (`pg_restore --list` for logical, `pg_verifybackup`
  for physical, `pg_version_presence` for cold copies).
- A crash before verified evidence leaves the run `running`; the next start
  of the same logical run closes it as `abandoned`. No crash ever claims
  success.
- The same logical run (same `EVIDENCE_OPERATION_ID`) cannot produce two
  contradictory successes: at most one `succeeded` row per operation id; a
  conflicting re-completion is recorded `failed`
  (`duplicate_operation_conflict`) and the original success stays
  authoritative. The default operation id is the **hour slot**
  (`<type>:<YYYY-MM-DD>T<HH>`), so schedules finer than daily (e.g. hourly
  backups for a desired RPO < 24h) never collide. **Mandatory contract:**
  a schedule with a cadence finer than one hour MUST pass an explicit
  per-slot `EVIDENCE_OPERATION_ID` (include the minutes), and retries of the
  same logical run MUST reuse the same id.
- The ledger stores the artifact **label** (file name) only — never host
  paths, never credentials, never the destination URI. The host layout
  remains Host Maintainer territory.
- Cold-filesystem backups run while PostgreSQL is stopped; the script writes
  a typed evidence spool (`evidence.json`) next to the artifact and the
  operator imports it after restart (`backup-evidence.js cold-import
  --spool <path>`). The spool is a transit file, not a second authority.
  The import records the spool's REAL start/completion timestamps as the
  run's times — an old backup imported today is NOT re-stamped as freshly
  verified (the RPO projection measures from the backup's actual
  completion, never from the import moment).
- Restore drills are recorded via `backup-evidence.js drill` with
  `--source automated` (deterministic deployment drill) or
  `--source operator_declared` (operator-recorded). A declared success is
  never rendered as automated proof.
- The ledger is read-only through the product (`system.backup.view`,
  `system.restore_readiness.view`). Backup trigger / schedule / retention
  remain **host-owned** (host cron) and decision-gated (ADR-017 D5); there
  is no product-side backup button.



The production Compose topology (`docker-compose.yml`) uses operator-visible
host bind mounts under `${EXAM_DATA_ROOT:-./data}`:

```text
exam/
├── docker-compose.yml
├── .env
└── data/
    ├── postgres/      ← authoritative: the PostgreSQL data directory (PGDATA)
    ├── redis/         ← non-authoritative: rate-limit AOF/RDB (may be lost)
    └── wal-archive/   ← PITR archive (only meaningful when PITR is enabled)
```

- `data/postgres/` is **required**. Deleting it destroys authoritative Exam
  state. The official PostgreSQL image owns its internal layout
  (`data/postgres/18/docker/...`); the operator only needs the
  `data/postgres` parent.
- `data/redis/` is **optional for correctness**. It holds rate-limit state;
  losing it resets operational history but never affects Exam authority.
- `data/wal-archive/` is the default WAL archive path. The mount is ALWAYS
  present on the db service but is **inert by default** (`archive_mode = off`).
  It only matters once PITR is enabled
  (`scripts/backup/postgres-enable-pitr.sh`). A normal operator never needs
  to understand WAL/PITR just to run Exam.

Set `EXAM_DATA_ROOT` to relocate the whole data root (e.g. to a mounted
NAS volume). The default is `./data` relative to the Compose file. Set
`EXAM_WAL_ARCHIVE_HOST_PATH` to point the WAL archive at an **independent
failure domain** for real disaster recovery (the local default is for
development/drills only and is NOT host-loss protection).

---

## 2. What deleting things means

| What you delete | Result |
| --- | --- |
| `docker compose down` | Containers + network removed; **`data/` retained**. |
| `docker compose down -v` | With bind mounts this is a no-op for `data/` (it only removes named volumes; there are none). `data/` is retained. |
| `rm -rf data/postgres` | **Authoritative state destroyed.** Nothing left to restore from unless you have a backup. |
| `rm -rf data/redis` | Rate-limit counters reset; no Exam truth change. |
| Delete the `app`/`email-worker` containers | No state in them; recreate with `docker compose up -d`. |
| Delete the `db` container | `data/postgres` is retained; recreate with `docker compose up -d`. |

---

## 3. Stop and start

```bash
# Stop (graceful — SIGTERM propagates, drains audit writes, closes DB pool):
docker compose down

# Start again (same data root, fresh containers):
docker compose up -d

# Confirm authoritative state survived:
docker compose exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM organizations;"'
```

---

## 4. Decision tree (C1 + C2 + C3)

```text
I am moving the server to a new host
    → §5  stopped-directory relocation (C1)

I want the simplest full backup
    → §6  cold-filesystem backup (C1)

I want routine backups without shutting Exam down (online)
    → §7  pg_dump logical backup (C2)

I need exact PostgreSQL physical backup / faster full-cluster recovery
    → §8  pg_basebackup physical backup (C3)

I deleted something at 14:32 and need 14:31
    → §8  WAL archive + PITR (C3)
```

Quick comparison:

| Path | Online? | Scope | Replaces history? | Best for |
| --- | --- | --- | --- | --- |
| §5 stopped relocation (C1) | **No** (stop server) | Whole data dir | **No** — same authoritative history | Moving the deployment to new hardware |
| §6 cold-filesystem backup (C1) | **No** (stop server) | Whole data dir | Yes (restore replaces history) | Simplest full snapshot when Exam can stop |
| §7 pg_dump logical (C2) | **Yes** | One database (`exam`) | Yes (clean restore into a fresh DB) | Routine online backups; cross-PG-major portability |
| §8 pg_basebackup physical (C3) | **Yes** | Whole cluster | Yes (physical cluster restore) | Full-cluster recovery; consistent snapshot at scale |
| §8 WAL archive + PITR (C3) | **Yes** | WAL replay to target | Yes (replay to target then promote) | Recover a specific past point; undo a destructive change |

Restore replaces the authoritative history in all backup/restore paths EXCEPT
stopped relocation (§5), which carries the SAME history forward to a new
host. See §9 for the boundary.

---

## 5. Cold directory relocation (C1)

Move the entire Exam deployment to a new host by copying the stopped data
directory. This preserves the **same authoritative history** (same Exam
system, new machine) — it is NOT a historical restore and NOT PITR.

```text
deployment A (host A)
    → docker compose down                (PostgreSQL stopped cleanly)
    → copy the COMPLETE data/ directory  (rsync -aHAX / tar while stopped)
    → deployment B (host B): place the copy at $EXAM_DATA_ROOT
    → docker compose up -d               (same PostgreSQL major, same creds)
    → same Exam state
```

The PGDATA files are owned by the container's postgres user and are not
readable by the host user, so copy as root (or via a helper container):

```bash
# Stop Exam on host A first.
docker compose down

# Copy the COMPLETE data root to host B. On host A (as root, or via a
# throwaway container that preserves ownership/mode/symlinks):
rsync -aHAX /path/on/hostA/data/ /path/on/hostB/data/
# Equivalent: tar -C /path/on/hostA -cf - data | tar -C /path/on/hostB -xf -

# On host B, point EXAM_DATA_ROOT at the copied directory and start with
# the SAME PostgreSQL major version and the SAME DB credentials the
# volume was initialized with:
export EXAM_DATA_ROOT=/path/on/hostB/data
export POSTGRES_PASSWORD=<same-as-host-A>
docker compose up -d
```

> **Raw PostgreSQL directory copying is supported only as a complete
> stopped-server filesystem copy in the compatible PostgreSQL environment.**
> The PGDATA is tied to the PostgreSQL major version (currently 18). A
> `pg_dump` restore (C2) is portable across majors; a raw-PGDATA copy is
> not. Do not live-copy PostgreSQL's active data directory with ordinary
> `cp`/`tar`; do not partial-copy PostgreSQL relation files.

---

## 6. Cold-filesystem backup and restore (C1)

Treats a stopped copy of the complete PostgreSQL persistent directory as a
same-version/same-major cold physical backup. Simplest full backup option;
requires downtime while PostgreSQL is stopped.

### 6.1 Backup

```bash
# 1. Stop Exam cleanly (PostgreSQL must be STOPPED — a live copy is corrupt-prone):
docker compose down

# 2. Run the backup helper (copies the COMPLETE postgres tree to a fresh
#    destination with ownership/mode/symlinks preserved). The source is the
#    deployment's EXAM_DATA_ROOT (the production Compose default is ./data):
scripts/backup/cold-filesystem-backup.sh \
  "${EXAM_DATA_ROOT:-./data}" \
  /mnt/nas/exam-backups/2026-08-10

# 3. Restart Exam:
docker compose up -d
```

Store the destination on an **independent failure domain** (NAS / another
server / a separate disk). A copy on the same disk as the live data is a
weak local copy, not disaster recovery.

### 6.2 Restore

```bash
# Restore into a FRESH data root (the script refuses to overwrite a populated
# one). Start Exam afterwards with the same PostgreSQL major and the same DB
# credentials the backup was taken with.
mkdir -p /opt/exam/data-fresh
scripts/backup/cold-filesystem-restore.sh /mnt/nas/exam-backups/2026-08-10 /opt/exam/data-fresh

export EXAM_DATA_ROOT=/opt/exam/data-fresh
export POSTGRES_PASSWORD=<same-as-when-backup-was-taken>
docker compose up -d

# Run your Exam business-invariant checks after start.
```

This is filesystem-level cold restore. It is **not** `pg_restore`, **not**
PITR, and **not** a cross-major PostgreSQL upgrade. The restored PGDATA is
tied to the PostgreSQL major version of the backup. The official postgres
image fixes ownership/permissions of the PGDATA on container start; no host
`chmod` is required.

### 6.3 Permissions

The PGDATA files are owned by the container's postgres user with the
ownership/mode the official PostgreSQL image produces. The operator
contract is: **preserve** that ownership/mode — do not `chmod` PGDATA
broadly. Relocation tools (`rsync -aHAX`, `tar`, or the helper-container
`cp -a` used by the scripts) preserve owner/group/mode. Do **not** run
broad host `chmod 777` on the data directory. The official postgres image
chowns the PGDATA on container start, so a fresh empty bind mount is also
initialized correctly.

---

## 7. Logical online backup and clean restore (C2)

Takes an internally consistent PostgreSQL backup while Exam is running, using
`pg_dump` custom format (`-Fc`), and restores it into a CLEAN target
database. This is the routine backup users are most likely to want:
PostgreSQL stays online and the dump is internally consistent. Prefer this
path for routine backups unless cold-copy simplicity is preferred.

### 7.1 Backup (online)

```bash
# PostgreSQL stays ONLINE. The API may be down; only PostgreSQL must be up.
# <COMPOSE_PROJECT> is the Compose project name (for the default production
# stack started from the repo root it's the directory name, usually "exam").
scripts/backup/postgres-logical-backup.sh exam /mnt/nas/exam-logical/$(date +%Y%m%d).dump
```

The helper: connects via the `db` container; produces a timestamped
custom-format dump (`-Fc`, `--no-owner`); fails non-zero on error; never
puts the DB password on the argv (uses `PGPASSWORD` env); refuses to claim
success for an empty/partial artifact (non-empty + `PGDMP` magic +
`pg_restore --list` OK). Store the artifact on an **independent failure
domain**.

### 7.2 Clean restore (exact historical replacement)

```bash
# 1. Stop the API + worker (avoid writes during restore):
docker compose stop app email-worker

# 2. Restore into a CLEAN target (DROP + recreate from template0, then
#    pg_restore). No target-only schema/data from the previous database
#    survives (clean logical reconstruction of the dumped state — NOT a
#    merge). The script requires you to type the target DB name to confirm.
scripts/backup/postgres-logical-restore.sh exam /mnt/nas/exam-logical/<date>.dump exam

# 3. Restart the API + worker to use the restored database:
docker compose up -d app email-worker

# 4. Run your Exam business-invariant checks after restart.
```

The clean-target contract fixes the exact-historical-replacement gap: the
runbook's older `pg_dump --clean --if-exists | psql` path does **not** remove
objects that exist in the target DB yet are absent from an older dump. The
C2 restore script enforces `DROP DATABASE ... WITH (FORCE)` (terminates any
lingering connections; stop the API + worker first per §7.2) +
`CREATE DATABASE ... TEMPLATE template0` (a truly empty database) before
`pg_restore`, so no target-only
schema/data from the previous database survives — the restored database is a
clean logical reconstruction of the dumped Exam database state. This is NOT a
claim of physical byte identity; a logical dump reconstructs the dumped
database's logical schema/data under the supported deployment contract. This was validated by an
automated suite
(`tests/deployment/logical-backup-restore.sh`) that proves a fresh
working Exam with State A is produced from a State-A dump, and State-B-only
data is correctly absent. Restore is **operator-only** (no browser restore
button; the Phase 1 rule).

### 7.3 Cluster globals (not required for the bundled path)

Exam does **not** require `pg_dumpall --globals-only` for the bundled
single-node Compose path:

- The `db` service creates the application role and database at image init
  from `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PASSWORD`. Restoring the
  dump into a database created by the same Compose stack therefore finds the
  role/database already present — they are **recreated by Docker/bootstrap
  configuration, not required in the dump**.
- No PostgreSQL cluster-level roles, tablespaces, or other globals are
  application-defined. The application owns only objects inside its database.

`pg_dumpall --globals-only` is therefore **not** included in the default
backup. If you run against an external PostgreSQL cluster where the role is
not created by Docker init, recreate the role/database manually before
restore (this is already the runbook's external-Postgres stance).

---

## 8. Physical backup, WAL archive, and PITR (C3)

C3 ships **PostgreSQL-native physical backup and point-in-time recovery**:
`pg_basebackup` of the running cluster, continuous WAL archiving, and PITR
restore to an explicit target. This is for full-cluster recovery and for
recovering a specific past point — NOT for routine backups. Routine backups
should use the C2 logical backup (§7).

C3 requires PostgreSQL to be at `wal_level=replica` (already the default in
the bundled image; confirmed at runtime — `replica` is sufficient, `minimal`
is the only level that blocks PITR). It does NOT raise `wal_level` to
`logical`, which would add WAL overhead without changing the PITR capability.

### 8.1 pg_basebackup — physical base backup

`scripts/backup/pg-basebackup.sh` takes a physical base backup of the
running PostgreSQL cluster without stopping it:

```bash
# Online physical base backup into /mnt/backup-exam/base-$(date +%FT%H%M):
bash scripts/backup/pg-basebackup.sh exam-project-name /mnt/backup-exam/base-$(date +%FT%H%M)
```

Properties:

- `pg_basebackup -X stream -c fast -Fp --manifest-checksums SHA256` — the
  required WAL is **streamed at backup time** (`-X stream`), so the base
  backup is internally consistent on its own.
- A `backup_manifest` is produced and **verified** with `pg_verifybackup`
  before the script returns success. `pg_verifybackup` verifies the backup
  contents against the PostgreSQL backup manifest — file presence and
  size, the configured per-file SHA256 checksums, and the manifest's own
  checksum. Manifest verification is backup-integrity
  evidence (the manifest uses checksums; it is not a digital-signature
  system); it is NOT proof that Exam can start and satisfy business
  invariants after restore. A restore drill is still required.
- The backup target must be OUTSIDE the live PGDATA (never write a base
  backup into the directory PostgreSQL is running from).
- The replication connection uses the configured PostgreSQL superuser
  (`POSTGRES_USER`) over the loopback network namespace of the db container,
  authenticated with the deployment password (`POSTGRES_PASSWORD`) passed via
  `PGPASSWORD` (never argv). `pg_basebackup` requires a SUPERUSER or
  REPLICATION-capable role; the bootstrap superuser satisfies this for the
  bundled single-node path. A narrowly scoped replication-only role is NOT
  provisioned today (future hardening / P7-E); the API itself never gets
  replication authority.

> **PITR base-backup rule:** WAL archiving MUST be active BEFORE the base
> backup that will anchor PITR. The sequence is:
> ```text
> enable WAL archiving (postgres-enable-pitr.sh)
>   → verify the archiver actually works
>   → take pg_basebackup
>   → continue archiving WAL
>   → PITR can target later history
> ```
> A base backup taken BEFORE WAL archiving was established is NOT a valid
> anchor for later continuous PITR in the documented procedure.

A base backup is a **whole-cluster** snapshot — it is NOT a per-database
restore. To restore only the `exam` database (or cross PG-major), use the
C2 logical backup (§7).

### 8.2 WAL archive — continuous archiving for PITR

Point-in-time recovery requires a **continuously archived WAL chain** that
starts BEFORE the first base backup. PostgreSQL's documented contract:
"the WAL archiving procedure must be active before the first base backup is
taken."

PITR is enabled by ONE canonical operator command — there is no PITR Compose
file:

```bash
scripts/backup/postgres-enable-pitr.sh [COMPOSE_PROJECT] [COMPOSE_FILE]
```

The script:

1. locates the canonical db container and requires PostgreSQL healthy;
2. makes `/wal-archive` writable by the postgres user with **restrictive**
   permissions (NEVER `chmod 777` — WAL contains database contents);
3. checks `wal_level != minimal` (`replica` is already sufficient);
4. `ALTER SYSTEM SET archive_mode = 'on'` (postmaster-level — restart required);
5. sets an **idempotent** `archive_command` (see §8.2.1);
6. `ALTER SYSTEM SET archive_timeout = '60s'`;
7. restarts ONLY the db service;
8. waits deterministically for PostgreSQL readiness;
9. verifies `archive_mode` / `archive_command` / `archive_timeout`;
10. forces a WAL switch and polls `pg_stat_archiver` for REAL archive evidence
    (not a fixed sleep) — it reports success only after the archiver has
    actually archived a segment.

Because the mechanism is `ALTER SYSTEM` (persisted into
`postgresql.auto.conf` inside PGDATA), the configuration survives
`docker compose down` / `docker compose up` / host relocation of the same
PGDATA. No separate configuration topology is needed.

**The WAL archive MUST be on an INDEPENDENT failure domain** from the
database (NAS / another server / a separate disk). Set
`EXAM_WAL_ARCHIVE_HOST_PATH` to the independent-storage path in production
(the local default `${EXAM_DATA_ROOT}/wal-archive` is for
development/drills only and is NOT host-loss protection).

#### 8.2.1 Idempotent `archive_command`

PostgreSQL may retry archiving the same WAL segment. The canonical
`archive_command` is correct for all three cases (proved by
`tests/deployment/pitr.sh`):

```text
test ! -f /wal-archive/%f && cp %p /wal-archive/%f || cmp -s %p /wal-archive/%f

target absent                    → cp succeeds → exit 0
target exists + identical bytes  → cmp -s succeeds → exit 0
target exists + different bytes  → cmp -s fails → exit non-zero (FAILURE)
```

This replaces the older `test ! -f target && cp source target` form, which
would fail forever on an identical retry (target already exists → non-zero).
A byte collision under the same WAL filename is a visible stuck archive, NOT
a silent overwrite.

### 8.3 PITR — recover to an explicit target

To recover to a specific point:

1. Stop the source cluster (`docker compose down`).
2. Restore a **base backup** (§8.1) into the recovery cluster's PGDATA at
   `${EXAM_DATA_ROOT}/postgres/18/docker` (the PG18 image's PGDATA layout).
3. Copy the WAL archive (§8.2) into the recovery cluster.
4. Write `recovery.signal` into the PGDATA and append to
   `postgresql.auto.conf`:
   ```text
   restore_command = 'cp /wal-archive/%f %p'
   recovery_target_lsn = '0/50176E8'     # OR recovery_target_time / xid
   recovery_target_inclusive = on
   recovery_target_action = 'promote'
   ```
   Choose ONE target:
   - `recovery_target_lsn = '<X/YYY>'` — preferred for deterministic drills
     (clock-skew-independent); capture with `SELECT pg_current_wal_lsn();`
     immediately after the change you want to include.
   - `recovery_target_time = 'YYYY-MM-DD HH:MM:SS'` — natural for "undo the
     14:32 mistake"; needs clock alignment between client and server.
   - `recovery_target_xid = '<32-bit xid>'` — needs a 32-bit xid from
     `txid_current()::text::integer`-style extraction; do NOT pass the
     64-bit xid8 from `pg_current_xact_id()` directly.
5. Start the recovery cluster. PostgreSQL replays WAL up to the target,
   then `promote`s. The recovered cluster is now the new authoritative
   history.

PITR recovery replaces the authoritative history up to the target. See §9
for the boundary.

### 8.4 What C3 does NOT do

- **Not a routine backup strategy.** Use C2 pg_dump (§7) for routine daily
  backups. C3 base backups are heavier; C3 PITR is for disaster recovery.
- **Not a per-database restore.** `pg_basebackup` is a whole-cluster
  snapshot. To restore just the `exam` database, use C2.
- **Not cross-PG-major portable.** A physical base backup is tied to the
  PostgreSQL major version that produced it. To cross PG majors (upgrade),
  use C2 `pg_dump`/`pg_restore`.
- **No PG18 incremental base backups.** Exam scale today does not justify
  them. Re-evaluate at P7-E if measured scale demands it.
- **No retention engine.** Retention of base backups + WAL is the
  operator's responsibility (§8.5). P7-E may add a control plane; not
  started.
- **No automatic desktop client `recoveryEpoch`.** Per ADR-016, C2 logical
  restore and C3 PITR are authoritative-history REPLACEMENT events (not
  same-history). Any offline-client recovery-epoch concern is a future
  Phase 4 concern; no schema change is introduced here.

### 8.5 Retention (operator-owned; no automation shipped)

> **P7-C3 does NOT ship automatic PITR retention/pruning.** Retention is
> operator discipline. Future retention automation belongs in later
> operations / P7-E work, or a mature PostgreSQL backup system (§8.7).

A base backup can only recover **forward** from its own history. A common
but **incorrect** rule is: *"For an N-day PITR window, retain only the most
recent base backup plus WAL."* That is wrong — the most recent base backup
may have been taken INSIDE the window, so it cannot anchor recovery to any
point before itself.

For an earliest desired recovery point `T`, retain at least:

```text
a usable base backup whose completion/history PRECEDES T
+
all WAL required from that base backup through the desired recovery window
+
required timeline history files when timelines exist
```

Conservative guidance:

```text
Do not manually delete base backups or archived WAL that may be required
for the promised recovery window.
```

You MAY delete:

- older base backups, AS LONG AS you keep at least one base backup whose
  history precedes the earliest point in your recovery window, plus the
  complete unbroken WAL chain forward from its checkpoint to the end of the
  window;
- archived WAL segments OLDER than the retained base backup's start
  checkpoint (these cannot be replayed against any retained base backup).

Do NOT delete:

- the base backup(s) anchoring your recovery window;
- any WAL segment between the retained base backup and the current end of
  the PITR window — a single missing segment breaks the chain.

Retention execution is operator discipline; the product records **evidence**
of it. The host-side automation path is
[`scripts/backup/pgbackrest-retain.sh`](../../scripts/backup/pgbackrest-retain.sh)
with evidence recorded through the retention CLI
(`backup-evidence.js retention`), a `retention_runs` ledger, and the
`GET /system/retention-readiness` endpoint. See §12 for the deployment-site
acceptance obligations.

### 8.6 Verification evidence

The deterministic suite in `tests/deployment/` proves the contracts
(`pnpm test:deployment:pitr`, or the whole suite with `pnpm test:deployment`):

- **Happy PITR** — enable archiving via the canonical
  `postgres-enable-pitr.sh` → base backup → pre-base marker → post-base
  State A → State B (capture LSN) → destructive State C → recover to the
  captured LSN → assert A/A1/B present, C absent, promoted. PASS.
- **F1 missing required WAL** — an UNTOUCHED base backup plus a
  complete archive MINUS the one segment that must be replayed to reach an
  explicit `recovery_target_lsn`. The assertion is about failing to REACH
  the target: the cluster stays in archive recovery (`pg_controldata`
  reports `in archive recovery`), restore_command failures for the missing
  segment are visible, and the server never completes recovery (no
  promotion) within a bounded window. Note: `restore_command` returning
  file-not-found for a missing segment is NORMAL at the end of any archive
  — routine recovery routinely asks for files that do not exist. Only a
  recovery target that requires replay through a missing segment proves
  "required WAL missing".
- **F2 corrupt base backup** — tamper one backed-up file →
  `pg_verifybackup` rejects it loudly (per-file checksum mismatch).
- **F3 invalid recovery target** — malformed `recovery_target_lsn` →
  PostgreSQL refuses recovery loudly.
- **Archive idempotency** — the idempotent `archive_command` is correct
  for all three cases: empty target → success; identical retry → success;
  byte collision under the same name → non-zero failure.

> **Product path == test path.** The operator path and the test path are
> the SAME enable-PITR script. No test privately configures PostgreSQL
> through a second hidden method, and no test generates a temporary Compose
> override — recovery clusters start from the same `docker-compose.yml`
> with isolated `EXAM_DATA_ROOT` / `EXAM_WAL_ARCHIVE_HOST_PATH` /
> `COMPOSE_PROJECT_NAME`.

### 8.7 Future boundary: WAL-G / pgBackRest

P7-C deliberately does NOT introduce WAL-G or pgBackRest. But if Exam later
requires any of:

```text
automatic off-host WAL shipping
S3/MinIO
encryption
compression
incremental physical backups
automated retention
large backup chains
low operational RPO
```

then evaluate **WAL-G** or **pgBackRest** instead of growing Exam's own
shell scripts into a bespoke PostgreSQL backup product. Current scope stays
PostgreSQL-native and small. This is an explicit future boundary, not
near-term work.

---

## 9. What Redis loss means

Redis holds only shared rate-limit counters with mandatory TTL. Losing
`data/redis/` (or the whole Redis instance):

- resets rate-limit windows;
- has **no** effect on PostgreSQL Exam authority;
- never creates durable Exam corruption.

Restoring Redis is **not** a condition for restoring Exam authority. Stale
Redis counters only ever cause brief over-limiting; they never
under-limit an irreversible fact.

---

## 10. Restore boundary — same history vs. history replacement (ADR-016)

The recovery procedures fall into exactly two categories:

- **Same authoritative history** — §5 stopped-directory relocation. This
  carries the SAME PostgreSQL history forward to a new host (same files,
  same timeline, same exam state). It is NOT a restore in the
  history-replacement sense; it is the same Exam system on new hardware.

- **Authoritative history replacement** — §6 cold-filesystem restore,
  §7 logical restore, §8 physical restore / PITR. All of these REPLACE the
  authoritative history: the cluster comes back with a different timeline
  (PITR promotes), or a fresh-clean database (C2 `DROP DATABASE` +
  `template0`), or a snapshot from a past moment (C1 cold restore). The
  pre-restore PostgreSQL history is gone after the restore.

Per ADR-016, **no schema change is introduced** to mark these events. The
exam system's authoritative state is whatever PostgreSQL currently holds;
the system does not need to know HOW it got there. Any future offline-client
`recoveryEpoch` concern (e.g. a desktop client noticing the server's history
was replaced) is a Phase 4 platformization concern and is NOT implemented
here. Container restarts and §5 relocations are NOT history-replacement
events — they preserve the timeline.

---

## 11. First Admin (Launchpad) and Admin recovery

### 11.1 Launchpad (initial installation only)

If the installation has never been initialized (the internal default
organization does not exist), navigate to `/launchpad` and complete the
first-Admin setup form. Set `LAUNCHPAD_SETUP_TOKEN` in `.env` before the
first `docker compose up`; it is the deployment bootstrap secret (high
entropy, e.g. `openssl rand -hex 32`). The role is not selectable — the
server always creates role = Admin.

Once initialized, `/launchpad` redirects to `/login` (it never renders a
"completed" page and never reopens). Removing/disabling the last Admin
does **not** reopen launchpad — Admin-loss recovery is operator CLI
territory.

### 11.2 Operator CLI fallback

The first Admin can also be created via the bootstrap CLI (equivalent
canonical mutation body, atomic):

```bash
docker compose exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

### 11.3 Reset an Admin's password

```bash
docker compose exec app \
  node dist/scripts/reset-admin-password.js \
  --username admin --password '<NEW_STRONG_PASSWORD>'
```

This script can ONLY reset Admin passwords. Candidate passwords are reset
by an Admin through the API.

## 12. Deployment-site acceptance (operational runbook obligations)

> **Recorded by the P7 final program closeout (2026-08-14).** Gate P7-3 is
> PASS on **software acceptance**: the product mechanism (typed RTO/RPO
> authority, retention evidence ledger, readiness endpoints, host-side
> scripts) is implemented and tested, and the deterministic clean-volume
> restore drill (`tests/deployment/logical-backup-restore.sh`) was executed
> 2026-08-14 twice with both runs PASS and a measured total drill duration of
> **87 s ≤ the declared RTO of 3600 s (1 h)**. The gate's operational
> acceptance on the **production volume** is a deployment-site obligation,
> not an unfinished product feature. This section is that obligation.

The deployment operator must, at install time and periodically thereafter:

1. **Declare RTO/RPO in the product.** Set the operational policy intent
   (Admin, Operations page — `backup_operational_policy.desired_rto_seconds`
   / `desired_rpo_seconds`, or leave RTO NULL for NOT_CONFIGURED). The
   declared RTO must be realistic for the deployment's volume and restore
   method.
2. **Install and configure pgBackRest on the host** (the architecture-aligned
   path, P7-F option c / P7-E3). Configure `repo*-retention-*` knobs
   (full/diff/archive retention) in `pgbackrest.conf` to match the declared
   RPO/RTO window.
3. **Schedule retention execution** via cron/systemd:
   `scripts/backup/pgbackrest-retain.sh` (runs `pgbackrest expire` and records
   evidence via the retention CLI). The evidence ledger `retention_runs` then
   shows `result=succeeded` with `verification_status=verified` for each real
   run; the `GET /system/retention-readiness` projection reflects it. Never
   fabricate evidence — the CLI guards `--result succeeded` to require
   `--verification-status verified`, and the DB CHECK enforces the invariant.
4. **Schedule recurring restore drills** on the production volume
   (logical `postgres-logical-restore.sh` or physical/PITR
   `postgres-restore-pitr` path), measure each restore's duration, and record
   the drill via `backup-evidence.js drill --result succeeded --duration-ms
   <measured>`. The product's RTO compliance row becomes SATISFIED only from
   automated drill evidence within the declared objective.
5. **Verify post-restore invariants** after every drill: org count, active
   Admin, `admin.bootstrap` audit rows, attempt/answer/snapshot presence, and
   the deployment's own marker checks (see §7/§8 and the drill suites).

The deterministic `tests/deployment/` suite (`pnpm test:deployment`) remains
the product-side proof; the obligations above are the deployment-side proof.
Both are required for the full Gate P7-3 acceptance contract.
