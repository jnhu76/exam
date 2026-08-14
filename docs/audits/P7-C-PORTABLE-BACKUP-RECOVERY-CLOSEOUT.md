# P7-C — Portable Persistence, Backup & PostgreSQL Disaster Recovery (Closeout)

> **Superseded (2026-08-14):** the "READY FOR HUMAN REVIEW" status below was
> superseded by P7-F (2026-08-13) and finally by the
> [`P7-FINAL-PROGRAM-CLOSEOUT.md`](P7-FINAL-PROGRAM-CLOSEOUT.md) (P7 CLOSED;
> Gate P7-3 PASS under the revised software / deployment-site acceptance
> semantics). The drill/mechanism record remains accurate.

**Status:** READY FOR HUMAN REVIEW
**Program:** P7-C REBUILD (portable persistence / backup / PostgreSQL DR)
**Baseline (`origin/master`):** `2a1a9eb30fc40a10d119571d4ad3befb5b52e26e`
**Verification implementation head:** see Git history / PR (the commit on
which the deployment suite in §5 was executed)
**Branch:** `feat/p7-c-portable-backup-recovery`

This document is the single source of truth for the FINAL P7-C shape: what
the program shipped, what it deliberately does NOT ship, and what remains
for P7-E. Authoritative procedures live in
`docs/deployment/backup-and-recovery.md`; this closeout is the audit /
decision record. Historical development mistakes and earlier architecture
states are recorded in `docs/audits/*` and Git history, not repeated here.

---

## 1. Final architecture

```text
ONE production docker-compose.yml

C1  portable persistence (operator-visible host bind mounts)
    + stopped filesystem backup/restore

C2  pg_dump -Fc (online logical backup)
    + clean pg_restore (DROP + template0, --no-owner --exit-on-error)

C3  pg_basebackup (physical base backup)
    + pg_verifybackup (physical integrity)
    + optional PostgreSQL-native WAL archiving / PITR

Launchpad  first-install only (HTTP adapter over the canonical bootstrap)
           + operator CLI fallback
```

**One-Compose model.** `docker-compose.yml` is the ONLY production/operator
Compose entry point. There is no `docker-compose.pitr.yml`, no custom
postgres-pitr image, no backup/restore Compose variant. A repository guard
(`scripts/repository-contract/deployment-topology-contract.mjs`) forbids
production Compose variants while allowing intentional dev/test files
(`docker-compose.dev.yml`, `docker-compose.test*.yml`).

**PITR is a PostgreSQL cluster capability, not a topology.** Enabling it is
`scripts/backup/postgres-enable-pitr.sh` — `ALTER SYSTEM SET archive_mode =
on` (plus idempotent `archive_command` and `archive_timeout = 60s`), a
db-only restart, then real archiver evidence from `pg_stat_archiver`.
`ALTER SYSTEM` persists into `postgresql.auto.conf` inside PGDATA, so the
configuration survives `docker compose down` / `up` and host relocation of
the same PGDATA.

**Routine vs. recovery backup.**

```text
routine backup   = pg_dump -Fc (C2, online)
physical backup  = pg_basebackup -X stream -Fp --manifest-checksums SHA256 (C3)
physical check   = pg_verifybackup (per-file checksums + manifest integrity)
PITR             = WAL archive + explicit recovery target (C3, optional)
Redis            = non-authoritative (rate-limit counters only)
restore          = operator-owned (no browser restore, ever)
```

---

## 2. Authority stores

| Store | Authority | Durability |
| --- | --- | --- |
| PostgreSQL | **sole authoritative** durable store | `pgdata` → `${EXAM_DATA_ROOT}/postgres` (bind-mounted, operator-visible) |
| Redis | **non-authoritative** | rate-limit counters only, TTL-bounded, optional profile |
| App filesystem | **no durable writes** | no durable state outside PostgreSQL |

---

## 3. Backup / recovery matrix

| Path | Online? | Scope | Replaces history? | Operator command | Verification |
| --- | --- | --- | --- | --- | --- |
| Container restart / recreation | — | — | No — same history | `docker compose down` / `up -d` | `persistence-and-cold-restore.sh` |
| Stopped-directory relocation (C1) | No (stop) | Whole data dir | **No** — same history | `cp -a` / `rsync -aHAX` while stopped | `persistence-and-cold-restore.sh` |
| Cold-filesystem backup/restore (C1) | No (stop) | Whole data dir | Yes | `cold-filesystem-backup.sh` / `-restore.sh` | `persistence-and-cold-restore.sh` |
| Logical backup (C2) | **Yes** | One DB (`exam`) | Yes (clean restore) | `postgres-logical-backup.sh` / `-restore.sh` | `logical-backup-restore.sh` |
| Physical base backup (C3) | **Yes** | Whole cluster | Yes | `pg-basebackup.sh` | `pitr.sh` (base backup + verify) |
| WAL archive + PITR (C3) | **Yes** | WAL replay to target | Yes (replay + promote) | `postgres-enable-pitr.sh` + recovery procedure | `pitr.sh` (happy + failure modes) |

---

## 4. Operator commands

```text
scripts/backup/
├── cold-filesystem-backup.sh     # stopped PGDATA copy (refuses a running source)
├── cold-filesystem-restore.sh    # restore into a fresh data root (explicit confirm)
├── postgres-logical-backup.sh    # online pg_dump -Fc --no-owner
├── postgres-logical-restore.sh   # DROP + template0 + pg_restore (CLEAN target)
├── pg-basebackup.sh              # online physical base backup + pg_verifybackup
└── postgres-enable-pitr.sh       # ALTER SYSTEM archive_* + archiver proof
```

The **online PostgreSQL scripts** (`postgres-logical-backup.sh`,
`postgres-logical-restore.sh`, `pg-basebackup.sh`,
`postgres-enable-pitr.sh`) derive the deployment's `POSTGRES_USER` /
`POSTGRES_DB` (and password where needed) from the RUNNING db container —
no hardcoded credentials, no password on argv. The **cold-filesystem
scripts** (`cold-filesystem-backup.sh`, `cold-filesystem-restore.sh`)
never touch a running database container: they validate source/destination
paths, refuse a live `postmaster.pid` (backup) or a populated destination
(restore), and copy via a throwaway helper container that preserves
ownership/mode/symlinks.

Verification lives separately under `tests/deployment/` (capability-named,
phase-free):

```text
tests/deployment/
├── lib.sh                          # mechanical shared helpers (polling, temp roots, probes)
├── compose-smoke.sh                # production Compose parses/starts; env contract; worker/redis wiring
├── launchpad-bootstrap.sh          # first-install deployment contract (token wiring, 409, register disabled)
├── persistence-and-cold-restore.sh # container recreation + relocation + cold round-trip
├── logical-backup-restore.sh       # online dump; A present, B absent after clean restore
└── pitr.sh                         # archive idempotency; happy PITR; missing-WAL / corrupt / invalid-target
```

Entry points: `pnpm test:deployment` (full suite) and per-capability
`test:deployment:compose|launchpad|persistence|logical|pitr`.

---

## 5. Verification evidence

### 5.1 Deployment suite (deterministic Docker drills)

All tests run the canonical `docker-compose.yml` against isolated Compose
projects and isolated temp `EXAM_DATA_ROOT`s — the repo-root `./data/` and
any human/dev stack are never touched. No test generates a temporary
Compose override; recovery clusters are started with the canonical Compose
plus environment (`EXAM_DATA_ROOT`, `EXAM_WAL_ARCHIVE_HOST_PATH`,
`POSTGRES_PASSWORD`, `COMPOSE_PROJECT_NAME`). Readiness is bounded polling
(`pg_isready`, `/api/health`, `pg_stat_archiver`, archived-segment
presence), never arbitrary fixed sleeps.

| Suite | Proves |
| --- | --- |
| `compose-smoke.sh` | `POSTGRES_PASSWORD` required; Redis optional at parse, authenticated when enabled; app/db/worker ordering; migrations exactly once; bootstrap-admin one Admin; login; seed refusal; SIGTERM clean shutdown |
| `launchpad-bootstrap.sh` | token reaches app via compose interpolation; wrong token 403; first Admin 200; re-bootstrap 409 (no token oracle); register disabled; unset token disables launchpad |
| `persistence-and-cold-restore.sh` | container recreation persistence; stopped-directory relocation; cold backup/restore round-trip — identical invariants each time |
| `logical-backup-restore.sh` | online `pg_dump -Fc`; State A → mutate B → clean restore → A present, B absent, org/admin/audit + Admin password hash match A |
| `pitr.sh` | archive idempotency (absent → OK, identical retry → OK, byte collision → FAIL); happy PITR (A + A1 + B present, C absent, promoted); F1 missing REQUIRED WAL (explicit target unreachable — recovery stays in recovery, replay LSN < target, post-missing state absent, restore_command failures visible); F2 corrupt base backup (`pg_verifybackup` rejects); F3 invalid recovery target (refused loudly) |

### 5.2 Repository gates

| Gate | Result |
| --- | --- |
| `pnpm verify:static` | PASS (lint, architecture, env-contract, repo-contract incl. one-compose guard, migration journal) |
| `pnpm test` | PASS (see PR for final counts) |
| `pnpm build` | PASS |
| CI | see PR (do not merge automatically) |

---

## 6. Known limitations

1. **Retention is manual.** P7-C does NOT automate PITR retention/pruning.
   A promised recovery window requires: a usable base backup old enough to
   precede the earliest desired target, every required WAL segment from
   that base backup through the target window, and required timeline
   history. Do not manually prune backup/WAL history unless the retained
   chain has been deliberately validated. (§8.5 of `backup-and-recovery.md`.)
2. **Physical backups are PG-major-tied.** Cross-major migration requires
   the C2 logical path.
3. **`archive_timeout` (60s) bounds archival freshness for active
   workloads.** The archiver switches and archives a segment at least every
   60s, so at most 60s of WAL can await archival on a busy cluster.
   Recovery precision is NOT bounded by `archive_timeout`: recovery
   depends on the available archived WAL and the selected recovery target
   (`recovery_target_time`, `recovery_target_lsn`,
   `recovery_target_name`, or `recovery_target_xid`).
4. **C3 replication uses the configured `POSTGRES_USER` superuser over the
   db container's loopback namespace.** A hardened deployment should create
   a narrowly scoped replication role (documented in `pg-basebackup.sh`);
   the API itself never gets replication authority.
5. **The WAL archive default path is `${EXAM_DATA_ROOT}/wal-archive`.**
   Production MUST override `EXAM_WAL_ARCHIVE_HOST_PATH` to an independent
   failure domain; the default is for development/drills only and is NOT
   host-loss protection.
6. **No Admin backup visibility.** Operators run scripts from the host;
   there is no in-product backup dashboard. Restore is operator-only by
   design.
7. **Same-host relocation proof.** The automated relocation regression uses
   two temp dirs on the same host. The product contract is ordinary
   filesystem relocation while PostgreSQL is stopped; per-OS filesystem
   proof is out of scope.
8. **`recovery_target_lsn` is the recommended target type.** Time-based
   targets need clock alignment; xid-based targets need a 32-bit xid (the
   64-bit xid8 from `pg_current_xact_id()` is rejected). Documented in
   `backup-and-recovery.md` §8.3.

**Future boundary (explicit, not started):** if Exam later requires
automatic off-host WAL shipping, S3/MinIO, encryption, compression,
incremental backup chains, automated pruning/retention, large backup sets,
or low-RPO operational automation, evaluate **WAL-G** or **pgBackRest**
rather than growing Exam's shell scripts indefinitely.

---

## 7. Same-history vs. history-replacement boundary (ADR-016)

| Event | Same authoritative history? |
| --- | --- |
| Container restart / recreation | Yes |
| Stopped-directory relocation (C1) | Yes — same files, same timeline, new host |
| Cold-filesystem restore (C1) | **No** — snapshot from a past moment replaces the live history |
| Logical restore (C2) | **No** — fresh-clean database from a dump |
| Physical restore / PITR (C3) | **No** — base backup + WAL replay to target, then promote (new timeline) |

No schema change is introduced to mark history-replacement events. The
exam system's authoritative state is whatever PostgreSQL currently holds;
it does not need to know HOW it got there. Any future offline-client
`recoveryEpoch` concern is a Phase 4 platformization concern and is NOT
implemented here.

---

## 8. Scope discipline (what was NOT built)

- NO second production Compose; NO PITR Docker image; NO migration
  preflight; NO custom backup format; NO backup manifest protocol; NO
  custom WAL manager; NO retention engine; NO backup scheduler; NO backup
  UI; NO restore UI.
- NO WAL-G; NO pgBackRest; NO Kubernetes; NO Patroni; NO HA; NO startup
  reconciler; NO P7-E.
- Launchpad remains FIRST-INSTALL ONLY. The canonical bootstrap mutation
  (`bootstrapAdminOnFreshDb`) is shared verbatim by the HTTP Launchpad
  adapter and the `bootstrap-admin` CLI; both serialize on the same
  transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock`), so
  HTTP-vs-HTTP, HTTP-vs-CLI, and CLI-vs-CLI races have exactly one winner.
  The audit records the real adapter (`source: "local_script" | "launchpad"`);
  the HTTP race loser maps to `409 LAUNCHPAD_ALREADY_INITIALIZED` (never an
  internal 500). Covered by deterministic concurrency tests
  (`bootstrap-admin.test.ts`, `launchpad.test.ts`).

---

## 9. P7-E handoff

The following are explicitly deferred to a future P7-E control-plane
program (NOT started, NOT scheduled by this closeout):

1. **RPO/RTO profile automation.** Today's scheduling is cron-on-host.
   P7-E could define named profiles (small-internal / standard /
   high-stakes) and automate the schedule + retention per profile.
2. **Retention automation.** A control plane that keeps the base-backup +
   WAL-chain invariant (§8.5 of `backup-and-recovery.md`) without operator
   manual discipline.
3. **Admin backup visibility surface.** A read-only Admin view of backup
   history / manifest status / last-verified timestamp. (Restore stays
   operator-owned — no Admin restore button, ever.)
4. **Files/settings backup beyond PostgreSQL.** Attachments, generated
   exports, and organization settings currently live in PostgreSQL (in-DB
   authority). A separate files/settings backup is future only if/when
   durable state appears outside PostgreSQL.
5. **Cross-PG-major upgrade playbook.** A documented + drilled
   `pg_dump`-on-old → `pg_restore`-on-new procedure (the C2 primitives
   exist; the playbook is P7-E).

None of the above is a safety regression in the current shape. They are all
capability extensions.

---

## 10. Findings

| Severity | Count | Notes |
| --- | --- | --- |
| **P0** (blocks release) | 0 | — |
| **P1** (must fix before merge, safety) | 0 | — |
| **P2** (should fix, tracked) | 0 | — |
| **P3** (nice-to-have) | 0 | — |

---

## 11. Verdict

P7-C PORTABLE PERSISTENCE / BACKUP / POSTGRESQL RECOVERY READY FOR HUMAN REVIEW
