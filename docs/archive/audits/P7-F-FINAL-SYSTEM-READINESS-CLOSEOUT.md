# P7-F Final System Readiness Closeout

> **Superseded (2026-08-14):** this document's verdict — "P7-F COMPLETE —
> P7 REMAINS OPEN", Gate P7-3 `NOT PASS — HUMAN_DECISION_REQUIRED`, and the
> pending ADR-017 rev4 / ADR-018 / #286 items — was true on 2026-08-13 and is
> **historical evidence**. The final authority is
> [`P7-FINAL-PROGRAM-CLOSEOUT.md`](P7-FINAL-PROGRAM-CLOSEOUT.md): P7 is
> CLOSED, Gate P7-3 is PASS under the revised software / deployment-site
> acceptance semantics, ADR-017 rev 4 + ADR-018 are ACCEPTED, and #286 is
> reopened as the Teacher@Course tracker.
>
> **P7-F = Final System Readiness / Release-Gate Closeout.** This is the
> evidence-driven closeout of the P7 program against release gates P7-0…P7-6.
> It is an **audit + bounded-repair job**, not a feature acquisition phase.
> "A smaller truthful product is better than a falsely complete one."

## Baseline

```text
BASE_SHA   : 713dc4ad89452097631e9aff2710f314631e041f  (origin/master, PR #284 merged)
branch     : feat/p7-f-final-system-readiness-closeout
START_DATE : 2026-08-13
WORKTREE   : clean at start
```

P7 work already merged to master before P7-F: PR #265 (Redis shared rate limit,
P7-D2/D3), PR #269 (P7-S2 runtime authority hardening), PR #276 (P7-E0 config
audit), PR #277 (P7-M1 policy authority), PR #279 (P7-M configurable exam
modes), PR #281 (P7-E1 + ADR-017 rev 3), PR #282 (P7-E operational control
plane), PR #284 (P7-RBAC role-reality remediation). P7-C portable backup/DR
shipped earlier.

## Executive verdict

**P7-F COMPLETE — P7 REMAINS OPEN.**

P7-F itself is complete: every release gate P7-0…P7-6 was audited against
current master, bounded gaps were repaired, the P7-M multimodal visual review
was performed, and the full application verification ran (deployment/restore
evidence was reused from P7-C/P7-E, not re-run in P7-F). **P7 cannot be
declared CLOSED** by this closeout for two truthful reasons on Gate P7-3 plus
recorded human decisions:

1. **Gate P7-3 has TWO unsatisfied bullets** (NOT faked as PASS):
   - **RTO is not declared or tested.** `backup_operational_policy` carries
     `desired_rpo_seconds` / `desired_retention_days` /
     `desired_drill_cadence_days` only — **there is no typed `desired_rto_*`
     authority anywhere in the product code**, no declared supported RTO
     value, and no "clean-volume restore completes within the declared RTO"
     acceptance. Workstream C's own rule ("exact supported values must be
     decided and tested") is therefore unmet for RTO. RPO is declared (as
     Admin-owned intent); RTO is **NOT MET**.
   - **Retention is not operational.** Backup retention/pruning is genuinely
     not automated — it is operator discipline with runbook guidance
     (`backup-and-recovery.md:570,622`; `postgres-enable-pitr.sh:224`), and
     the accepted P7-E3 decision gates record `backup.retention.manage` as
     **NO-GO / host-owned** for the product control plane. The Gate P7-3
     bullet "backup automation and retention are operational" is **not
     literally satisfied**.
   Both are genuine release-gate architecture decisions pending human
   disposition. For retention, the options are: (a) accept permanent
   operator-discipline retention and reconcile the gate wording; (b)
   product-side retention engine (contradicts P7-E3's NO-GO, least aligned);
   or **(c) host-side automated retention — cron/systemd + WAL-G/pgBackRest
   (the P7-E3-recorded recommendation), with Exam observing evidence/status
   only**. Option (c) is the architecture-aligned way to make Gate P7-3's
   retention bullet actually hold without giving the browser or Maintainer
   any execution authority. P7-F did not smuggle in a retention engine.
2. **ADR-017 revision 4 and ADR-018 remain PROPOSED** (human acceptance pending).
   The runtime *already implements* the rev-4 read-only-observer model, but the
   ADR documents are not silently marked ACCEPTED — that requires an explicit
   human decision under this repo's ADR process.
3. **Issue #286 (Teacher@Course, F-04) was closed by the human on 2026-08-13
   without implementation and without a comment.** P7-F neither claims Teacher
   course isolation nor redefines Teacher as permanently org-scoped; the runtime
   remains org-wide (pinned by `teacherScopeCharacterization.test.ts`). The
   closure needs human clarification (accept org-wide / reopen / re-track).

Truthful NOT READY is a valid result. P7-F is COMPLETE; P7 remains OPEN on the
items above. None of the three is fixable by silently writing code or editing
gate wording — each is a recorded human decision.

## Gate matrix

| Gate | Verdict | One-line reality |
| --- | --- | --- |
| P7-0 | **PASS** (after bounded doc reconciliation in this PR) | Doc drift repaired; current-state docs now tell one story — incl. a Current-status overlay + per-workstream status rows added to the canonical `docs/archive/roadmap/P7-system-readiness-and-exam-modes.md`. |
| P7-1 | **PASS** | P7-S2 guarantees intact on master; no new reachable partial state; no general reconciler needed (evidence-based). |
| P7-2 | **PASS** | Redis = shared rate limit only (ADR-001 decision); lifecycle `off\|optional\|required`; no exam authority. |
| P7-3 | **NOT PASS — HUMAN_DECISION_REQUIRED** (two bullets not met: **RTO** + **retention**; the rest — evidence ledger, verified drills, RPO intent — pass) | RTO: no declared supported value / no typed authority / no restore-within-RTO acceptance. Retention: host-owned/`NOT_ENFORCED`. Neither is faked. |
| P7-4 | **PASS** | Typed owners; no generic settings store; secrets env-only; active Exam/Attempt snapshot-frozen. |
| P7-5 | **PASS** (mediated visual review; minor P3 polish) | `basic_quiz`/`standard_online` coherent; profile↔exam authority intact; no blocking visual defect. |
| P7-6 | **PASS** (representative closeout) | Admin/Maintainer/Candidate surfaces usable; mobile measured no page-level overflow; UI debt reduction ongoing. |

### Gate P7-0 — Truthful plan

Requirement: current/phase/status/open-items docs agree; completed work not
listed as future; deferred work not listed as implemented; P7-F naming
unambiguous; Phase 3 open work remains open.

Reality found (drift, all repaired in this PR):

- `docs/roadmap/current.md` status-snapshot row still said "P7-RBAC … READY FOR
  HUMAN REVIEW" after PR #284 merged; and the "Proposed execution order" block
  still listed "Future P7-E2 … not started" although P7-E2A/E2B/E2C/E3 shipped
  via PR #282 — contradicting the same file's status row.
- `docs/roadmap/phase-roadmap.md` P7 status row (line ~247) and Status block
  (lines ~296-306) were frozen at the 2026-08-08 state ("workstreams open"),
  ignoring P7-S2/#269, P7-C, P7-E, P7-M, #284.
- `docs/archive/roadmap/phase3-open-items.md` module-order + intro (lines ~24-38) had
  the same stale P7 status; and its F-04/Teacher@Course section (lines ~86-102)
  framed #286 as a *pending durable tracker* — stale vs the 2026-08-13
  closure-without-implementation.

Repair: current-state docs reconciled to the post-#284 reality (P7-D/S2/C/E/M
shipped; P7-RBAC remediation merged; ADR-017 rev4 + ADR-018 PROPOSED; #286
closed-without-implementation flagged). Phase 3 open product work (invitation,
SMTP reset, account lifecycle, scoped role bundles as product roles, WYSIWYG,
ADR-008 Option D barrier) remains explicitly open. P7-F naming is
unambiguous (≠ old Workstream F = exam profiles, which shipped via P7-M).

Verdict: **PASS**.

### Gate P7-1 — Recoverable authority

Requirement: state/authority map matches runtime; canonical commands own
irreversible transitions; startup reconciliation; process-crash idempotent
completion.

Evidence revalidated (P7-S2 closeout, files verified present on master):

- `publishResults` single-winner (FOR UPDATE re-check) — `publishResults.concurrency.test.ts` (RC + RR).
- `FUTURE_VERSION` rejection — `answerProtocol.test.ts` (+ wire test).
- Crash atomicity (6 flows, all ATOMIC_ROLLBACK) — `crashAtomicity.test.ts`.
- Email at-least-once + lease sanity guard; worker-liveness observability.
- Receipt-backed replay (force-submit, misconduct, incident operationId, proctor assignment, deadline scanner FOR UPDATE + 40001 retry).
- Read-only integrity diagnostics — `system.test.ts` (exact SQL totals + bounded sample).

Regression scan (this closeout): `isAdmin()` survives only as a documented
non-authoritative shell helper; `requireRole`/`requirePermission` have **0
production consumers**; `role ===` hits are test assertions / bootstrap script /
JWT-role projection sync / post-gate data filters — no authority decisions.

**Reconciliation of the "startup reconciliation" bullet (evidence-based, not
word-literal):** P7-S2 §8 concluded **NO GENERAL STARTUP RECONCILER** because
every cross-domain irreversible operation commits in one PostgreSQL transaction,
so no committed incomplete state is reachable from current supported runtime
behavior; receipt-backed commands replay committed evidence; the email
claim→send window is an external at-least-once boundary, not a DB partial
state; interruption pointers are DB-CHECK-paired. The two legacy-only anomaly
families are detected read-only at `/system/diagnostics`. The correct
release-gate reading is therefore: *every reachable recoverable condition has a
tested recovery/detection path* — not "a framework named StartupReconciler must
exist." `recovery-operations-jobs.md` attributes a broader startup-reconciler to
J7 (NOT STARTED); that doc's framing is stale relative to the S2 negative
conclusion and is reconciled here, not by inventing a reconciler. No new
reachable partial state has appeared since S2.

Verdict: **PASS** (under the evidence-based formulation).

### Gate P7-2 — Redis responsibility

Requirement: Redis decision recorded; approved responsibilities real with
failure semantics; multi-instance shared behavior; no Redis authority over Exam
facts.

Reality: ADR-001 "Post-MVP Decision (P7)" records P7-D1 ACCEPTED (2026-08-08)
for exactly ONE responsibility — the shared/global rate limiter (PR #265,
P7-D2/D3) — with `off | optional | required` lifecycle, password protection,
test-prefix isolation, and fail-open/fail-closed semantics per feature. Code
scan confirms Redis usage = rate limit (`rateLimit.ts`, `rateLimitKey.ts`,
`rateLimitStores.ts`) + diagnostics `PING` (`testRedis.ts`, `system.ts`) + test
isolation infra. Admission queue, presence, sessions, Streams/Pub/Sub, cache,
scanner lease remain decision-gated and are NOT adopted. PostgreSQL remains the
sole authority for attempts/answers/grading/audit/business config.

Verdict: **PASS**.

### Gate P7-3 — Restore is proven (the blocking gate)

Requirement: declared RPO/RTO profile; backup automation + retention
operational; clean-host restore drill; post-restore invariant suite.

Reality per bullet:

- **Declared RPO/RTO profile** — **split reality.**
  - **RPO**: declared *as Admin-owned intent* (`backup_operational_policy.desired_rpo_seconds`, 5min..7d; CAS version, audited; ADR-017 D9 reframe = reliability objective, never binds infrastructure). ✓ (as intent)
  - **RTO**: ❌ **NOT MET.** There is **no `desired_rto_*` column** in `backup_operational_policy` (only `desired_rpo_seconds` / `desired_retention_days` / `desired_drill_cadence_days` — verified against `packages/db/src/schema/pg.ts`), no declared supported RTO value anywhere in product code, and no "clean-volume restore completes within the declared RTO" acceptance. Workstream C's own rule — "Exact supported values must be decided and tested" — is unmet for RTO. The P7-C "Recovery objectives" table (RPO 24h/1h/minutes × RTO 4h/1h/<30m) is explicitly a *planning frame, not a current guarantee*.
- **Backup automation** — backup *commands* are operational: `scripts/backup/` (logical/physical/cold backup + restore + PITR enable) instrumented with the E2B evidence CLI at natural checkpoints; scheduling is host cron + scripts (operator-owned). ✓ (host-operational)
- **Clean-host restore drill** — deterministic Docker drills under `tests/deployment/` (`persistence-and-cold-restore.sh`, `logical-backup-restore.sh`, `pitr.sh`, `compose-smoke.sh`, `launchpad-bootstrap.sh`); `restore_drill_runs` evidence (automated vs operator-declared; succeeded/failed orthogonal). ✓
- **Post-restore invariants** — drills verify attempts/answers/snapshots/grading/Inbox/outbox/role-assignments/settings. ✓
- **Backup evidence ledger** — `backup_runs`/`backup_run_events` with `backup_runs_success_verified_check` (artifact + readable + verification + durable commit); duplicate/crash/idempotency semantics tested (E2B). ✓
- **Retention** — ❌ **NOT operational.** `postgres-enable-pitr.sh:224` ("No automatic retention is shipped"); `backup-and-recovery.md:570,622` ("No retention engine… no retention automation today; retention is the operator's responsibility"); P7-C closeout §164 ("Retention is manual"). P7-E3 decision gates record `backup.retention.manage` as **DEFERRED (NO-GO)** for the product control plane — host-owned. The product truthfully renders retention `NOT_ENFORCED`.

The invariants behind these two bullets (a declared, tested RTO; backups not
accumulating unboundedly) are **not guaranteed by the system** — RTO has no
typed declaration at all, and retention depends entirely on the host operator.
This is a genuine gap, not a supersession that preserves the invariants.

Verdict: **NOT PASS — HUMAN_DECISION_REQUIRED** (two bullets not met: **RTO**
and **retention**; the gate can only become PASS via explicit human
dispositions). These are the reasons P7 cannot be CLOSED. Options:

- **RTO**: declare a supported RTO value + typed authority + a restore-within-
  RTO acceptance (new work), or explicitly narrow the gate to RPO-only and
  record RTO as deferred.
- **Retention**: (a) accept permanent operator-discipline retention and
  reconcile the gate wording; (b) product-side retention engine (least
  aligned — P7-E3 records `backup.retention.manage` as NO-GO for the product
  control plane); **(c) host-side automated retention — cron/systemd +
  WAL-G/pgBackRest (the P7-E3-recorded recommendation), with Exam observing
  evidence/status only** — the architecture-aligned way to make the bullet
  hold without giving the browser or Maintainer execution authority.

P7-F did not fake PASS and did not build a retention engine or an RTO field to
make the checkboxes green.

### Gate P7-4 — Configuration is controlled

Requirement: business settings DB-backed/versioned/audited/rollbackable;
secrets protected; active Exam/Attempt snapshot-frozen; Admin can inspect
effective config + source.

Reality (current accepted typed-owner model, P7-E0/E1/E + ADR-017):

- **No generic settings subsystem.** Scan confirms no `system_settings` KV, no generic JSON blob, no precedence engine, no feature-flag platform (the only grep hits are comments saying "This is NOT a generic settings store"). P7-E0 verdict honored.
- **Typed owners:** deployment/secrets → Host Operator (env/Compose); organization settings → Admin (`organization_settings`); exam policy → Admin authoring + P7-M profiles (copy-on-apply into typed Exam columns); operational evidence → System (`backup_runs`/`restore_drill_runs`); operational reliability objective → Admin (`backup_operational_policy`, versioned + CAS + audited, non-binding); code invariants → code (no runtime knob).
- **Secrets protected:** `DATABASE_URL`/`POSTGRES_PASSWORD`/`JWT_SECRET`/`REDIS_PASSWORD`/`SMTP_PASSWORD`/TLS — env/Compose only; never in DB/UI/audit/export; UI shows status adjectives only (E2E asserts secret-free responses).
- **Snapshot-frozen:** published Exam is the immutable execution authority (publish revalidates whole policy); attempt policy snapshots immutable post-creation; runtime NEVER loads a profile (`runtimeProfileIndependence.test.ts` + package boundary: `@exam/exam-engine` depends only on `@exam/domain`).
- **Inspectable:** Admin/Maintainer operations views render DESIRED vs OBSERVED vs STATUS truthfully (RPO SATISFIED/NOT_SATISFIED/UNKNOWN/NOT_CONFIGURED; retention NOT_ENFORCED).

The original gate's "versioned/rollbackable" wording is superseded by the
typed-owner architecture (P7-E0 rejected a generic versioned settings platform);
the real invariant — *configuration is controlled by its authority/lifecycle
owner, secrets stay protected, runtime is frozen where required, no hidden
second config authority* — holds.

Verdict: **PASS** (with the typed-owner reconciliation documented above).

### Gate P7-5 — Exam profiles coherent

Requirement: shipped recipes resolve to one policy schema; invalid combinations
fail before publish; profile edits do not mutate published exams; each shipped
recipe has API + representative E2E proof. Controlled/Strict deferred.

Reality (P7-M1/M2/M closeout, revalidated):

- One canonical validator (`validateExamPolicy`/`assertExamPolicyValid`) — the only cross-field semantic authority; create + publish share it; publish revalidates the whole policy.
- Copy-on-apply: profile values materialize into typed `exams` columns; no Exam→profile FK; profile edit/delete never affects an existing Exam (structural + integration tests).
- Runtime profile-independence: `runtimeProfileIndependence.test.ts` green; `@exam/exam-engine` cannot reach `exam_policy_profiles`.
- Shipped recipes `basic_quiz` (single attempt, immediate publish, strict) and `standard_online` (retake, highest, after-grading, bounded grace) — each promises only what the runtime enforces; truthfulness guard test asserts `basic_quiz` = `max_attempts` + 1.
- API + browser E2E: `exam-profile-product.spec.ts`, `exam-wizard-product.spec.ts` (profile CRUD, no-profile + profile-based + explicit-override exam creation, schedule-conflict inline routing).
- Controlled/Strict remain **DEFERRED** to their owning subsystems (queue admission, randomization, device binding, lockdown/IP, identity, continuous monitoring) — not faked.

**P7-M multimodal visual review (performed in this closeout):** a real browser
(project Playwright + installed chromium, headless) drove the dev DB (`exam`)
as Admin across the profile list, profile create/edit, the 5-step exam wizard,
and the exam-detail + operations surfaces at **1440×900, 1024×768, 390×844**.
11 screenshots captured and visually analyzed; horizontal overflow then measured
*deterministically* (`document.documentElement.scrollWidth − window.innerWidth`):

```text
/admin/exam-profiles     @390  OVERFLOW = 0px
/admin/exam-profiles/new @390  OVERFLOW = 0px
/admin/exams/new (wizard)@390  OVERFLOW = 0px   (stepper flex-wraps correctly)
/admin/operations        @390  OVERFLOW = 0px
/admin/dashboard         @390  OVERFLOW = 0px
```

No page-level horizontal overflow on any reviewed route at any viewport. The
wider `<table>` elements (980px/720px) live inside `overflow-x-auto`
`DataTableShell` cards and scroll *within the card* (intended DataTable
responsive behavior), not page-level. Desktop (1440) and medium (1024) are
clean and usable: clear hierarchy, sane spacing/density, working stepper with
disabled future steps, provenance badges + 恢复模板值, copy-on-apply hints,
inline `FieldError` validation. **No closeout-blocking visual defect found.**

Minor P3 polish recorded (non-blocking): low-contrast muted hint text in a few
places; the "1/5 步" counter is small; starter-recipe selection is a text
button rather than cards (cards appear only after clicking 从起步模板创建). These
are cosmetic, not closeout defects.

> **Review capability note:** the review was performed via headless-browser
> capture + image analysis + deterministic overflow measurement (mediated
> multimodal), because no interactive Google Chrome was available in the agent
> environment (chrome-devtools-mcp / playwright-MCP / browser-use all require
> Google Chrome, which is not installed; `npx playwright install chrome` was
> attempted and blocked). A final human eyeball pass at a real screen is still
> recommended, but **no blocking defect remains** and the page-overflow claim
> is backed by deterministic measurement, not image interpretation.

Verdict: **PASS**. (The P7-M closeout is now marked **CLOSED** with this
round's review evidence — see
`docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md` §"Visual review closeout
(P7-F round)". A human eyeball pass at a real screen remains recommended and
non-blocking.)

### Gate P7-6 — UI / operations closeout

Requirement: settings/status/recovery/backup/profile workflows usable through
real UI; mobile/responsive + a11y baselines; UI authority migration debt
reduced with enforceable lint.

Reality (representative closeout, not "make every screen perfect"):

- **Admin:** business dashboard, user/staff management, Recovery Center, Operations/reliability-objective, system diagnostics, backup evidence / restore readiness, exam profiles, exam wizard — all present and capability-gated; backend remains authoritative.
- **Maintainer:** lands on `/admin/operations`; sees ONLY the Operations group (no 管理 business nav leakage — F-08 fixed); direct business routes 403; zero business actions; zero infrastructure execution (verified by `operationalBoundary.test.ts` + `adversarialAudit.test.ts` + E2E `operations.spec.ts`).
- **Teacher/Proctor/Grader:** existing supported surfaces verified honestly; Teacher@Course isolation is **NOT** claimed (F-04, #286).
- **Candidate:** supported exam flow intact (blocking E2E: candidate-happy-path, resume-attempt, submit-flush).
- **Responsive/a11y:** measured no page-level mobile overflow (above); stepper is an accessible `<ol>` with `aria-current="step"`; labels paired with inputs; `FieldError` `role="alert"`; dialogs use Radix primitives; no color-only status. UI debt reduction (typography recipes, StatsCard/PageSection migration) remains ongoing per `docs/archive/roadmap/ui-open-items.md` — explicitly NOT absorbed into P7-F.

Verdict: **PASS** (representative closeout).

## Current authority model (after P7-F, unchanged from P7-E/RBAC remediation)

```text
Admin (考试管理员)        = business + application-settings + reliability-objective authority
                            = NEVER infrastructure execution
Maintainer (系统运维)     = read-only Operational Observer — exactly 5 read caps,
                            0 writes, 0 business perms (pinned by maintainerPreset.test.ts)
System                   = synthetic, non-login, non-assignable
Host Operator            = real infrastructure execution — NOT Exam RBAC
Configurer               = DOES NOT EXIST
Admin ∩ Maintainer       = ∅ (transactional, org advisory lock; write-skew tested)
Teacher@Course (F-04)    = target, NOT implemented; runtime is org-wide (#286 closed w/o impl)
Redis authority          = shared rate limit only (PostgreSQL remains Exam authority)
PostgreSQL authority     = sole authority for attempts/answers/grading/audit/business config
Profile execution        = none at runtime (copy-on-apply; published Exam is immutable authority)
Infrastructure execution in Exam = NONE (restore/PITR/PGDATA/secret/shell permanently outside browser)
```

The runtime implements the ADR-017 **rev-4** read-only-observer model; the ADR
**document** rev 4 (and ADR-018) remain PROPOSED pending human acceptance.

## Findings

- **P0: 0.**
- **P1: 0.**
- **P2: 2** (both are Gate P7-3 bullets — the reasons P7 stays OPEN; both
  **HUMAN_DECISION_REQUIRED**, neither faked):
  - **P7-3a — RTO not declared/tested.** No typed `desired_rto_*` authority
    (verified against `backup_operational_policy` in `packages/db/src/schema/pg.ts`),
    no declared supported RTO value, no restore-within-RTO acceptance.
  - **P7-3b — retention not operational.** Host-owned/operator-discipline,
    truthfully `NOT_ENFORCED`, `backup.retention.manage` NO-GO per P7-E3.
    Preferred resolution path: host-side automated retention (WAL-G/pgBackRest
    via cron/systemd), Exam observes evidence only.
- **P3:**
  - Doc drift (P7-0) — **FIXED** in this PR (current/phase-roadmap/phase3-open-items/implementation-status + canonical `docs/archive/roadmap/P7-system-readiness-and-exam-modes.md` reconciled — the latter gained a Current-status overlay and per-workstream status rows).
  - `#286` closed-without-implementation — **HUMAN_DECISION_REQUIRED** (clarify intent; P7-F did not reopen, did not claim isolation, did not redefine Teacher).
  - ADR-017 rev4 / ADR-018 PROPOSED — **HUMAN_DECISION_REQUIRED** (accept or revise).
  - Minor P7-M UI polish (low-contrast hints, small step counter, starter-button styling) — recorded, non-blocking; not absorbed into P7-F.
  - `docs/archive/roadmap/recovery-operations-jobs.md` startup-reconciler-is-J7 framing is stale vs the S2 negative conclusion — reconciled in this closeout, not by code.

## Visual review

- Capability: mediated multimodal (headless chromium capture + image analysis + deterministic overflow measurement). No interactive Google Chrome in agent env.
- Routes: `/admin/exam-profiles`, `/admin/exam-profiles/new`(+edit), `/admin/exams/new` wizard (steps 1-2), `/admin/operations`, `/admin/dashboard`.
- Viewports: 1440×900, 1024×768, 390×844.
- Evidence: 11 screenshots in `/tmp/p7f-shots/` (ephemeral); deterministic overflow measurement recorded above.
- Defects found: 0 blocking; minor P3 polish only.
- Fixes: none required for closeout.
- Remaining human visual review: a final eyeball pass at a real screen is recommended (non-blocking); the page-overflow claim is measurement-backed.

## Deployment / restore evidence

**Status: NOT RE-RUN in P7-F — pass/fail explicitly not claimed.**

P7-C deterministic Docker drills (`tests/deployment/`: compose-smoke,
launchpad-bootstrap, persistence-and-cold-restore, logical-backup-restore,
pitr) are the restore authority and are **unchanged by P7-F** (docs-only
branch; the scripts they invoke gained optional evidence hooks in P7-E2B;
pass/fail contract untouched). Their last full passing runs are recorded by
the P7-C closeout and the P7-E round-3 verification; the drill pass/fail
contract was not modified by any P7-F file. A full deployment regression run
(plus WSL Playwright E2E) is a recommended human-review step, and P7-F did
not invent or claim restore evidence it did not execute.

## Test evidence

**`pnpm verify` — PASS (exit 0)** (docs-only changes; all suites identical to
the green master baseline). Evidence split: local `pnpm verify` ran at HEAD
`0785c7f6`; **CI (Static checks, Build, API/Package/Web coverage, E2E shard
1/2 + 2/2, CodeRabbit, ai_code_review) is all-green at HEAD `f55a9e4b`**
(9/9 checks pass on PR #288; the same gate set was green at `5d987744`
before the review-remediation commits). Actual current-run numbers:

| Package | Test Files | Tests |
| --- | --- | --- |
| @exam/api | 163 | 2190 passed (7 skipped) |
| @exam/web | 116 | 1636 passed |
| @exam/exam-engine | 30 | 596 passed |
| @exam/db | 42 | 566 passed |
| @exam/contracts | 14 | 348 passed |
| @exam/authz | 10 | 79 passed |
| @exam/domain | 6 | 59 passed |
| @exam/import-export | 1 | 17 passed |
| @exam/auth | 2 | 13 passed |
| **Total** | **384 files** | **5504 tests, 0 failed** |

- Static gates inside `verify:static` (format / lint / lint:copy / lint:arch /
  db-config / db-journal / env-contract / repo-contract / ui-gates / eslint /
  typecheck / openapi check / e2e-runner / test:db-journal / test:stale-ui-docs):
  **PASS** (the `&&` chain ran to completion; `test:db-journal` 18/18,
  `test:stale-ui-docs` 7/7).
- **Coverage (v8, % Stmts):** authz 100 · import-export 100 · contracts 96.57 ·
  auth 92.59 · api 84.25 · exam-engine 84.39 · web 80.98 · db 80.82 ·
  domain 69.73.
- **Build:** 9/9 tasks successful (`turbo build`).
- Markdown: touched files pass Prettier and markdownlint (repo-wide `lint:md`
  errors are pre-existing in untouched `docs/standards/*` / `README.md`).
- **CI E2E on the PR: PASS — shard 1/2 + shard 2/2** (both blocking E2E shards
  ran on PR #288 at HEAD `f55a9e4b` and passed; no E2E specs skipped).
- Deployment/restore drills (`tests/deployment/*`) are **unchanged by this
  docs-only PR** and were **NOT RE-RUN in P7-F** (pass/fail explicitly not
  claimed; last full runs recorded by P7-C/E closeouts). A full deployment
  regression run remains a recommended human-review step (no restore evidence
  was invented here).

Known limitations: the agent environment had no interactive Google Chrome
(visual review performed via headless chromium + image analysis + deterministic
overflow measurement — see §"Visual review"); `lint:md` is non-blocking and
carries pre-existing repo-wide errors.

## Deferred / non-blocking

- **Teacher@Course (F-04)** — issue **#286** (closed 2026-08-13 without implementation; human clarification pending). P7-F proceeded generally but claimed/depended on no Teacher course isolation.
- **Controlled / Strict exam profiles** — deferred to owning subsystems (queue admission P7-Q, randomization, device binding, lockdown/IP, identity, continuous monitoring, `timed_sync`/`deadline`/`untimed`).
- **Phase 3 open product work** — staff invitation, SMTP password reset, account lifecycle UI, scoped Teacher/Proctor/Grader as product roles, custom roles, WYSIWYG submit, ADR-008 Option D generic barrier, i18n page copy.
- **J6** (Proctor Recovery Center) and **system-generated incidents** — NOT IMPLEMENTED.
- **RTO declaration/test (P7-3a)** — no typed RTO authority; human decision:
  declare supported RTO + acceptance, or narrow the gate to RPO-only.
- **Retention automation (P7-3b)** — host-owned/operator-discipline today;
  preferred path: host-side automated retention (cron/systemd + WAL-G/pgBackRest,
  per P7-E3), Exam observes evidence only.
- **#258** flaky refresh-during-exam (not reproduced in 78+ clean runs), **#272** attempt-scoped Actor/Coordinator (deferred design), **#182** structured tag filter, **#64** Postgres test isolation — pre-existing, not P7.

## ADR status

- **ADR-017:** **ACCEPTED through revision 3** (PR #281, 2026-08-12). **Revision 4: PROPOSED** (2026-08-13, awaiting human review). Rev 4 narrows Maintainer to read-only observer; revisions 1-3 remain the accepted contract until rev 4 is accepted by an explicit human decision. The runtime already implements the rev-4 model.
- **ADR-018 (Operational Observability Window):** **PROPOSED** (2026-08-13, awaiting human review).

P7-F did **not** silently mark either ACCEPTED. Merging PR #284 (which
implemented the rev-4 model in code) is not, by itself, ADR acceptance under
this repo's process.

## Final verdict

**P7-F COMPLETE — P7 REMAINS OPEN.**

- P7-F: COMPLETE (all gates audited; bounded drift repaired; P7-M visual review
  performed; full application verification completed — CI incl. both E2E shards
  green; deployment/restore evidence reused from P7-C/P7-E and **not re-run** in
  P7-F).
- P7: REMAINS OPEN. Blocking gate: **P7-3 — two bullets NOT MET (RTO + retention),
  HUMAN_DECISION_REQUIRED**. Plus human decisions on **ADR-017 rev4 / ADR-018**
  acceptance and **#286** closure clarification.

**STOP CONDITION: READY FOR HUMAN REVIEW. DO NOT MERGE.**
