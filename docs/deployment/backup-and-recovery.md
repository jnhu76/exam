# Backup and Recovery Guide

> **Authority:** canonical operator guide for portable persistence, cold
> filesystem backup, and disaster recovery of a single-node Exam deployment.
> Companion to [`mvp-deployment-runbook.md`](./mvp-deployment-runbook.md).
>
> Scope: LAN/on-premise, single-tenant. Do NOT use this guide for any
> multi-tenant, cloud, or Phase 4 deployment — those modes are not
> implemented.

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

## 1. Where data is stored

The production Compose topology (`docker-compose.yml`) uses operator-visible
host bind mounts under `${EXAM_DATA_ROOT:-./data}`:

```text
exam/
├── docker-compose.yml
├── .env
└── data/
    ├── postgres/      ← authoritative: the PostgreSQL data directory (PGDATA)
    └── redis/         ← non-authoritative: rate-limit AOF/RDB (may be lost)
```

- `data/postgres/` is **required**. Deleting it destroys authoritative Exam
  state. The official PostgreSQL image owns its internal layout
  (`data/postgres/18/docker/...`); the operator only needs the
  `data/postgres` parent.
- `data/redis/` is **optional for correctness**. It holds rate-limit state;
  losing it resets operational history but never affects Exam authority.

Set `EXAM_DATA_ROOT` to relocate the whole data root (e.g. to a mounted
NAS volume). The default is `./data` relative to the Compose file.

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

## 4. Decision tree (C1 + C2; C3 forthcoming)

```text
I am moving the server to a new host
    → §5  stopped-directory relocation (C1)

I want the simplest full backup
    → §6  cold-filesystem backup (C1)

I want routine backups without shutting Exam down (online)
    → §7  pg_dump logical backup (C2)

I need exact PostgreSQL physical backup / faster full-cluster recovery
    → C3  pg_basebackup (forthcoming)

I deleted something at 14:32 and need 14:31
    → C3  PITR (forthcoming)
```

C3 (physical `pg_basebackup` + WAL/PITR) is a separate phase of the P7-C
program. Until it ships, the supported backup/restore paths are the C1
cold-filesystem procedures (§5–§6) and the C2 logical procedures (§7).

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

The PGDATA files are owned by the container's postgres user (uid 999) and
are not readable by the host user, so copy as root (or via a helper
container):

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
#    destination with ownership/mode/symlinks preserved):
scripts/backup/cold-filesystem-backup.sh ./data /mnt/nas/exam-backups/2026-08-10

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

The PGDATA files are owned by the container postgres user (uid 999) with
mode `drwxrwxr-x`-style permissions. Relocation tools (`rsync -aHAX`,
`tar`, or the helper-container `cp -a` used by the scripts) preserve
owner/group/mode. Do **not** run broad host `chmod 777` on the data
directory. The official postgres image chowns the PGDATA on container
start, so a fresh empty bind mount is also initialized correctly.

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
#    pg_restore). The result is an EXACT match of the dump — NOT a merge.
#    The script requires you to type the target DB name to confirm.
scripts/backup/postgres-logical-restore.sh exam /mnt/nas/exam-logical/<date>.dump exam

# 3. Restart the API + worker to use the restored database:
docker compose up -d app email-worker

# 4. Run your Exam business-invariant checks after restart.
```

The clean-target contract fixes the exact-historical-replacement gap: the
runbook's older `pg_dump --clean --if-exists | psql` path does **not** remove
objects that exist in the target DB yet are absent from an older dump. The
C2 restore script enforces `DROP DATABASE` + `CREATE DATABASE ... TEMPLATE
template0` (a truly empty database) before `pg_restore`, so the restored
database is byte-for-byte the dump's state. This was validated by an
automated drill
(`scripts/deployment/p7-c2-logical-restore-drill.sh`) that proves a fresh
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

## 8. What Redis loss means

Redis holds only shared rate-limit counters with mandatory TTL. Losing
`data/redis/` (or the whole Redis instance):

- resets rate-limit windows;
- has **no** effect on PostgreSQL Exam authority;
- never creates durable Exam corruption.

Restoring Redis is **not** a condition for restoring Exam authority. Stale
Redis counters only ever cause brief over-limiting; they never
under-limit an irreversible fact.

---

## 9. First Admin (Launchpad) and Admin recovery

### 8.1 Launchpad (initial installation only)

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

### 8.2 Operator CLI fallback

The first Admin can also be created via the bootstrap CLI (equivalent
canonical mutation body, atomic):

```bash
docker compose exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

### 8.3 Reset an Admin's password

```bash
docker compose exec app \
  node dist/scripts/reset-admin-password.js \
  --username admin --password '<NEW_STRONG_PASSWORD>'
```

This script can ONLY reset Admin passwords. Candidate passwords are reset
by an Admin through the API.
