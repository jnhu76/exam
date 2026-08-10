# P7-C — Portable Persistence, Backup & PostgreSQL Disaster Recovery (Closeout)

**Status:** READY FOR HUMAN REVIEW
**Program:** P7-C REBUILD (portable persistence / backup / PostgreSQL DR)
**Baseline (`origin/master`):** `2a1a9eb30fc40a10d119571d4ad3befb5b52e26e`
**Final head:** `0df4ba721340532e6b88f6d9fbd926b3f95635c8`
**Branch:** `feat/p7-c-portable-backup-recovery`
**Closeout date:** 2026-08-10

This document is the single source of truth for what P7-C rebuilt, what it
shipped, what it deliberately does NOT ship, and what remains for P7-E.
Authoritative procedures live in `docs/deployment/backup-and-recovery.md`;
this closeout is the audit/decision record.

---

## 1. Mission recap

P7-C was rebuilt from scratch off `origin/master`. The previous attempt
(PR #273) is treated as historical/reference evidence only — it is NOT the
baseline and was NOT repaired, cherry-picked, or simplified. The rebuild
executed the full C1 → C2 → C3 phase sequence in one branch with one
commit per phase.

**Authority stores (reconfirmed at C0):**

| Store | Authority | Durability |
| --- | --- | --- |
| PostgreSQL | **sole authoritative** durable store | `pgdata` → `${EXAM_DATA_ROOT}/postgres` (bind-mounted, operator-visible) |
| Redis | **non-authoritative** | rate-limit counters only, TTL-bounded, optional profile |
| App filesystem | **no durable writes** | `/app/data` unused; no durable state outside PostgreSQL |

No contradiction with `master`. This is the foundation every backup/restore
procedure below rests on.

---

## 2. Phase-by-phase evidence

### C1 — Portable persistence + cold backup/DR + Launchpad
Commit `df2d07df` — `feat(p7-c1): portable persistence, cold backup and launchpad`

| Item | Evidence |
| --- | --- |
| Bind-mount portable persistence | `docker-compose.yml`: `${EXAM_DATA_ROOT:-./data}/postgres:/var/lib/postgresql` + `/redis:/data`; top-level named-volume block removed; `.gitignore` adds `/data/` |
| Deployment-topology contract upheld | `pnpm verify:static` — `docker-compose.yml deploys the required MVP topology` PASS (POSTGRES_PASSWORD required-expansion, redis auth, profiles) |
| Dev/test isolation preserved | `docker-compose.dev.yml` untouched (keeps anonymous volume); `p6-corr1-compose-smoke.sh` uses path-guarded `mktemp -d` EXAM_DATA_ROOT |
| Cold relocation proof | `scripts/deployment/p7-c1-persistence-smoke.sh` — up → bootstrap → invariants → down → relocate (`cp -a` via container-assisted copy for uid-999 files) → up → identical invariants. **PASS** |
| Cold backup/restore round-trip | `scripts/deployment/p7-c1-cold-backup-restore-drill.sh` — backup → wipe → restore → invariants match. **PASS** |
| Launchpad (first-install only) | `GET /api/launchpad/status` + `POST /api/launchpad/bootstrap`; constant-time token compare; init-gate runs FIRST (no token oracle); shares `bootstrapAdminOnFreshDb` canonical mutation; `/launchpad` page redirects to `/login` once initialized; removing last Admin does NOT reopen launchpad |
| Launchpad tests | `apps/api/src/routes/launchpad.test.ts` (6 tests) + `apps/web/src/pages/LaunchpadPage.test.tsx` (5 tests) — all PASS |

### C2 — PostgreSQL logical backup + clean restore
Commit `e164fd30` — `feat(p7-c2): logical backup and verified clean restore`

| Item | Evidence |
| --- | --- |
| Online logical backup | `scripts/backup/postgres-logical-backup.sh` — `pg_dump -Fc`; asserts artifact non-empty + `pg_restore --list` succeeds; password via `PGPASSWORD` (never argv) |
| Clean restore contract | `scripts/backup/postgres-logical-restore.sh` — `DROP DATABASE` + `CREATE DATABASE ... TEMPLATE template0` + `pg_restore --no-owner --exit-on-error` (NOT `--clean --if-exists` into a dirty DB — closes the C2 pre-rebuild gap) |
| A-present/B-absent drill | `scripts/deployment/p7-c2-logical-restore-drill.sh` — State A → dump → mutate to State B → restore A into CLEAN fresh-target → assert A present, B absent, business invariants (org/admin/audit + Admin password hash) match A. **PASS** |
| Works API-down, PG-up | Both scripts talk to the db container directly; the API does not need to be running |

### C3 — PostgreSQL physical backup / WAL / PITR
Commit `0df4ba72` — `feat(p7-c3): physical backup and PITR`

| Item | Evidence |
| --- | --- |
| Runtime re-audit | `postgres:18.4-bookworm`; `wal_level=replica` (sufficient for PITR; `minimal` is the only blocker); `archive_mode=off` by default |
| Physical base backup | `scripts/backup/pg-basebackup.sh` — `pg_basebackup -X stream -c fast -Fp --manifest-checksums SHA256`; `pg_verifybackup` on the manifest before success |
| WAL continuous archiving | `docker-compose.pitr.yml` + `docker/pitr/wal-archive.conf` — `archive_mode=on`, non-overwriting `archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f'` (collision = visible failure, not silent overwrite); `archive_timeout=60s` |
| PITR happy path | `scripts/deployment/p7-c3-pitr-drill.sh` — base backup → marker A → marker B (capture LSN) → destructive marker C → recover to captured LSN → A present, B present, C absent. **PASS** |
| PITR failure modes | `scripts/deployment/p7-c3-pitr-failure-drill.sh` — F1 missing WAL segment (loud), F2 corrupt base backup (`pg_verifybackup: error: checksum mismatch`, loud), F3 invalid `recovery_target_lsn` (cluster refuses to start, loud). **3/3 PASS** |
| `recovery_target_lsn` chosen | clock-skew-independent; the xid8-vs-xid mismatch (the pre-LSN attempt) is documented in `backup-and-recovery.md` §8.3 |

---

## 3. Backup / restore matrix

| Path | Online? | Scope | Replaces history? | Script | Drill |
| --- | --- | --- | --- | --- | --- |
| Stopped relocation (C1) | No (stop) | Whole data dir | **No** — same history | (manual `cp -a` / rsync `-aHAX`) | `p7-c1-persistence-smoke.sh` |
| Cold-filesystem backup (C1) | No (stop) | Whole data dir | Yes | `cold-filesystem-backup.sh` / `-restore.sh` | `p7-c1-cold-backup-restore-drill.sh` |
| Logical backup (C2) | **Yes** | One DB (`exam`) | Yes (clean restore) | `postgres-logical-backup.sh` / `-restore.sh` | `p7-c2-logical-restore-drill.sh` |
| Physical base backup (C3) | **Yes** | Whole cluster | Yes | `pg-basebackup.sh` | (part of PITR drill) |
| WAL archive + PITR (C3) | **Yes** | WAL replay to target | Yes (replay + promote) | `docker-compose.pitr.yml` override | `p7-c3-pitr-drill.sh` + failure drill |

---

## 4. Downtime requirements

| Operation | Exam downtime | Notes |
| --- | --- | --- |
| Stopped relocation (C1 §5) | Full (stop → copy → start) | Same history; new host |
| Cold-filesystem backup (C1 §6) | Full during backup | Simplest full snapshot |
| Cold-filesystem restore (C1 §6) | Full during restore | History replacement |
| Logical backup (C2 §7) | **None** (online) | Routine path |
| Logical restore (C2 §7) | Full during restore | Clean DB replacement; stop API+worker first |
| Physical base backup (C3 §8.1) | **None** (online) | `pg_basebackup` of running cluster |
| PITR restore (C3 §8.3) | Full during restore | Stop source → restore base + WAL → recover to target → promote |

---

## 5. Version compatibility

- **Physical backups are PG-major-tied.** A `pg_basebackup` from PG18
  restores on PG18. To cross PG majors, use the C2 logical path
  (`pg_dump`/`pg_restore`).
- **Logical backups are portable** across PG majors (subject to the usual
  dump/restore caveats for deprecated features).
- **Cold copies are PG-major-tied** (they ARE the PGDATA).

---

## 6. Off-host requirement

- **C1 cold backup, C2 logical, C3 base backup, C3 WAL archive** must ALL
  land on an **independent failure domain** from the database host. A
  backup on the same disk as PGDATA dies with the disk.
- The C3 WAL archive override exposes `EXAM_WAL_ARCHIVE_HOST_PATH` so the
  operator can point the archive at NAS / a separate server / a separate
  disk. The default `${EXAM_DATA_ROOT}/wal-archive` is for development /
  drills only.

---

## 7. Drill evidence (final adversarial run, 2026-08-10)

All five deterministic Docker drills were re-run on the final head. Each
uses isolated temp `EXAM_DATA_ROOT` / project names / data roots and cleans
up with path-guarded traps. **No human/dev database is touched.**

| Drill | Result |
| --- | --- |
| `p7-c1-persistence-smoke.sh` (persistence + cold relocation) | **PASS** |
| `p7-c1-cold-backup-restore-drill.sh` (cold round-trip) | **PASS** |
| `p7-c2-logical-restore-drill.sh` (A-present/B-absent clean restore) | **PASS** |
| `p7-c3-pitr-drill.sh` (PITR happy path: A+B present, C absent) | **PASS** |
| `p7-c3-pitr-failure-drill.sh` (F1 missing WAL, F2 corrupt backup, F3 invalid LSN) | **3/3 PASS** |

Final gates on the final head:

| Gate | Result |
| --- | --- |
| `pnpm verify:static` | PASS (lint, architecture, env-contract, repo-contract, topology, migration journal 29 entries) |
| `pnpm test` | PASS (2019 tests, 7 skipped, 0 failed across 153 files) |
| `pnpm build` | PASS (9 tasks) |

---

## 8. Adversarial matrix (§7 of the program prompt)

| Scenario | Outcome |
| --- | --- |
| Stop Exam, copy COMPLETE PGDATA, restart on new host | PASS (C1 relocation drill) |
| Stop Exam, copy COMPLETE PGDATA, restart on same host | PASS (C1 cold drill) |
| Live-copy active PGDATA with ordinary `cp`/`tar` | REFUSED — not supported; documented as corrupting. Cold path requires stopped server. |
| Partial copy of PostgreSQL relation files | REFUSED — not supported; documented. |
| `pg_dump` online, restore into CLEAN DB | PASS (C2 drill, A-present/B-absent) |
| `pg_dump` restore into dirty DB via `--clean --if-exists` | REFUSED — clean-restore contract only |
| `pg_basebackup` online, `pg_verifybackup` clean | PASS (C3 drill) |
| `pg_basebackup` + corrupt one file | LOUD FAIL — `pg_verifybackup: checksum mismatch` (F2) |
| WAL archive with non-overwriting `archive_command` | PASS — collision = visible stuck archive |
| PITR to captured LSN | PASS — A+B present, C absent |
| PITR with missing WAL segment | LOUD FAIL — recovery surfaces missing segment (F1) |
| PITR with invalid `recovery_target_lsn` | LOUD FAIL — cluster refuses to start (F3) |
| `recovery_target_xid` fed a 64-bit xid8 | DOCUMENTED PITFALL — use `recovery_target_lsn` or a 32-bit xid; the drill uses LSN |
| Restore while API is up | DOCUMENTED — stop API+worker before any restore; restore is operator-owned |
| Admin "restore" button in the browser | REFUSED — explicitly out of scope; restore is operator CLI/script territory |
| Launchpad as a token-validity oracle on a completed install | REFUSED — init-gate runs FIRST; 409 regardless of token once initialized |
| Removing the last Admin reopens Launchpad | REFUSED — init-gate is `default org exists`, not `activeAdminCount == 0` |
| Broad host `chmod 777` | REFUSED — only the WAL archive dir in the isolated drill is chmod'd; production docs do not instruct host-wide chmod |
| Unvalidated `rm -rf "$EXAM_DATA_ROOT"` | REFUSED — every drill cleanup is path-guarded (`grep -Eq '/tmp/p7c[0-9a-z_-]+$'`) |

---

## 9. Scope discipline (what was NOT built)

Per the program spec ("Delete ceremony, not safety"), the following were
deliberately NOT introduced. This list is the negative-space contract.

- NO custom relocation manifest protocol (C1 relocation is ordinary
  filesystem copy of a stopped PGDATA — no metadata protocol).
- NO Docker image identity framework / OCI digest authority subsystem.
- NO cross-runner `docker-save` recovery bundle.
- NO migration-history preflight framework (the drizzle journal already
  lives in the database; the bundled image self-migrates on start).
- NO historical-migration omission allowlist in deployment startup.
- NO custom recovery-epoch implementation (per ADR-016, no schema change
  marks history-replacement events; same-history vs. replacement is a
  documented boundary, not a runtime mechanism).
- NO generic startup reconciler / background job framework.
- NO Kubernetes, NO Patroni, NO HA cluster (single-node is the supported
  Phase 1 deployment shape).
- NO Admin restore button (restore is operator-owned).
- NO Desktop recovery-epoch implementation (Phase 4 concern).
- NO PG18 incremental base backups (scale does not justify today).
- NO retention engine (retention is operator discipline; P7-E may add a
  control plane — not started).
- NO PITR automation in the base `docker-compose.yml` (the override is
  opt-in; base stays PITR-free for simple deployments).
- NO P7-E config control plane (RPO/RTO profile automation, Admin backup
  visibility, files/settings backup beyond PostgreSQL — all future).

PR #273 remains historical/reference material only. The rebuilt C1/C2/C3
does not recreate PR #273 under different names: it ships a thin Launchpad
HTTP adapter over the existing canonical `bootstrapAdminOnFreshDb`
mutation, the PG-native backup tooling (`pg_dump`/`pg_basebackup`/WAL
archive) that PostgreSQL already provides, and deterministic drills. No
ceremony was reintroduced.

---

## 10. ADR-016 boundary (same history vs. history replacement)

| Event | Same authoritative history? |
| --- | --- |
| Container restart / recreation | Yes |
| §5 stopped-directory relocation (C1) | Yes — same files, same timeline, new host |
| §6 cold-filesystem restore (C1) | **No** — snapshot from a past moment replaces the live history |
| §7 logical restore (C2) | **No** — fresh-clean database from a dump |
| §8 physical restore / PITR (C3) | **No** — base backup + WAL replay to target, then promote (new timeline) |

No schema change is introduced to mark history-replacement events. The
exam system's authoritative state is whatever PostgreSQL currently holds;
it does not need to know HOW it got there. Any future offline-client
`recoveryEpoch` concern is a Phase 4 platformization concern and is NOT
implemented here.

---

## 11. Known limitations

1. **Retention is manual.** Operators must keep (a) at least one base
   backup whose start checkpoint is covered by the retained WAL chain and
   (b) every WAL segment from that checkpoint forward to the end of the
   PITR window. Deleting a single in-window segment breaks the chain.
   P7-E may add automation; not started.
2. **Physical backups are PG-major-tied.** Cross-major migration requires
   the C2 logical path.
3. **PITR target granularity is bounded by `archive_timeout` (60s).** A
   low-write cluster still archives within 60s, but sub-minute PITR
   targets in a quiet period may be coarser than wall-clock suggests.
4. **C3 replication uses the configured `exam` superuser over the db
   container's loopback namespace.** A hardened deployment should create a
   narrowly scoped replication role (documented in the script header); the
   API itself never gets replication authority.
5. **The WAL archive default path is `${EXAM_DATA_ROOT}/wal-archive`.**
   Production MUST override `EXAM_WAL_ARCHIVE_HOST_PATH` to independent
   storage; the default is for development/drills only.
6. **No Admin backup visibility.** Operators run scripts from the host;
   there is no in-product backup dashboard. Restore is operator-only by
   design.
7. **Same-host C1 relocation drill.** The automated C1 relocation
   regression uses two temp dirs on the same host (the program prompt
   explicitly allows this). The product contract is ordinary filesystem
   relocation; per-OS filesystem proof is out of scope.
8. **`recovery_target_lsn` is the recommended target type.** Time-based
   targets need clock alignment; xid-based targets need a 32-bit xid (the
   64-bit xid8 from `pg_current_xact_id()` is rejected). This is
   documented in `backup-and-recovery.md` §8.3.

---

## 12. P0–P3 findings

| Severity | Count | Notes |
| --- | --- | --- |
| **P0** (blocks release) | 0 | — |
| **P1** (must fix before merge, safety) | 0 | — |
| **P2** (should fix, tracked) | 0 | (P2-2 / P2-3 from the C0 audit — clean-restore contract + round-trip drill — are CLOSED by the C2 and C1 drills respectively) |
| **P3** (nice-to-have) | 0 | — |

No outstanding P0/P1/P2/P3 against this rebuild.

---

## 13. P7-E handoff

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

None of the above is a safety regression in the current rebuild. They are
all capability extensions.

---

## 14. Roadmap reconciliation

- `docs/roadmap/current.md`: P7 row updated; execution-order block
  records P7-C as REBUILT & SHIPPED; Workstream-4 description carries the
  post-rebuild status note.
- `docs/roadmap/P7-system-readiness-and-exam-modes.md`: Workstream C
  re-scoped to the rebuilt C0/C1/C2/C3 shape; the pre-rebuild
  C1=config-taxonomy / C2=settings-service / C3=settings-UI framing is
  explicitly superseded (those items now live under Workstream E and are
  not started); the sequence block records P7-C as shipped and P7-E as
  the future control plane.

---

---

## 16. Corrective pass (adversarial audit P7-C-REBUILD-ADVERSARIAL-PG-BACKUP-CONFIG-AUDIT)

This section records the corrective pass that addressed the adversarial
audit findings. It does NOT erase the history above; §1–§15 remain the
rebuild record.

- **Previous head:** `0ebdf6eb` (`docs(p7-c): close portable backup and recovery program`)
- **Corrective final head:** `f0016c2e` (`docs(p7-c): align backup and recovery operator contract`)
- **Audit source:** `docs/audits/P7-C-REBUILD-ADVERSARIAL-PG-BACKUP-CONFIG-AUDIT.md`

### What changed and why

| Correction | What was wrong | What the corrective pass did |
| --- | --- | --- |
| **One-Compose model** | `docker-compose.pitr.yml` created a second operator Compose topology for PITR. | Deleted `docker-compose.pitr.yml` and `docker/pitr/wal-archive.conf`. There is now exactly ONE production Compose entry point (`docker-compose.yml`). PITR is a database capability, not an alternate topology. A repository guard (`deployment-topology-contract.mjs`) forbids production Compose variants while allowing dev/test files. |
| **WAL archive mount** | The WAL archive only existed behind the PITR override. | Added ONE WAL archive mount to the canonical `db` service (`${EXAM_WAL_ARCHIVE_HOST_PATH:-…}/wal-archive:/wal-archive`). The mount exists but stays inert (`archive_mode=off`) until an operator enables PITR. |
| **Canonical enable-PITR command** | The `.conf` initdb seed was silently ignored (official postgres image ignores `.conf` in `/docker-entrypoint-initdb.d/`), and the drills configured PITR via a private `ALTER SYSTEM` path that operators never use. | Created `scripts/backup/postgres-enable-pitr.sh` — the SINGLE operator command. It uses `ALTER SYSTEM` (persists into `postgresql.auto.conf`, survives down/up), sets an idempotent `archive_command`, restrictive `/wal-archive` permissions (never `chmod 777`), and polls `pg_stat_archiver` for REAL archiver evidence (not a fixed sleep). The C3 drills now use this SAME canonical path (product path == test path). |
| **Idempotent `archive_command`** | The old `test ! -f target && cp source target` would fail forever on an identical retry (target exists → non-zero). | Replaced with `test ! -f /wal-archive/%f && cp %p /wal-archive/%f \|\| cmp -s %p /wal-archive/%f` — correct for all three cases (absent→copy, identical retry→cmp OK, byte collision→failure). A dedicated drill (`p7-c3-archive-idempotency-drill.sh`) proves it. |
| **Launchpad token wiring** | `LAUNCHPAD_SETUP_TOKEN` was documented as "set in `.env`" but never forwarded to the app container (Compose uses `.env` for interpolation only); the browser first-install UX was inert. | Added `LAUNCHPAD_SETUP_TOKEN: ${LAUNCHPAD_SETUP_TOKEN:-}` to the `app` service `environment:` block (verified by the topology guard). Added it to `.env.example`. A bare `docker compose up` still starts normally (empty default disables launchpad, not fail-fast). |
| **`pg_basebackup` auth truth** | The script claimed "no replication password needed" while connecting over loopback TCP (`-h 127.0.0.1`), which the official image authenticates with `scram-sha-256` (trust is Unix-socket only). | The script now derives the actual deployment's `POSTGRES_USER`/`POSTGRES_PASSWORD` from the running db container and passes the password via `PGPASSWORD` (never argv). The comment and implementation agree: loopback TCP + scram-sha-256 + deployment password. `PGUSER`/`PGPASSWORD` follow the deployment, not a hardcoded `exam`. |
| **Replication privilege honesty** | Implied a narrowly scoped replication role existed. | Documented that the bundled path uses the bootstrap superuser (which satisfies `pg_basebackup`'s SUPERUSER/REPLICATION requirement); a dedicated replication-only role is future hardening, not claimed. |
| **Cold backup running-source refusal** | The cold-backup script only printed "make sure PostgreSQL is stopped" and copied anyway. | `cold-filesystem-backup.sh` now refuses an obviously running source (a Compose db container running OR a live `postmaster.pid` in the actual PGDATA) before copying. |
| **Logical-restore overclaim** | The C2 restore docs claimed "byte-for-byte exact" / "EXACT match". | Reworded to "clean logical reconstruction of the dumped state" — a logical dump reconstructs logical schema/data, not physical byte identity. |
| **PITR retention rule** | Stated "retain only the most recent base backup plus WAL" — incorrect (a base backup can only recover forward from its own history). | Corrected: for an earliest recovery point `T`, retain a base backup whose history precedes `T` + all WAL from it through the window. P7-C3 ships no automatic pruning. |
| **PITR base-backup ordering** | Not stated that WAL archiving must be active before the base backup. | Documented the sequence: enable WAL archiving → verify archiver → `pg_basebackup` → continue archiving → PITR can target later history. |
| **WAL-G / pgBackRest boundary** | Not stated. | Added an explicit future boundary: if Exam later needs off-host WAL shipping / S3 / encryption / compression / incremental physical backups / automated retention, evaluate WAL-G or pgBackRest rather than growing bespoke scripts. |
| **Bootstrap concurrency serialization** | First-install "exactly one winner" relied on RR-isolation + ON CONFLICT retry semantics alone. | Added a transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock`) at the start of `bootstrapAdminOnFreshDb`, shared by HTTP Launchpad and the CLI, making the serialization domain explicit. |

### Drills rerun on the corrective head

The deterministic Docker drills were re-run on the corrective head. The C3
drills now exercise the SAME canonical `postgres-enable-pitr.sh` path
operators use (product path == test path):

| Drill | Result |
| --- | --- |
| `p7-c1-persistence-smoke.sh` | PASS (unchanged code path) |
| `p7-c1-cold-backup-restore-drill.sh` | PASS (cold-backup now also refuses a running source) |
| `p7-c2-logical-restore-drill.sh` | PASS (A present, B absent) |
| `p7-c3-pitr-drill.sh` | PASS (uses canonical `postgres-enable-pitr.sh`; A+B present, C absent) |
| `p7-c3-pitr-failure-drill.sh` | PASS (F1 missing WAL, F2 corrupt backup, F3 invalid LSN — all loud) |
| `p7-c3-archive-idempotency-drill.sh` (NEW) | PASS (absent→copy, identical retry→OK, collision→failure) |
| `p7-c1-launchpad-compose-drill.sh` (NEW) | PASS (12 checks: fresh status uninitialized; wrong token 403; correct token → first Admin; correct token again → 409 (never reopens, no token oracle); Admin login; DB invariants 1/0/1/1; register disabled API + no client route; unset token → launchpad disabled) |

Static gates on the corrective head:

| Gate | Result |
| --- | --- |
| `pnpm verify:static` | PASS (incl. the one-compose repository guard + LAUNCHPAD_SETUP_TOKEN wiring check) |
| `pnpm test` | PASS (2019 tests, 7 skipped) |
| `pnpm build` | PASS (9 tasks) |

---

## 17. Verdict

P7-C PORTABLE PERSISTENCE / BACKUP / POSTGRESQL RECOVERY READY FOR HUMAN REVIEW
