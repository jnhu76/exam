# P7-E — Operational Control Plane Closeout

**Status:** FUNCTIONALLY COMPLETE — READY FOR HUMAN REVIEW
**Program:** P7-E — Operational Control Plane
**Date:** 2026-08-12
**Branch:** `feat/p7-e-operational-control-plane`
**Baseline (`origin/master`):** `a50643f5c22dad912dd876819a9a781b617ef07e` (PR #281 merged; working tree clean)
**Final branch SHA:** `6b2a4207113f9ad8b64b5f9c53b7b77173cd11ef`
**Working tree:** clean

Commits (atomic, reviewable):

```text
d04568f8 feat(p7-e2a): materialize maintainer authority boundary
88c39e88 feat(p7-e2b): add durable backup evidence ledger
ff7b72d0 feat(p7-e2c): add admin and maintainer operations views
30766b72 feat(p7-e3): add operational policy intent and compliance status
6b2a4207 fix(p7-e): close configuration audit residue
```

Authority documents: ADR-017 (ACCEPTED, rev 3, PR #281) > P7-E0/P7-E1
audits > implemented code reality > old roadmap planning prose.

---

## 1. Delivered

### 1.1 E2A — Operational RBAC Boundary

- **Maintainer** is the seventh built-in assignable human role (ADR-017 D2
  amendment of ADR-010): `Role` union, `ROLE_PRESETS`, contracts
  `AssignableRoleSchema`, DB `ASSIGNABLE_ROLES` + CHECK constraint
  (migration 0030), assignment-authority mirror, legacy role map, domain
  `Role` enum, login gate, user-list filter, frontend role labels +
  UsersPage.
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
  commits.
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
  `restore_drill_runs` (drill evidence with source). Migration 0031.
- **SUCCESS semantics (D10 #1)**: `succeeded` requires artifact produced +
  readable + verification passed + durable commit. DB CHECK forbids a
  `succeeded` row without `verificationStatus = 'verified'`.
- **Duplicate-run invariant (D10 #2)**: partial unique index = at most one
  SUCCESS per (org, operation_id); a contradictory re-completion is
  recorded `failed` (`duplicate_operation_conflict`); identical artifact is
  an idempotent no-op; concurrent completion races produce at most one
  success.
- **Crash semantics (D10 #3)**: stale `running` attempts close as
  `abandoned` on the next start of the same logical run; a run that never
  verifies never claims success; start-loss completion still records
  verified evidence.
- **Operator evidence CLI** (`backup-evidence.js`): `start` / `complete` /
  `fail` / `drill` / `cold-import` subcommands; connects via the canonical
  DATABASE_URL; never stores secrets or host paths (artifact label only).
- **Script instrumentation**: `postgres-logical-backup.sh` and
  `pg-basebackup.sh` record start/verified-complete/fail at natural
  checkpoints (completion is a hard gate — a verified artifact whose
  evidence cannot be recorded fails loudly); `cold-filesystem-backup.sh`
  spools typed evidence (PostgreSQL is stopped mid-copy) for `cold-import`
  after restart — the spool is a transit file, not a second authority
  store; `postgres-logical-restore.sh` prints the drill-recording command
  (app is stopped during restore). P7-C mechanisms remain canonical —
  nothing was rewritten.
- **Read API**: `GET /system/backups` + `GET /system/restore-readiness`
  (`system.backup.view`, `system.restore_readiness.view`; Admin +
  Maintainer). Read-only — no trigger/schedule/retention surface (D5).

### 1.3 E2C — Admin / Maintainer Operations Views

- **`/admin/operations` (OperationsPage)**: overall health, backup posture
  (latest / latest VERIFIED / last failure / status counts), restore
  readiness (drill evidence with automated vs operator-declared source),
  operational diagnostics projection. Truthful states: `NO EVIDENCE` (empty
  ledger), `NOT VERIFIED` (runs but none verified), warning banner when the
  last failure is newer than the last verified backup (or no verified
  backup exists), healthy only when a verified backup exists.
- **Navigation**: new Operations nav group (Admin + Maintainer); management
  items individually capability-gated (P3-3 closure — no dead nav);
  Maintainer sees ONLY the Operations group; direct business routes render
  the 403 page and the backend 403s.
- **No-secret rendering**: artifact labels only; never host paths,
  credentials, or URI-bearing strings (E2E asserts this).
- **E2E** (`apps/e2e/e2e/operations.spec.ts`, both shards): Admin business
  UI + operations summary; Maintainer landing/no-business-nav/direct-route
  denial; Maintainer diagnostics never contain integrity; NO EVIDENCE /
  NOT VERIFIED / warning / healthy backup states recorded through the real
  operator CLI against the per-shard DB; secret-free rendering.

### 1.4 E3 — Operational Policy Intent

- **Typed domain policy** (NOT generic settings): `backup_operational_policy`
  — desired RPO (5 min..7 d), retention objective (1..3650 d), drill
  cadence (1..365 d), safe-range CHECKs, version (CAS), required reason,
  actor columns. Migration 0032. Absence = NOT_CONFIGURED.
- **Admin is the sole intent owner (D9)**: `system.ops.policy.manage`
  (Admin only) — typed, audited (`ops.policy.updated`, atomic), CAS
  (409 `OPS_POLICY_VERSION_CONFLICT`). Maintainer: `system.ops.policy.view`
  read-only; PUT → 403.
- **DESIRED vs OBSERVED vs STATUS**: RPO (from last verified backup age →
  SATISFIED / NOT_SATISFIED / UNKNOWN / NOT_CONFIGURED), retention
  (truthfully NOT_ENFORCED — host-managed, never a lie), drill cadence
  (proven drill age vs cadence, source shown).
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
  promotion (PATCH /role-assignments/:assignmentId isPrimary), role
  replacement (PATCH /users/:id via the effective-Admin seam), seed +
  demo-seed post-conditions, and the exclusion post-condition on the
  effective-Admin seam itself.
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
| Idempotency | operationId = `<type>:<date>` (override via `EVIDENCE_OPERATION_ID`); identical re-completion no-op; contradictory duplicate → `duplicate_operation_conflict` (fail closed) |
| Evidence failure | CLI exits non-zero; script completion is a hard gate; cold spool import rejected on conflict |
| Restore drill | `restore_drill_runs` with `source` automated vs operator_declared; declared success never rendered as automated proof |
| Secrets | ledger stores artifact LABEL only; no credentials, no host paths, no URI (API + E2E assert absence) |

## 5. Operations UX

- Admin view: business dashboard (business aggregates) + Operations summary
  (health/backup posture/restore readiness) + System Diagnostics (full,
  incl. business-integrity) + policy intent editor.
- Maintainer view: Operations detail only — no business nav, no integrity
  data, no policy edit; direct business URLs → 403.
- E2E evidence: `operations.spec.ts` (5 flows, both shards) — including
  truthful NO EVIDENCE / NOT VERIFIED / warning / healthy states and
  secret-free rendering.

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
  structural).
- **Host trust boundary**: unchanged (host authority does not imply an
  application Maintainer identity; each plane granted separately) —
  ADR-017 D12.

## 10. Verification (actually run)

```text
pnpm typecheck                                    PASS
pnpm lint:eslint                                  PASS (0 errors)
pnpm lint (copy/arch/ui guards)                   PASS (pre-commit)
pnpm lint:env-contract                            PASS
pnpm --filter @exam/api vitest run                PASS: 160 files, 2141 tests (7 skipped)
pnpm --filter web vitest run                      PASS: 116 files, 1624 tests
packages/authz vitest run                         PASS: 10 files, 79 tests
pnpm db:migrate (0030/0031/0032)                  PASS against dev + test DBs
bash scripts/e2e/run-wsl.sh operations            PASS (both shards; includes
                                                  evidence-state + policy E2E)
Evidence CLI smoke (dev DB)                       PASS: start/complete/fail/
                                                  duplicate-conflict/drill
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
- **P3: 3** (accepted, non-blocking)
  - P3-1: `packages/auth` session TTL hardcoded `24h` (deployment knob
    candidate; env-owned change would touch the leaf package boundary).
  - P3-2: `organization_settings.timezone` stored-but-unused remains (display
    concern; removal would be a schema change for zero product gain).
  - P3-3: `system.info.view` capability still has no consumer
    (pre-existing; retained per P4-G-04).

## 12. Remaining blockers

None for functional completion. Human review gate: P7-E closeout requires
the same human acceptance that closed E1 (the branch stays unmerged; the
PR description carries this report).

---

P7-E OPERATIONAL CONTROL PLANE — FUNCTIONALLY COMPLETE — READY FOR HUMAN REVIEW
