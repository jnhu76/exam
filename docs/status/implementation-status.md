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

See [`docs/architecture/authorization.md`](../architecture/authorization.md)
for the model details.

### Not implemented (Phase 3 product work)

See [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md):

- Scoped Teacher / Proctor / Grader role bundles **as product roles**
  (presets exist; assignment UI and product flows do not).
- Resource-relationship authorization (M11).
- Staff invitation, SMTP password reset, account lifecycle UI.
- `text_response` authoring UI flow (P2 ACTIVE — audit found gaps).
- Result publishing closeout (P3 queued).
- RBAC MVP role switch — Admin/Teacher/Candidate on MVP routes (P4 queued).
- Email business triggers / worker daemon (P5).
- WYSIWYG submit final-answer barrier (ADR-008 Option D follow-up).
- Email template engine + backend i18n.

## Phase 4 — Platformization and Integration: ⬜ NOT STARTED

Pass-to-proceed API, service tokens / API keys, webhooks, optional multiTenant,
SuperAdmin, tenant hierarchy/switcher, organizationSlug login, cross-tenant
audit, external log shipping. All Phase 4; none started.

## Known limitations

- **Disrupted recovery UI**: once an attempt is `disrupted`, the frontend has no
  self-service restore button and no proctor recovery panel — it jumps to the
  result page with an "answering interrupted" message. Backend capability
  exists; productization is Phase 2+ (P2A-J3 frontend restore UI + P2A-J4
  proctor intervention).
- **Email foundation has no business caller**: `EmailNotificationService` is
  never instantiated by any route; no email is ever enqueued in a real flow.
  `POST /api/email/test` is the only production send path (synchronous, bypasses
  outbox). No worker daemon (enqueued rows would sit `pending` forever). No
  `users.email` column. No password-reset / invitation / registration flows.
- **Gate 0.5 (M10-F post-PR-197 rerun) is PENDING**: it blocks future
  RBAC-sensitive changes. The last-recorded route inventory (91 routes, 81
  capability-gated, 0 `requireRole`) stands but is not freshly re-verified.

## E2E status

E2E is **enabled and runs as blocking CI**. The `e2e` job in
`.github/workflows/ci.yml` (sharded) gates every PR. The three named blocking
specs (candidate-happy-path, resume-attempt, submit-flush) run and pass. The
only skipped E2E spec is `fill-blank-e2e.spec.ts` (Phase 3 pending — not a
Phase 1/2 blocker).
