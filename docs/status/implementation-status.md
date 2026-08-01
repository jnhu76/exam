# Implementation Status

> Answers only: **what is implemented now**, **what is partially implemented**,
> and **what is currently limited**. For future work, see
> [`docs/roadmap/`](../roadmap/). For the phase scope authority, see
> [`docs/roadmap/phase-roadmap.md`](../roadmap/phase-roadmap.md).

## Phase 1 — Minimal Deliverable Exam System: ✅ COMPLETE

Single-tenant, Admin + Candidate reliable exam loop:

- Internal default organization (single organization; `organizationId` data boundary).
- Admin bootstrap + local admin reset-password script.
- CandidateField configuration, Candidate creation + CSV import.
- Course creation, Question CSV import.
- Exam creation (`timed_window` path), publish, Candidate enrollment/assignment.
- Candidate login (no organization slug), start exam, Answer Save Protocol,
  Submit Attempt, Auto grading.
- Result visible to Admin and Candidate; Result CSV export.
- Minimal AuditLog, structured pino logs, requestId, health endpoint, stable
  machine-readable error codes.
- E2E happy path / resume / submit-flush restored as **blocking CI** (both
  shards pass on every PR).
- Docker Compose / health / basic deployment notes.

## Phase 2 — Exam Operation: ✅ GATE ITEMS IMPLEMENTED

Core exam loop items are implemented and verified. The remaining items
(`timed_sync` / `untimed` timing modes, queue admission) are deferred to
Phase 2+ hardening.

### Implemented

- ✅ Exam lifecycle: `draft → published → open → closed → archived` (+ `canceled`);
  all transitions via command functions.
- ✅ Disrupted attempt recovery (backend: heartbeat scanner writes `disrupted`
  on timeout; restore via the composed `restoreInterruptedAttempt` command —
  the legacy `restoreAttempt` route is no longer used in production; REC-I3 Web
  direct-entry restore flow). REC-I4-I1 implements the ADR-013 Domain and
  PostgreSQL persistence foundation, including strict policy/snapshot defaults,
  durable interruption identity, append-only event/adjustment ledgers,
  conservative backfill, and tenant-scoped repositories. REC-I4-I2 (Engine
  Policy Seam) completes the runtime: atomic scanner disruption with episode
  creation, pure policy evaluator (strict/bounded_grace/operator_incident),
  lifecycle-only restore helper, composed restore command with deadline
  reconciliation, and a
  phased fail-closed migration (0022) with status/pointer CHECK constraint.
  REC-I4-I3A (Contract & Authoring Surface) freezes the public contract:
  candidate restore returns the `RestoreAttemptResponseSchema` (lifecycle +
  candidate-safe compensation summary; no internal evidence/ledger leak), Exam
  create/update expose the interruption policy authoring fields with ADR-013
  cross-field validation and draft-only mutation, attempt policy snapshots are
  confirmed immutable post-creation, and structural regression tests prevent
  legacy `restoreAttempt` / `disconnectedDuration` reintroduction.
  REC-I4-I3B1 (Operator Grant Engine Seam) implements the `grantAttemptTime()`
  engine command for operator-initiated time grants with `operationId`-keyed
  idempotency, ADR-013's frozen lock/reconcile order, and the append-only
  adjustment ledger. REC-I4-I3B2 closes the Admin product path:
  `Permission.AttemptTimeGrant`, the Attempt-scoped
  `POST /admin/attempts/:attemptId/time-grants` route, atomic compliance audit,
  PostgreSQL operation-ID race recovery, and Dashboard retry/cross-tab
  coordination. Proctor activation remains deferred until M11 provides
  resource scope.
- ✅ Proctor intervention workflow (polling dashboard).
- ✅ Force submit (`POST /admin/attempts/:id/force-submit`,
  `requireCapability(AttemptForceSubmit)`).
- ✅ Admin operator time grant (`POST /admin/attempts/:id/time-grants`,
  `requireScopedCapability(AttemptTimeGrant, Attempt)`); Proctor is denied
  until M11 resource scope is implemented.
- ✅ Misconduct marking (`POST /admin/attempts/:id/misconduct` +
  `/proctor-incident`, `requireCapability(AttemptMisconductMark)`).
- ✅ Proctor monitoring: visibility, polling (5s), event timeline, incident logging.
- ✅ Retake policy (enum + enrollment logic) + score strategy (highest/latest/first).
- ✅ Exam operation timeline + attempt timeline.
- ✅ Import/export job logs + larger result export (CSV scores + attempt JSON/CSV).
- ✅ Exam operation audit coverage.
- ✅ Diagnostics page (DB / Redis / scanner health).
- ✅ Manual grading queue and detail page (admin route + repo infrastructure;
  plain-text subjective-answer runtime, candidate-answer detail, and
  result flow are now CLOSED — PRs #237/#238, 2026-07-31; only
  rich-text/WYSIWYG answering remains Phase 3/P7).
- ✅ Result publishing modes (immediate / after_grading / manual).
- ✅ Client telemetry pipeline (logger → buffer → batch POST → sanitize → DB).
- ✅ Candidate/admin permission boundary enforced on every route.

### Deferred (Phase 2+ hardening)

- `timed_sync` / `deadline` / `untimed` timing modes (only `timed_window`
  implemented; `requireQueue` code exists but is not operationally wired).
- Queue admission.

## Phase 3 — Collaboration, Permissions, Account Lifecycle: 🟡 PARTIALLY IMPLEMENTED

### Implemented (authorization infrastructure)

The authorization **infrastructure** is live (not "not started"):

- ✅ Capability-based authorization (`requireCapability`,
  `requireScopedCapability`, `requireOwnAttempt`, `requireExamEligibility`,
  `requireCandidateContext`).
- ✅ Permission catalog + role presets.
- ✅ Assignment-backed runtime authority (`loadAssignmentAuthority`,
  multi-role union, last-admin invariant, fail-closed contract).
- ✅ Candidate/admin permission boundary.
- ✅ Exam protocol foundation: `text_response` question type, `submitted_answers`
  physical column, submit freeze (SubmittedAnswersSnapshot), CandidateTakeSnapshot
  endpoint, deadline reconciliation, rubric two-layer storage, materialized
  grading workset (`attempt_grading_entries`), canonical terminal grading
  authority (`finalizeTerminalGrading`).
- ✅ Plain-text `text_response` product loop (CLOSED 2026-07-31, PRs #237/#238):
  authoring with rubric + optional reference answer, searchable accessible
  course selection, publish validation + frozen question snapshot, candidate
  metadata isolation, candidate multiline answering + submission, real Grading
  Queue UI discovery, manual grading + final result, and post-publish live-edit
  snapshot-freeze proof. Rich-text/WYSIWYG editing and the generic ADR-008
  final-answer submit barrier (answer-type-independent) remain open.
- ✅ Candidate answering runtime (P0 CLOSED): all MVP question types render,
  save/restore/submit; `deriveTakeExamView` pure function + transient reducer.
- ✅ Manual grading closeout (P1 CLOSED): grader views frozen submitted answers,
  scores subjective items, completes grading → `graded + fully_graded`.
- ✅ Email outbox + SMTP backend foundation (outbox table, 3 senders, retry
  policy, notification service, `POST /api/email/test`). See Known limitations.
- ✅ Email delivery runtime (P5-0 CLOSED, 2026-07-25, PR #210): resident worker
  with `FOR UPDATE SKIP LOCKED` claim, lock ownership, heartbeat, abandoned-lock
  recovery, and backlog/liveness diagnostics.
- ✅ ADR-011 accepted as the Notification and Email delivery architecture
  authority (two-channel Inbox + asynchronous Email outbox, resident worker,
  atomic business transaction, validated `PUBLIC_WEB_ORIGIN` / `actionPath`).

See [`docs/architecture/authorization.md`](../architecture/authorization.md)
for the model details and
[`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md)
for the notification/email architecture.

### Not implemented (Phase 3 product work)

See [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md):

- Scoped Teacher / Proctor / Grader role bundles **as product roles**
  (presets exist; assignment UI and product flows do not).
- Resource-relationship authorization (M11).

The remaining Phase 3 product work is sequenced as a hard module execution
order with real dependencies (not narrative sequence):

```text
P4 (RBAC MVP role switch) ✅ CLOSED
  → P5-0 (Email delivery runtime hardening) ✅ CLOSED (2026-07-25, PR #210)
  → P3 (result publishing closeout) ✅ CLOSED (2026-07-25, PR #211)
  → P5-N1 (Notification Inbox + result-published Email integration) ✅ CLOSED (2026-07-25, PR #213)
  → P6 (MVP ready closeout) ✅ CLOSED (2026-07-26, PR #215)
```

| Job  | True dependency                                | What it adds                                                                                      |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P4   | Authorization infrastructure implemented        | Final Admin/Teacher/Candidate product-role model on MVP routes. **CLOSED** (2026-07-24, tested commit `b4dc1d6`); see [`docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`](../audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md). |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | Resident, observable Email worker: lock/heartbeat/diagnostics; rename to `EmailDeliveryService`. **CLOSED** (2026-07-25, PR #210). |
| P3   | P4 closed                                       | Result-publishing closeout under the final role model + leak tests; stable transaction boundary for P5-N1. **CLOSED** (P3-R0 audit + P3-R1 test-only closeout: M8 Teacher publish API, M9 Teacher all-view result, M12 Teacher browser E2E, M13 concurrent idempotency). See [`docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`](../audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md), [`docs/audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md`](../audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md). |
| P5-N1| P4 + P5-0 + P3 closed                           | First operational notification: `result_published` Inbox + optional Email, atomically. **CLOSED** (2026-07-25, PR #213 merged; final review corrective merged in the same PR). See [`docs/archive/roadmap/P5-N1-notification-inbox-result-published-job-v2.md`](../archive/roadmap/P5-N1-notification-inbox-result-published-job-v2.md) and [`docs/audits/P5-N1-I3-CLOSEOUT.md`](../audits/P5-N1-I3-CLOSEOUT.md). |
| P6   | Preceding MVP blockers closed                   | MVP ready closeout. **CLOSED — implemented MVP subset release-ready** (2026-07-26, PR #215 merged; independent closeout PASS). See [`docs/audits/P6-MVP-READY-REALITY-AUDIT.md`](../audits/P6-MVP-READY-REALITY-AUDIT.md). |

**P6 release readiness:** the supported LAN/on-premise, single-organization
MVP deployment now has:

- production-safe required configuration;
- clean database migration and first-Admin bootstrap;
- app + PostgreSQL + Email worker default topology;
- optional Redis;
- serialized production migrations;
- bootstrap-pending Email worker state;
- PostgreSQL Inbox and Email outbox;
- worker heartbeat and diagnostics;
- clean production Docker build;
- repeatable relocated clean-volume Compose smoke evidence.

The ordering principle: define permissions first (P4), then harden the Email
base (P5-0), then close out result publishing (P3), then attach the first
notification onto the now-stable result-publication transaction (P5-N1).

- P2-1 Exam Authoring UI Flow has been removed from the active Phase 3 plan by
  scope decision.
- Staff invitation, SMTP password reset, and account lifecycle UI remain
  Phase 3 scope but are separate future work (not silently included in P5-N1).
- Plain-text `text_response` authoring UI flow and result loop are CLOSED
  (PRs #237/#238, 2026-07-31). The remaining Phase 3/P7 product tasks are
  rich-text/WYSIWYG authoring and the generic ADR-008 final-answer submit
  barrier (Option D follow-up; answer-type-independent).
- Email template engine + backend i18n remain NOT STARTED.

## Phase 4 — Platformization and Integration: ⬜ NOT STARTED

Pass-to-proceed API, service tokens / API keys, webhooks, optional multiTenant,
SuperAdmin, tenant hierarchy/switcher, organizationSlug login, cross-tenant
audit, external log shipping. All Phase 4; none started.

## Known limitations

- **Interruption time compensation**: REC-I3 implements candidate direct-entry
  restore. REC-I4-I1 implemented the persistence foundation (ADR-013 `strict`
  default, explicit bounded caps, operator attribution, episode identity,
  append-only adjustment ledger). REC-I4-I2 (Engine Policy Seam) delivers
  runtime compliance: restore goes through the composed
  `restoreInterruptedAttempt` command (the legacy `restoreAttempt` route is no
  longer used in production), and the heartbeat scanner, deadline scanner, and
  candidate/admin submit paths all thread a `SubmitInterruptionResolution` so
  every `disrupted → submitted` terminalization appends a `terminalized` event
  with a context-specific reason code. REC-I4-I3A (Contract & Authoring
  Surface) freezes the public contract: candidate restore returns
  `RestoreAttemptResponseSchema` (lifecycle + candidate-safe compensation
  summary; no internal evidence/ledger leak), Exam create/update expose the
  interruption policy authoring fields with ADR-013 cross-field validation and
  draft-only mutation, and attempt policy snapshots are confirmed immutable
  post-creation. REC-I4-I3B1 (Operator Grant Engine Seam) implements the
  `grantAttemptTime()` command: the ledger insert and deadline update through
  transaction-bound repositories, with `operationId`-keyed idempotency and
  ADR-013's frozen lock/reconcile order. REC-I4-I3B2 closes the Admin
  operator time-grant route, permission, audit transaction, and Dashboard
  product path. The exam incident authority (ADR-014 ACCEPTED) is now
  implemented for the Admin surface by J3
  (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`) — **J3 is CLOSED on master**
  via PR #242 (merge commit `5b653c13`, 2026-08-01; see
  [`docs/audits/REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md`](../audits/REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md)).
  The Admin Incident runtime is implemented: five additive tables
  (migration `0023`), domain types/errors, repositories, nine canonical
  write commands, Admin-only permissions, API routes, audit actions, and
  the `grantAttemptTime()` optional `incidentId` operator path. The Admin
  Incident authority path is live. Proctor Incident runtime is NOT
  implemented — Proctor activation still requires M11 Proctor-to-Exam
  scope (J4; next authority job is the M11-R0 design contract). Recovery
  Center UI (J5/J6), Proctor-to-Exam resource scope (J4/M11), and
  system-generated incidents remain NOT IMPLEMENTED and deferred.
- **Email runtime business caller (P5-N1 CLOSED)**: The Email delivery runtime
  (P5-0) is closed and P5-N1 is now closed: the first real `result_published`
  business caller (atomic publication → Inbox + outbox) is live, and the
  resident Email delivery worker drains the outbox asynchronously. The worker
  is now wired as a first-class Compose service in the supported production
  topology (see P6 deployment topology audit). `POST /api/email/test` remains
  as the synchronous connectivity probe. No password-reset / invitation /
  registration flows yet.
- **Gate 0.5 (M10-F post-PR-197 rerun) is PASS** (verified 2026-07-24 on commit
  `f2a7a80`): the runtime route tree was re-captured via a Fastify `onRoute`
  hook over the full production composition and reconciles exactly — **91
  primary application routes** (131 raw registrations = 91 + 40 auto-generated
  HEAD aliases), **81 capability/ownership-gated** (65 flat + 16
  scoped/resource-aware), **10 non-gated** (4 authenticate-only, 5 public, and
  1 intentionally disabled public endpoint),
  **0 `requireRole` route preHandlers**, **0 `requirePermission` route
  consumers**, **0 `users.role`/JWT-role authority decisions**, registry ↔
  runtime 81/81 MATCH with zero drift. The final repository gate `pnpm verify`
  was executed in full during the P4-V0 re-issue and **passed (exit 0)**; the
  grouped suite file/test counts were corrected against real `vitest run` output.
  Full evidence:
  [`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md`](../audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md).
  Gate 0.5 was re-verified during P4-R1 closeout on commit `b4dc1d6` (the
  conformance suite and the whole-application regression lock both pass); the
  baseline remains PASS. P4 is **CLOSED** — see
  [`docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`](../audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md).

## E2E status

E2E is **enabled and runs as blocking CI**. The `e2e` job in
`.github/workflows/ci.yml` (sharded) gates every PR. The three named blocking
specs (candidate-happy-path, resume-attempt, submit-flush) run and pass. The
only skipped E2E spec is `fill-blank-e2e.spec.ts` (Phase 3 pending — not a
Phase 1/2 blocker).
