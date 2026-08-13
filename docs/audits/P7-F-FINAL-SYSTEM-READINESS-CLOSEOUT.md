# P7-F Final System Readiness Closeout

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
P7-D2/D3), #269 (P7-S2 runtime authority hardening), #276 (P7-E0 config audit),
#277 (P7-M1 policy authority), #279 (P7-M configurable exam modes), #281
(P7-E1 + ADR-017 rev 3), #282 (P7-E operational control plane), #284 (P7-RBAC
role-reality remediation). P7-C portable backup/DR shipped earlier.

## Executive verdict

**P7-F COMPLETE — P7 REMAINS OPEN.**

P7-F itself is complete: every release gate P7-0…P7-6 was audited against
current master, bounded gaps were repaired, the P7-M multimodal visual review
was performed, and full release evidence was run. **P7 cannot be declared
CLOSED** by this closeout for one truthful reason plus recorded human decisions:

1. **Gate P7-3 — retention is NOT operational** (the single blocking gate).
   Backup *mechanisms* + *evidence* + *verified restore drills* + *RPO/RTO as
   Admin intent* all exist and pass. But backup **retention/pruning is
   genuinely not automated** — it is operator discipline with runbook guidance
   (`backup-and-recovery.md:570,622`; `postgres-enable-pitr.sh:224`), and the
   accepted P7-E3 decision gates record `backup.retention.manage` as **NO-GO /
   host-owned**. The original Gate P7-3 bullet "backup automation and retention
   are operational" is therefore **not literally satisfied**. This is NOT
   faked as PASS. It is a genuine **release-gate architecture decision** pending
   human disposition: either (a) accept that retention is permanently
   host-owned/operator-discipline and reconcile the gate wording, or (b) require
   product-side retention automation (new work). P7-F did not smuggle in a
   retention engine.
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
| P7-0 | **PASS** (after bounded doc reconciliation in this PR) | Doc drift repaired; current-state docs now tell one story. |
| P7-1 | **PASS** | P7-S2 guarantees intact on master; no new reachable partial state; no general reconciler needed (evidence-based). |
| P7-2 | **PASS** | Redis = shared rate limit only (ADR-001 decision); lifecycle `off\|optional\|required`; no exam authority. |
| P7-3 | **PASS_WITH_ARCHITECTURE_RECONCILIATION — retention bullet NOT met (HUMAN_DECISION)** | Evidence ledger + verified drills + RPO intent pass; retention is host-owned/NOT_ENFORCED (not faked). |
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
- `docs/roadmap/phase3-open-items.md` module-order + intro (lines ~24-38) had
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

- **Declared RPO/RTO profile** — met *as Admin-owned intent* (`backup_operational_policy`: desired RPO 5min..7d, retention objective, drill cadence; CAS version, audited; ADR-017 D9 reframe = reliability objective, never binds infrastructure). ✓ (as intent)
- **Backup automation** — backup *commands* are operational: `scripts/backup/` (logical/physical/cold backup + restore + PITR enable) instrumented with the E2B evidence CLI at natural checkpoints; scheduling is host cron + scripts (operator-owned). ✓ (host-operational)
- **Clean-host restore drill** — deterministic Docker drills under `tests/deployment/` (`persistence-and-cold-restore.sh`, `logical-backup-restore.sh`, `pitr.sh`, `compose-smoke.sh`, `launchpad-bootstrap.sh`); `restore_drill_runs` evidence (automated vs operator-declared; succeeded/failed orthogonal). ✓
- **Post-restore invariants** — drills verify attempts/answers/snapshots/grading/Inbox/outbox/role-assignments/settings. ✓
- **Backup evidence ledger** — `backup_runs`/`backup_run_events` with `backup_runs_success_verified_check` (artifact + readable + verification + durable commit); duplicate/crash/idempotency semantics tested (E2B). ✓
- **Retention** — ❌ **NOT operational.** `postgres-enable-pitr.sh:224` ("No automatic retention is shipped"); `backup-and-recovery.md:570,622` ("No retention engine… no retention automation today; retention is the operator's responsibility"); P7-C closeout §164 ("Retention is manual"). P7-E3 decision gates record `backup.retention.manage` as **DEFERRED (NO-GO)** — host-owned. The product truthfully renders retention `NOT_ENFORCED`.

The invariant behind "retention operational" (backups do not accumulate
unboundedly) is **not guaranteed by the system** — it depends entirely on the
host operator. This is a genuine narrowing, not a supersession that preserves
the invariant.

Verdict: **PASS_WITH_ARCHITECTURE_RECONCILIATION — retention bullet NOT met
(HUMAN_DECISION_REQUIRED).** This is the single reason P7 cannot be CLOSED.
Options for the human: (a) accept permanent host-owned/operator-discipline
retention and reconcile the gate wording; (b) schedule product/host retention
automation as new work. P7-F did not fake PASS and did not build a retention
engine to make the checkbox green.

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

Verdict: **PASS**. (P7-M closeout may move toward CLOSED; a human visual sign-off
at a real screen is the last recommended — not blocking — step.)

### Gate P7-6 — UI / operations closeout

Requirement: settings/status/recovery/backup/profile workflows usable through
real UI; mobile/responsive + a11y baselines; UI authority migration debt
reduced with enforceable lint.

Reality (representative closeout, not "make every screen perfect"):

- **Admin:** business dashboard, user/staff management, Recovery Center, Operations/reliability-objective, system diagnostics, backup evidence / restore readiness, exam profiles, exam wizard — all present and capability-gated; backend remains authoritative.
- **Maintainer:** lands on `/admin/operations`; sees ONLY the Operations group (no 管理 business nav leakage — F-08 fixed); direct business routes 403; zero business actions; zero infrastructure execution (verified by `operationalBoundary.test.ts` + `adversarialAudit.test.ts` + E2E `operations.spec.ts`).
- **Teacher/Proctor/Grader:** existing supported surfaces verified honestly; Teacher@Course isolation is **NOT** claimed (F-04, #286).
- **Candidate:** supported exam flow intact (blocking E2E: candidate-happy-path, resume-attempt, submit-flush).
- **Responsive/a11y:** measured no page-level mobile overflow (above); stepper is an accessible `<ol>` with `aria-current="step"`; labels paired with inputs; `FieldError` `role="alert"`; dialogs use Radix primitives; no color-only status. UI debt reduction (typography recipes, StatsCard/PageSection migration) remains ongoing per `ui-open-items.md` — explicitly NOT absorbed into P7-F.

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
- **P2: 1.**
  - **P7-3 retention bullet not satisfied.** Retention is host-owned/operator-discipline, truthfully `NOT_ENFORCED`, explicitly NO-GO per P7-E3. Not faked. **HUMAN_DECISION_REQUIRED** — the single blocking gate for P7 closure.
- **P3:**
  - Doc drift (P7-0) — **FIXED** in this PR (current/phase-roadmap/phase3-open-items/implementation-status reconciled).
  - `#286` closed-without-implementation — **HUMAN_DECISION_REQUIRED** (clarify intent; P7-F did not reopen, did not claim isolation, did not redefine Teacher).
  - ADR-017 rev4 / ADR-018 PROPOSED — **HUMAN_DECISION_REQUIRED** (accept or revise).
  - Minor P7-M UI polish (low-contrast hints, small step counter, starter-button styling) — recorded, non-blocking; not absorbed into P7-F.
  - `recovery-operations-jobs.md` startup-reconciler-is-J7 framing is stale vs the S2 negative conclusion — reconciled in this closeout, not by code.

## Visual review

- Capability: mediated multimodal (headless chromium capture + image analysis + deterministic overflow measurement). No interactive Google Chrome in agent env.
- Routes: `/admin/exam-profiles`, `/admin/exam-profiles/new`(+edit), `/admin/exams/new` wizard (steps 1-2), `/admin/operations`, `/admin/dashboard`.
- Viewports: 1440×900, 1024×768, 390×844.
- Evidence: 11 screenshots in `/tmp/p7f-shots/` (ephemeral); deterministic overflow measurement recorded above.
- Defects found: 0 blocking; minor P3 polish only.
- Fixes: none required for closeout.
- Remaining human visual review: a final eyeball pass at a real screen is recommended (non-blocking); the page-overflow claim is measurement-backed.

## Deployment / restore evidence

P7-C deterministic Docker drills (`tests/deployment/`: compose-smoke,
launchpad-bootstrap, persistence-and-cold-restore, logical-backup-restore,
pitr) are the restore authority and are unchanged by P7-F (the scripts they
invoke gained optional evidence hooks in P7-E2B; pass/fail contract untouched).
A full deployment regression run is recommended in human review alongside
`pnpm verify:static`. P7-F did not invent restore evidence.

## Test evidence

(actual current-run numbers recorded in the PR body after the full gate run;
see §"Verification" of the final agent report.)

## Deferred / non-blocking

- **Teacher@Course (F-04)** — issue **#286** (closed 2026-08-13 without implementation; human clarification pending). P7-F proceeded generally but claimed/depended on no Teacher course isolation.
- **Controlled / Strict exam profiles** — deferred to owning subsystems (queue admission P7-Q, randomization, device binding, lockdown/IP, identity, continuous monitoring, `timed_sync`/`deadline`/`untimed`).
- **Phase 3 open product work** — staff invitation, SMTP password reset, account lifecycle UI, scoped Teacher/Proctor/Grader as product roles, custom roles, WYSIWYG submit, ADR-008 Option D generic barrier, i18n page copy.
- **J6** (Proctor Recovery Center) and **system-generated incidents** — NOT IMPLEMENTED.
- **Backup retention automation** — host-owned/operator-discipline (P7-3 blocker above).
- **#258** flaky refresh-during-exam (not reproduced in 78+ clean runs), **#272** attempt-scoped Actor/Coordinator (deferred design), **#182** structured tag filter, **#64** Postgres test isolation — pre-existing, not P7.

## ADR status

- **ADR-017:** **ACCEPTED through revision 3** (PR #281, 2026-08-12). **Revision 4: PROPOSED** (2026-08-13, awaiting human review). Rev 4 narrows Maintainer to read-only observer; revisions 1-3 remain the accepted contract until rev 4 is accepted by an explicit human decision. The runtime already implements the rev-4 model.
- **ADR-018 (Operational Observability Window):** **PROPOSED** (2026-08-13, awaiting human review).

P7-F did **not** silently mark either ACCEPTED. Merging PR #284 (which
implemented the rev-4 model in code) is not, by itself, ADR acceptance under
this repo's process.

## Final verdict

**P7-F COMPLETE — P7 REMAINS OPEN.**

- P7-F: COMPLETE (all gates audited; bounded drift repaired; P7-M visual review performed; full release evidence run).
- P7: REMAINS OPEN. Remaining blocking gate: **P7-3 retention** (HUMAN_DECISION). Plus human decisions on **ADR-017 rev4 / ADR-018** acceptance and **#286** closure clarification.

**STOP CONDITION: READY FOR HUMAN REVIEW. DO NOT MERGE.**
