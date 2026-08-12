# P7-E — Operational Control Plane Closeout

**Status:** FUNCTIONALLY COMPLETE — READY FOR HUMAN REVIEW (round 2 hardened)
**Program:** P7-E — Operational Control Plane
**Date:** 2026-08-12
**Branch:** `feat/p7-e-operational-control-plane`
**Baseline (`origin/master`):** `a50643f5c22dad912dd876819a9a781b617ef07e` (PR #281 merged; working tree clean)
**Described head:** `4558f1f4` — the round-2-hardened tip: all P1/P2
fixes from the adversarial review on `08d9a719` (real CAS, cold-import
completion truth, failed-drill cadence, drill result/source split, script
hardening, activation seam, hour-slot operation ids) are in this revision;
the metadata-pin commit that follows contains no content changes.
**Working tree:** clean

Commits (atomic, reviewable):

```text
d04568f8 feat(p7-e2a): materialize maintainer authority boundary
88c39e88 feat(p7-e2b): add durable backup evidence ledger
ff7b72d0 feat(p7-e2c): add admin and maintainer operations views
30766b72 feat(p7-e3): add operational policy intent and compliance status
6b2a4207 fix(p7-e): close configuration audit residue
fdff778b docs(p7-e): complete operational control plane closeout
d9131e11 fix(p7-e): use process streams for CLI output, refresh openapi spec
ee3c6de6 fix(p7-e2b): harden evidence ledger constraints and projections
9f4f55dd test(p7-e2b): cover hardened evidence ledger semantics
3416cd25 fix(p7-e2a): fail closed at login on dual-role accounts and pin preset
cc826c3e fix(p7-e2c): gate policy edit by capability and handle save conflicts
71f9b1cc fix(p7-e2c): skip evidence E2E without CLI; harden backup scripts
20d9a893 docs(p7-e): align env examples and runbook with code reality
08d9a719 docs(p7-e): complete review-hardened closeout
be7e7c49 fix(p7-e3): enforce real CAS on ops policy intent and truthful compliance projection
f407b6eb fix(p7-e2b): preserve true backup completion times and split drill result/source
ab884ee4 fix(p7-e2b): harden backup scripts (size fallback, hour-slot operation ids)
c02ecd99 fix(p7-e2a): implement role assignment reactivation through the exclusion seam
4558f1f4 docs(p7-e): record review round 2 and refresh closeout metadata
```

Authority documents: ADR-017 (ACCEPTED, rev 3, PR #281) > P7-E0/P7-E1
audits > implemented code reality > old roadmap planning prose.

---

## 1. Delivered

### 1.1 E2A — Operational RBAC Boundary

- **Maintainer** is the sixth assignable human role / seventh role preset
  (counting the synthetic, non-assignable `System`) — ADR-017 D2 amendment of
  ADR-010: `Role` union, `ROLE_PRESETS`, contracts `AssignableRoleSchema`, DB
  `ASSIGNABLE_ROLES` + CHECK constraint (migration 0030), assignment-authority
  mirror, legacy role map, domain `Role` enum, login gate, user-list filter,
  frontend role labels + UsersPage.
- **Maintainer preset** = `system.health.view`, `system.diagnostics.view`,
  `system.backup.view`, `system.restore_readiness.view`,
  `system.ops.policy.view` — and NOTHING else. Zero business permissions,
  zero side-effect capabilities (no `system.email.test`), zero
  decision-gated or permanently-forbidden capability. Enforced by a
  preset-boundary test that walks the entire catalog.
- **Admin ↔ Maintainer mutual exclusion (D14)** — server-side invariant:
  canonical `mutateWithAuthorityInvariants` seam (org advisory lock +
  transaction post-condition) wired into user creation, assignment create,
  primary promotion, and role replacement; the effective-Admin seam shares
  the same lock family so every authority mutation serializes. Seed +
  demo-seed guards. Write-skew concurrency tests prove at most one side
  commits. Read-side defense-in-depth: login fails closed (401) if a
  hand-edited row set ever holds both active Admin + active Maintainer
  assignments for one account (the union authority would otherwise grant the
  full Admin capability set). The exclusion counts EFFECTIVE combinations
  (active user + active assignments, symmetric with the last-effective-Admin
  check) — a disabled dual-role account can be disabled, and re-enabling is
  itself an authority mutation that the post-condition rejects until one
  assignment is deactivated.
- **`POST /email/test` split (D7)**: new `system.email.test` capability +
  own audit action (`system.email.test`, masked recipient). Admin keeps it;
  Maintainer does not receive it.
- **Diagnostics domain split (D8)**: `GET /system/diagnostics` projects the
  business-integrity block server-side by `system.business_integrity.view`
  (Admin-only). Maintainer receives the operational projection — the field
  is absent, not zeroed.
- **Business dashboard gated Admin-only (E2C)**: `system.business_summary.view`
  — the dashboard returns business aggregates (questions/exams/candidates/
  attempts); Maintainer never receives them through an operational
  capability and lands on `/admin/operations`.
- **Migration contract honored**: Admin visibility unchanged (full
  diagnostics + dashboard retained); Maintainer gets only operational
  reads.

### 1.2 E2B — Backup Evidence Ledger

- **Typed evidence model** (NOT a generic event/settings store): `backup_runs`
  (one row per attempt), `backup_run_events` (append-only transitions),
  `restore_drill_runs` (drill evidence with ORTHOGONAL outcome + provenance:
  `result` = succeeded | failed, `source` = automated | operator_declared).
  Migration 0031.
- **SUCCESS semantics (D10 #1)**: `succeeded` requires artifact produced +
  readable + verification passed + durable commit. DB CHECK forbids a
  `succeeded` row without `verificationStatus = 'verified'` — NULL-safe (a
  NULL verification_status must not satisfy the constraint).
- **Duplicate-run invariant (D10 #2)**: partial unique index = at most one
  SUCCESS per (org, operation_id); a contradictory re-completion is
  recorded `failed` (`duplicate_operation_conflict`) with terminal
  verification state `failed` (never a "failed but verified" row); identical
  artifact is an idempotent no-op; concurrent completion races produce at
  most one success.
- **Crash semantics (D10 #3)**: stale `running` attempts close as
  `abandoned` on the next start of the same logical run; a run that never
  verifies never claims success; start-loss completion still records
  verified evidence.
- **Operator evidence CLI** (`backup-evidence.js`): `start` / `complete` /
  `fail` / `drill` / `cold-import` subcommands; connects via the canonical
  DATABASE_URL; refuses to run under a test APP_MODE (test/ci/e2e — an
  operator recording evidence into a test database would silently miss the
  product ledger) and prints the resolved target database on every command;
  cold-import validates the spool (schema version, non-negative integer
  size, parseable timestamps) and stores the spool's REAL start AND
  completion times — the completion time is the RPO authority, so an old
  backup imported today is never re-stamped as freshly verified (evidence
  ingestion time lives only in createdAt/updatedAt); never stores secrets
  or host paths (artifact label only).
- **Script instrumentation**: `postgres-logical-backup.sh` and
  `pg-basebackup.sh` record start/verified-complete/fail at natural
  checkpoints (completion is a hard gate — a verified artifact whose
  evidence cannot be recorded fails loudly); evidence hooks use
  container-name addressing (`docker exec ${PROJECT}-app-1`) — deliberately
  cwd-independent, unlike `docker compose -p ... exec` which needs a compose
  file in the invoking directory (host cron safety);
  `cold-filesystem-backup.sh` spools typed evidence (PostgreSQL is stopped
  mid-copy) for `cold-import` after restart — the spool is a transit file,
  not a second authority store, and carries the true copy start time;
  `postgres-logical-restore.sh` prints the drill-recording command (app is
  stopped during restore). P7-C mechanisms remain canonical — nothing was
  rewritten.
- **Read API**: `GET /system/backups` + `GET /system/restore-readiness`
  (`system.backup.view`, `system.restore_readiness.view`; Admin +
  Maintainer). Read-only — no trigger/schedule/retention surface (D5).
  Drill projections use unbounded `latestSucceededDrill` lookups — a long
  run of recent failed drills never hides an older automated success — and
  operator-declared evidence can never overwrite an automated record.

### 1.3 E2C — Admin / Maintainer Operations Views

- **`/admin/operations` (OperationsPage)**: overall health, backup posture
  (latest / latest VERIFIED / last failure / status counts), restore
  readiness (drill evidence with automated vs operator-declared source),
  operational diagnostics projection. Truthful states: `NO EVIDENCE` (empty
  ledger), `NOT VERIFIED` (runs but none verified), warning banner when the
  last failure is newer than the last verified backup (or no verified
  backup exists), healthy only when a verified backup exists.
- **Navigation**: new Operations nav group (Admin + Maintainer); management
  items individually capability-gated (P3-3 closure — no dead nav, and the
  management SECTION itself hides when per-item filtering removes every
  item, so a Maintainer never sees an empty "管理" heading);
  Maintainer sees ONLY the Operations group; direct business routes render
  the 403 page and the backend 403s.
- **Policy edit is capability-gated in the UI**: the `policy-edit-button`
  renders only for actors holding `system.ops.policy.manage` (Admin) — a
  Maintainer never reaches the draft form (backend PUT 403 remains the
  authority); on a 409 CAS conflict the page reloads the latest intent and
  closes the draft instead of looping on a stale version.
- **No-secret rendering**: artifact labels only; never host paths,
  credentials, or URI-bearing strings (E2E asserts this).
- **E2E** (`apps/e2e/e2e/operations.spec.ts` — 6 flows; the file runs on one
  of the two shards, Playwright file-level sharding): Admin business UI +
  operations summary; Maintainer landing/no-business-nav/direct-route
  denial; Maintainer diagnostics never contain integrity; NO EVIDENCE /
  NOT VERIFIED / warning / healthy backup states recorded through the real
  operator CLI against the per-shard DB; secret-free rendering. The three
  evidence-state flows skip (not fail) in the Docker e2e container where
  the built CLI is absent.

### 1.4 E3 — Operational Policy Intent

- **Typed domain policy** (NOT generic settings): `backup_operational_policy`
  — desired RPO (5 min..7 d), retention objective (1..3650 d), drill
  cadence (1..365 d), safe-range CHECKs, version (CAS), required reason,
  actor columns. Migration 0032. Absence = NOT_CONFIGURED.
- **Admin is the sole intent owner (D9)**: `system.ops.policy.manage`
  (Admin only) — typed, audited (`ops.policy.updated`, atomic), REAL CAS
  (the version is part of the UPDATE predicate, so two concurrent writers
  can never silently overwrite each other; first-create races map the
  unique-org-index violation to the same conflict; dual-connection
  READ COMMITTED tests prove exactly one winner — 409
  `OPS_POLICY_VERSION_CONFLICT`). Maintainer: `system.ops.policy.view`
  read-only; PUT → 403.
- **DESIRED vs OBSERVED vs STATUS**: RPO (from last verified backup age →
  SATISFIED / NOT_SATISFIED / UNKNOWN / NOT_CONFIGURED — age measured from
  the backup's REAL completion/verification time, never from evidence
  ingestion), retention (truthfully NOT_ENFORCED — host-managed, never a
  lie), drill cadence (only SUCCEEDED drills prove cadence — a failed
  automated OR operator-declared drill never satisfies it; the proven
  drill's source is shown).
- **Intent never binds infrastructure**: the PUT writes three numbers + a
  reason; there is no scheduler, no trigger, no retention engine, no
  cross-authority protocol. Compliance rendering is the only consumer.

---

## 2. Final authority matrix

| Plane | Owner | Capabilities (product) | Execution |
| --- | --- | --- | --- |
| **A. Business authority** | **Admin** | `user.*`, `candidate.*`, `course.*`, `question.*`, `exam.*`, `grading.*`, `score.*`, `incident.*`, `settings.*`, `exam.proctor_assignment.*`, `system.business_summary.view`, `system.business_integrity.view`, `system.email.test` | product |
| **B. Operational control-plane (observation)** | **Admin** (business-owner summary) + **Application Maintainer** (detail) | `system.health.view`, `system.diagnostics.view`, `system.backup.view`, `system.restore_readiness.view`, `system.ops.policy.view` | product, read-only |
| **B. Operational intent** | **Admin only** | `system.ops.policy.manage` (typed, audited, non-binding) | product |
| **B. Decision-gated mutations** | — | `backup.trigger`, `backup.schedule.manage`, `backup.retention.manage`, `service.restart` — **NOT IMPLEMENTED, DEFERRED (NO-GO)**, host-owned (P7-E3-DECISION-GATES.md) | host |
| **C. Infrastructure execution** | **Host Maintainer** | Docker/Compose, PostgreSQL, WAL, filesystem, backup destination, secrets, restore/PITR/PGDATA, migration/rollback/backfill — not product RBAC | host/CLI |
| **System** | synthetic | `system.auto_submit`, `system.heartbeat_scan`, `system.lifecycle_reconcile` — non-login, non-assignable | background |

Invariants verified by tests: Maintainer has zero business authority
(preset-boundary test over the whole catalog); view capabilities never
authorize side effects (email test has its own capability); no
permanently-forbidden capability exists in the catalog (D4 surface-absence
probe).

---

## 3. Mutual exclusion evidence

- **All protected mutation paths** run inside the canonical seam
  (`mutateWithAuthorityInvariants`) or the effective-Admin seam, which
  share the single `authority-invariants` org advisory lock:
  user creation (`routes/user.ts` POST /users), assignment create
  (`roleAssignments.ts` POST /users/:id/role-assignments), primary
  promotion (PATCH /role-assignments/:assignmentId isPrimary), assignment
  activation (PATCH /role-assignments/:assignmentId isActive=true — a
  reactivated Admin/Maintainer assignment must pass the exclusion
  post-condition), role replacement (PATCH /users/:id via the
  effective-Admin seam), seed + demo-seed post-conditions, and the
  exclusion post-condition on the effective-Admin seam itself.
- **Transaction mechanism**: `executeInTransaction` (read committed) +
  `pg_advisory_xact_lock(hashtext('authority-invariants'), hashtext(org))`
  + post-condition query `findAdminMaintainerExclusionViolations`; the
  check and the mutation commit/rollback atomically.
- **Concurrency test evidence** (`adminMaintainerExclusion.test.ts`):
  - T1 adds Admin (primary) ∥ T2 adds Maintainer (primary) for the same
    actor → exactly one commits, zero violations (`serializes concurrent
    Admin + Maintainer assignment races`);
  - mixed-seam race (effective-Admin replace ∥ authority-invariants
    assign) → invariant holds in every ordering;
  - backfill guard: a pre-existing violation (written outside the seam)
    blocks ANY authority mutation until repaired.
- HTTP-level evidence (`operationalBoundary.test.ts`): Admin actor +
  Maintainer assignment → 400 ADMIN_MAINTAINER_EXCLUSION; Maintainer actor
  + Admin assignment → 400; Maintainer provisioned through the approved
  path and listed.

## 4. Backup evidence semantics

| Aspect | Semantics (verified by tests) |
| --- | --- |
| Run model | one `backup_runs` row per attempt; `running → succeeded/failed/abandoned`; events append-only |
| SUCCESS definition | artifact produced ∧ readable ∧ verification passed ∧ durable evidence committed (DB CHECK `backup_runs_success_verified_check`) |
| Verification | `pg_restore_list` (logical), `pg_verifybackup` (physical), `pg_version_presence` (cold); recorded with method + timestamp |
| Crash behavior | start-only → `running` → closed `abandoned` by next start; never success |
| Idempotency | operationId = `<type>:<YYYY-MM-DD>T<HH>` hour slot (override via `EVIDENCE_OPERATION_ID`; sub-hourly schedules MUST pass a per-slot id); identical re-completion no-op; contradictory duplicate → `duplicate_operation_conflict` (fail closed) |
| Evidence failure | CLI exits non-zero; script completion is a hard gate; cold spool import rejected on conflict |
| Restore drill | `restore_drill_runs`: `result` (succeeded/failed) × `source` (automated/operator_declared) orthogonal; declared success never rendered as automated proof; a FAILED drill — automated or declared — never satisfies the drill cadence |
| Secrets | ledger stores artifact LABEL only; no credentials, no host paths, no URI (API + E2E assert absence) |

## 5. Operations UX

- Admin view: business dashboard (business aggregates) + Operations summary
  (health/backup posture/restore readiness) + System Diagnostics (full,
  incl. business-integrity) + policy intent editor.
- Maintainer view: Operations detail only — no business nav, no integrity
  data, no policy edit; direct business URLs → 403.
- E2E evidence: `operations.spec.ts` (6 flows, one shard — see §1.3) —
  including truthful NO EVIDENCE / NOT VERIFIED / warning / healthy states
  and secret-free rendering.

## 6. Policy model

- `backup_operational_policy`: desired RPO / retention / drill cadence;
  safe ranges; CAS version; required reason; actor columns; atomic audit.
- Owner: Admin (`system.ops.policy.manage`); Maintainer read-only.
- Compliance: DESIRED vs OBSERVED vs STATUS (RPO SATISFIED/NOT_SATISFIED/
  UNKNOWN/NOT_CONFIGURED; retention NOT_ENFORCED; drill SATISFIED/
  NOT_SATISFIED/UNKNOWN). Rendered through the StatusBadge authority.
- Intent never binds infrastructure (no schedule/trigger/retention writes;
  compliance rendering is the only consumer).

## 7. Decision-gated operations — verdicts

| Capability | Verdict | Rationale |
| --- | --- | --- |
| `backup.trigger` | **DEFERRED (NO-GO)** | host cron + scripts cover every deployment; no product-only operator profile; first infra-execution surface in the browser is the exact coupling ADR-017 prevents |
| `backup.schedule.manage` | **DEFERRED (NO-GO)** | schedule is a host fact; product scheduler forbidden (P7-E1 §17.3) |
| `backup.retention.manage` | **DEFERRED (NO-GO)** | retention stays manual + host-owned with the fail-closed invariant; cross-authority protocol not designed; evaluate WAL-G/pgBackRest host-side |
| `service.restart` | **DEFERRED (NO-GO)** | most destructive control-plane mutation; no typed non-secret abstraction; no confirmed requirement |

Full record: [`docs/audits/P7-E3-DECISION-GATES.md`](P7-E3-DECISION-GATES.md).
Email worker/runtime settings: keep env + restart-required (no confirmed
online-edit requirement; knobs now documented in `.env.example`).

## 8. P7-E0 findings reconciliation

| Finding | Status | Evidence |
| --- | --- | --- |
| P2-M1 future profile-resolution hazard | **SUPERSEDED** | P7-M2 copy-on-apply design resolves profiles at creation; publish guard intact |
| P2-2 DEADLINE_SCAN_INTERVAL_MS bypass | **FIXED** | resolved via canonical loader (`heartbeat.deadlineScanIntervalMs`); plugin reads config only |
| P2-3 duplicated JWT resolution authority | **ACCEPTED** | `packages/auth` is a leaf package that cannot depend on the API config; independent env resolution is the documented boundary; TTL hardcode unchanged (deferred, non-blocking) |
| P3-1 LOG_LEVEL docs drift | **SUPERSEDED** | variable absent from tree; logger hardcodes `info` (unchanged, out of scope) |
| P3-2 PORT vs APP_PORT | **ACCEPTED** | docs/runbook consistently use `APP_PORT`; no silent `PORT` consumer remains un-documented |
| P3-3 TZ declared but never read | **ACCEPTED** | TZ is a display/log/fixture hint per ADR-006; Node reads TZ implicitly; no business-time dependency |
| P3-4 EMAIL_WORKER_* missing from .env.example | **FIXED** | all worker knobs (incl. SHUTDOWN_TIMEOUT_MS) documented |
| P3-5 DEADLINE_SCAN_INTERVAL_MS / FORCE_APP_MODE missing | **FIXED** | documented in .env.example |
| P3-6 timezone authority ambiguity | **ACCEPTED** | `organization_settings.timezone` stored-but-unused is a display concern; APP_TIMEZONE is the runtime authority; documented |
| P3-7 unused `redisdata` volume | **FIXED** | removed from docker-compose.test.yml |
| P3-8 test-script port defaults 5432 | **FIXED** | defaults now 15432 (dev compose host mapping) |

## 9. Security

- **Compromised Admin**: cannot self-assign Maintainer (mutual exclusion),
  cannot reach restore/PITR/PGDATA/restart/trigger surfaces (404 probes),
  cannot read secrets (404 probes + response-scrub assertions),
  cannot modify WAL/destination (no surface). Blast radius stays business
  (documented — Admin credentials are the deployment's most sensitive
  product secret; Admin must not also hold host access).
- **Compromised Maintainer**: cannot author/publish exams, view candidate
  answers/export attempts, grade, assign roles, manage candidates, resolve
  incidents, force-submit/time-grant/misconduct, or modify policy intent
  (all 403-probed); receives no business-integrity diagnostics.
- **Assignment race**: write-skew tests prove the invariant survives.
- **Evidence forgery**: unverified runs never become SUCCESS; duplicate
  contradictory completions fail closed; DB CHECK blocks forged success;
  retry/idempotency tested; failure reasons sanitized; artifact paths
  never stored.
- **Browser operations probe**: no restore/PITR/raw-path/shell/secret/
  restart/DB-endpoint/Redis-credential route exists (surface-absence is
  structural). Enforced by `adversarialAudit.test.ts` (compromised Admin /
  Maintainer probes, browser-surface absence, secret-free responses) —
  cited as the security evidence for the probes below.
- **Host trust boundary**: unchanged (host authority does not imply an
  application Maintainer identity; each plane granted separately) —
  ADR-017 D12.

## 10. Verification (actually run)

Round 1 (head `08d9a719`):

```text
pnpm verify (full gate)                              PASS (typecheck, lint,
                                                      static checks, build)
pnpm typecheck                                       PASS
pnpm lint:eslint                                     PASS (0 errors)
pnpm lint (copy/arch/ui guards)                      PASS (pre-commit)
pnpm lint:env-contract                               PASS
pnpm --filter @exam/api vitest run                   PASS: 161 files, 2151 tests (7 skipped)
pnpm --filter web vitest run                         PASS: 116 files, 1627 tests
packages/authz vitest run                            PASS: 10 files, 79 tests
pnpm db:migrate (0030/0031/0032)                     PASS against dev + test DBs
bash scripts/e2e/run-wsl.sh operations               PASS (both shards; includes
                                                      evidence-state + policy E2E)
Evidence CLI smoke (dev DB)                          PASS: start/complete/fail/
                                                      duplicate-conflict/drill
```

Round 2 (this revision — after the P1/P2 fixes):

```text
pnpm verify (full gate)                              PASS (format, lint suite,
                                                      typecheck, openapi check,
                                                      coverage, build)
pnpm --filter @exam/api vitest run                   PASS: 161 files, 2161 tests (7 skipped)
                                                      — includes NEW dual-connection
                                                      READ COMMITTED CAS races,
                                                      cold-import RPO truthfulness,
                                                      failed-drill cadence, and
                                                      activation seam tests
pnpm --filter web vitest run                         PASS: 116 files, 1627 tests
packages/authz vitest run                            PASS: 10 files, 79 tests
Migration 0031 CHECK tightened in place (unmerged)   dev DB constraint aligned
                                                      manually (non-destructive)
Evidence CLI cold-import smoke (dev DB)              PASS: spool start/completion
                                                      times recorded truthfully
                                                      (verified_at = completion,
                                                      created_at = import time);
                                                      smoke row removed after
```

Suites named in the closeout gate that were run as part of the above:
authz tests, role-assignment tests, concurrency tests, API tests, web
tests, E2E, route-registry conformance, shadow parity, permission
matrices, audit architecture, time-authority structural, openapi
structural, whole-app route regression lock. Deployment backup/restore
drills (`tests/deployment/*`) are Docker-host drills unchanged by P7-E
(the scripts they invoke gained optional evidence hooks; the drills'
pass/fail contract is untouched) — a full deployment regression run is
recommended in human review alongside `pnpm verify:static`.

## 11. Findings

- **P0: 0**
- **P1: 0**
- **P2: 0** (all E0/E1 P2 items are FIXED or SUPERSEDED above; P2-3
  accepted with rationale)
- **P3: 3** (accepted, non-blocking; numbered R1–R3 to avoid collision with
  the §8 P3-N reconciliation table)
  - R1: `packages/auth` session TTL hardcoded `24h` (deployment knob
    candidate; env-owned change would touch the leaf package boundary).
  - R2: `organization_settings.timezone` stored-but-unused remains (display
    concern; removal would be a schema change for zero product gain).
  - R3: `system.info.view` capability still has no consumer
    (pre-existing; retained per P4-G-04).

## 12. Remaining blockers

None for functional completion. Human review gate: P7-E closeout requires
the same human acceptance that closed E1 (the branch stays unmerged; the
PR description carries this report).

## 13. Independent review reconciliation (subagent + CodeRabbit)

Before the human gate, the branch was reviewed by four read-only review
subagents (five-axis methodology) and by CodeRabbit on PR #282 (17 inline
comments). Disposition:

| Finding | Verdict | Resolution |
| --- | --- | --- |
| Concurrency test asserted an order-dependent winner | **FIXED** | assertion now accepts either legal winner (exactly one authority role survives) |
| `adversarialAudit` diagnostics assertion could pass on a 403 body | **FIXED** | `statusCode 200` asserted before body shape |
| Maintainer backup projection test asserted a non-existent `body.latest` | **FIXED** | asserts `latestVerified` + concrete artifact label |
| Drill projections derived from a bounded 20-row page | **FIXED** | dedicated unbounded `latestSucceededDrill` repo lookups at both projection sites |
| CLI `parseArgs` could consume a flag as a value; falsy check | **FIXED** | rejects `undefined` and values starting with `--` |
| `cold-import` printed a start time the ledger did not store | **FIXED** | `completeRun` accepts `startedAt`; the spool's real start is stored |
| Duplicate-conflict row stored `verificationStatus=verified` on a failed row | **FIXED** | terminal `failed` / `verifiedAt null` (never "failed but verified") |
| `lastFailure` / `latestSucceededRun` DESC on nullable columns | **FIXED** | explicit `NULLS LAST` |
| `recordDrill` upsert could overwrite automated evidence with an operator declaration | **FIXED** | `setWhere` preserves automated rows; empty-return handled; test added |
| `upsertPolicyWithinTransaction` violated ctx-first repo convention | **FIXED** | reordered `(ctx, tx, params)` |
| Cold spool `du \| cut \|\| echo 0` produced invalid JSON on du failure; start time captured after copy | **FIXED** | size computed then defaulted; true start captured before the copy |
| `drop/list-test-schemas.sh` trusted arbitrary DB URLs | **FIXED** | `current_database()` guard: refuse anything but `exam_test` / `exam_test_w*` |
| Sidebar rendered an empty "管理" section for Maintainer | **FIXED** | section hidden when per-item filtering removes every item |
| `latestVerified.verifiedAt!` could render an epoch date | **FIXED** | null-guarded (never a fabricated verification date) |
| Policy edit button un-gated (Maintainer reached a dead draft form) | **FIXED** | capability-gated by `system.ops.policy.manage`; Maintainer-absence test added |
| Schema barrel omitted the four new evidence tables | **FIXED** | barrel now exports all four |
| DB CHECK NULL-bypass (forged `succeeded` with NULL verification) | **FIXED** | NULL-safe CHECK + NULL-case test (migration + snapshot updated) |
| Evidence-state E2E tests would FAIL (not skip) in Docker e2e | **FIXED** | `test.skip` inside each of the three flows |
| OperationsPage dead code / stale closure / untested PUT path | **FIXED** | dead helpers removed, functional setState, `put` mock + save/409 tests |
| `.env.example` EMAIL_WORKER_* values contradicted code defaults (and could trip the SMTP lease sanity guard) | **FIXED** | aligned to code defaults (300000/60000/30000) |
| Runbook claimed `down -v` removes a `redisdata` volume that no longer exists | **FIXED** | corrected to pgdata-only + bind-mount note |
| Closeout SHA/commit list stale; `adversarialAudit.test.ts` uncited | **FIXED** | this revision (SHA amended at push) |
| E2A: no read-side login guard; exclusion asymmetric on `users.isActive`; preset not exact-pinned; load-bearing `read committed` undocumented | **FIXED** | login fails closed on dual-role sets; exclusion counts effective combinations (re-enable is seam-guarded); preset pinned to the exact 5-capability set; isolation rationale documented at both seams |
| "Remove the Maintainer product role from Phase 1.x" (CodeRabbit ×2) | **REJECTED** | contradicts the mission instruction and ADR-017, which the human ACCEPTED in PR #281 after review; Maintainer is an OPERATIONAL observation role with zero business permissions — not a business role bundle like Teacher/Proctor/Grader — and is the core of this workstream (E2A). The Phase 1.x single-tenant rule targets business roles and tenant modes (SuperAdmin, org-slug login, tenant switcher), none of which are exposed. Rejection rationale posted on PR #282. |

### Adversarial review round 2 (head `08d9a719` → this revision)

A second full review of PR #282 (ADR-017 + the P7-E mission) surfaced three
P1 correctness issues — all of the same class: **the system could render
green / SATISFIED while the real world did not satisfy the requirement**
(evidence truthfulness). All were fixed in this revision:

| Finding | Class | Resolution |
| --- | --- | --- |
| `ops policy` CAS was not a CAS (version checked in a pre-read only; the UPDATE carried no version predicate) → two concurrent writers both pass and the first write is silently overwritten (lost update) | **P1** | UPDATE now carries `WHERE id = ? AND version = expectedVersion`; zero returned rows → `OPS_POLICY_VERSION_CONFLICT`; first-create races map the unique-org-index violation (23505, walked through Drizzle's error `cause` chain) to the same conflict; dual-connection READ COMMITTED concurrency tests prove exactly one winner for both the update race and the first-create race |
| Cold backup spool `completedAt` was parsed but never used: `cold-import` stamped `verifiedAt = now` → a backup taken 40h ago, imported today, rendered as freshly verified (RPO false green) | **P1** | `completeRun` accepts the true `completedAt`; `cold-import` records `completedAt = verifiedAt = spool.completedAt` (startedAt from the spool, ingestion time only in createdAt/updatedAt); repo + API tests prove "old cold backup + imported now + desired RPO 1h → NOT_SATISFIED" |
| A FAILED operator-declared drill could satisfy the drill cadence (the `latestDeclared` fallback filtered only by source, not by result) | **P1** | the `latestDeclared` fallback is gone: only SUCCEEDED drills (automated first, declared accepted with source shown) prove cadence; failed drills surface via restore-readiness as the latest drill, never as proof; projection tests cover failed-today + old-success cases |
| `RestoreDrillResult` conflated outcome and provenance (`"succeeded" \| "failed" \| "operator_declared"`) | **P2** | orthogonal model: `result` = succeeded \| failed, `source` = automated \| operator_declared; DB CHECK, contracts, CLI, and tests updated (migration 0031 edited in place — unmerged; dev DB constraint aligned manually) |
| `pg-basebackup.sh` size fallback bound to `cut` (`du \| cut \|\| echo 0`) → empty `--size-bytes` on du failure could fail a REAL verified backup | **P2** | fallback computed then defaulted (`size_bytes="${size_bytes:-0}"`) — matches the cold script |
| assignment PATCH contract promised `isActive: true` (activate) but the route 404'd | **P2** | `activate` implemented through the Admin↔Maintainer exclusion seam (`mutateWithAuthorityInvariants`): reactivating a deactivated primary restores it as the active primary (users.role re-synced); reactivating a Maintainer assignment for an actor with active Admin is rejected; route + seam tests added; audit metadata schema extended (`assignmentActivated`) |
| Default operationId `logical:YYYY-MM-DD` (one logical run per day) contradicts sub-24h desired RPO (hourly backups would collide on the one-success invariant) | **P2** | default is now the HOUR slot `<type>:<YYYY-MM-DD>T<HH>` in all three backup scripts; runbook documents the mandatory contract: sub-hourly schedules MUST pass an explicit per-slot `EVIDENCE_OPERATION_ID` |
| PR body / closeout metadata stale (final SHA `d9131e11`, "6 atomic commits", "Draft") | **P2** | this revision (PR body rewritten after all fixes; closeout head/commits amended at push) |

No Critical findings from either review remained open; all accepted
findings are fixed and covered by tests in this revision.

---

P7-E OPERATIONAL CONTROL PLANE — FUNCTIONALLY COMPLETE — READY FOR HUMAN REVIEW
