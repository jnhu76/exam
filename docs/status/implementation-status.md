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
  on timeout; `restoreAttempt` route). **Frontend self-service restore entry +
  proctor recovery UI are NOT productized** — see Known limitations.
- ✅ Proctor intervention workflow (polling dashboard).
- ✅ Force submit (`POST /admin/attempts/:id/force-submit`,
  `requireCapability(AttemptForceSubmit)`).
- ✅ Extend time (`POST /admin/attempts/:id/extend-time`,
  `requireCapability(AttemptTimeExtend)`).
- ✅ Misconduct marking (`POST /admin/attempts/:id/misconduct` +
  `/proctor-incident`, `requireCapability(AttemptMisconductMark)`).
- ✅ Proctor monitoring: visibility, polling (5s), event timeline, incident logging.
- ✅ Retake policy (enum + enrollment logic) + score strategy (highest/latest/first).
- ✅ Exam operation timeline + attempt timeline.
- ✅ Import/export job logs + larger result export (CSV scores + attempt JSON/CSV).
- ✅ Exam operation audit coverage.
- ✅ Diagnostics page (DB / Redis / scanner health).
- ✅ Manual grading queue and detail page (admin route + repo infrastructure;
  full subjective-answer runtime + candidate-answer-detail E2E is Phase 3).
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
- ✅ Candidate answering runtime (P0 CLOSED): all MVP question types render,
  save/restore/submit; `deriveTakeExamView` pure function + transient reducer.
- ✅ Manual grading closeout (P1 CLOSED): grader views frozen submitted answers,
  scores subjective items, completes grading → `graded + fully_graded`.
- ✅ Email outbox + SMTP backend foundation (outbox table, 3 senders, retry
  policy, notification service, `POST /api/email/test`). See Known limitations.
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
P4 (RBAC MVP role switch)
  → P5-0 (Email delivery runtime hardening)
  → P3 (result publishing closeout)
  → P5-N1 (Notification Inbox + result-published Email integration)
  → P6 (MVP ready closeout)
```

| Job  | True dependency                                | What it adds                                                                              |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P4   | Authorization infrastructure implemented        | Final Admin/Teacher/Candidate product-role model on MVP routes.                           |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | Resident, observable Email worker: lock/heartbeat/diagnostics; rename to `EmailDeliveryService`. |
| P3   | P4 closed                                       | Result-publishing closeout under the final role model + leak tests; stable transaction boundary for P5-N1. |
| P5-N1| P4 + P5-0 + P3 closed                           | First operational notification: `result_published` Inbox + optional Email, atomically.    |
| P6   | Preceding MVP blockers closed                   | MVP ready closeout.                                                                        |

The ordering principle: define permissions first (P4), then harden the Email
base (P5-0), then close out result publishing (P3), then attach the first
notification onto the now-stable result-publication transaction (P5-N1).

- P2-1 Exam Authoring UI Flow has been removed from the active Phase 3 plan by
  scope decision.
- Staff invitation, SMTP password reset, and account lifecycle UI remain
  Phase 3 scope but are separate future work (not silently included in P5-N1).
- `text_response` authoring UI flow and WYSIWYG submit final-answer barrier
  (ADR-008 Option D follow-up) remain Phase 3 product tasks.
- Email template engine + backend i18n remain NOT STARTED.

## Phase 4 — Platformization and Integration: ⬜ NOT STARTED

Pass-to-proceed API, service tokens / API keys, webhooks, optional multiTenant,
SuperAdmin, tenant hierarchy/switcher, organizationSlug login, cross-tenant
audit, external log shipping. All Phase 4; none started.

## Known limitations

- **Disrupted recovery UI**: once an attempt is `disrupted`, the frontend has no
  self-service restore button and no proctor recovery panel — it jumps to the
  result page with an "answering interrupted" message. Backend capability
  exists; productization of frontend restore UI, heartbeat tuning, and proctor
  intervention is deferred to Phase 2+ hardening.
- **Email foundation has no business caller**: `EmailNotificationService` is
  never instantiated by any route; no email is ever enqueued in a real flow.
  `POST /api/email/test` is the only production send path (synchronous, bypasses
  outbox). No worker daemon (enqueued rows would sit `pending` forever). No
  `users.email` column. No password-reset / invitation / registration flows.
  This is the P5-0 + P5-N1 scope: P5-0 turns the outbox into a resident,
  observable worker (ADR-011); P5-N1 adds the first real `result_published`
  business caller. Neither is started yet.
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
  The baseline is now formally accepted; P4-C1 (authorization residue cleanup)
  is unblocked.

## E2E status

E2E is **enabled and runs as blocking CI**. The `e2e` job in
`.github/workflows/ci.yml` (sharded) gates every PR. The three named blocking
specs (candidate-happy-path, resume-attempt, submit-flush) run and pass. The
only skipped E2E spec is `fill-blank-e2e.spec.ts` (Phase 3 pending — not a
Phase 1/2 blocker).
