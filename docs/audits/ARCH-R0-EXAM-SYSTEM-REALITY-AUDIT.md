# ARCH-R0: Exam System Reality Audit

> This audit challenges the normative architecture documents against the actual implementation. It does not merely summarize — it identifies where code diverges from the documented invariants.

## 1. Starting commit

This audit is based on a snapshot of the repository at the time of authorship. The exact commit is recorded in the git log of the branch on which these documents are authored.

## 2. Authority Read

The following authority sources were read before auditing:

- `AGENTS.md` — project constraints and agent instructions
- `CONTEXT.md` — domain language and lifecycle reference
- `docs/SPEC.md` — system specification
- `docs/architecture/exam-runtime.md` — P3-L0 protocol specification
- `docs/architecture/authorization.md` — authorization architecture
- `docs/adr/` — ADR-005 through ADR-011
- `docs/roadmap/phase-roadmap.md` — phase authority
- `docs/status/implementation-status.md` — current implementation status
- `docs/audits/` — P4 audit series
- All `packages/domain/src/`, `packages/exam-engine/src/`, `packages/db/src/`, `packages/authz/src/`
- All `apps/api/src/routes/`, `apps/api/src/orchestrators/`, `apps/api/src/authz/`, `apps/api/src/adapters/`, `apps/api/src/audit/`
- Key `apps/web/src/` pages and lib

## 3. Repository Inventory

| Layer | Package | Files | Status |
|-------|---------|-------|--------|
| Domain | `packages/domain/src/` | 5 files (enums, errors, types, gradingEngine, index) | Complete |
| Engine | `packages/exam-engine/src/` | 14 files | Complete |
| DB | `packages/db/src/` | schema, types, 15+ repository files | Complete |
| Auth | `packages/auth/src/` | 4 files (session, password, tenantGuard, index) | Complete |
| Authz | `packages/authz/src/` | catalog, presets, resolver, legacyMap, auditActions, systemActor | Complete |
| Contracts | `packages/contracts/src/` | 19 modules | Complete |
| API routes | `apps/api/src/routes/` | 20+ route files | Complete |
| API orchestrators | `apps/api/src/orchestrators/` | 1 file (submitAndGradeAttempt) | Complete |
| API authz | `apps/api/src/authz/` | 10+ files | Complete |
| API audit | `apps/api/src/audit/` | 2 files (auditWriter, auditPolicy) | Complete |
| API workers | `apps/api/src/workers/` | 1 file (emailDeliveryWorker) | Complete |
| Frontend | `apps/web/src/` | pages, lib, components | Sampled |

## 4. Domain-Object Reality

### 4.1 Question

**Normative claim**: Question is a live mutable authoring entity with no lifecycle state.

**Reality**: CONFIRMED. `questions` table has no status column. Questions are mutable from creation until deletion. No version table exists.

**Normative claim**: Question deletion can break historical Exams.

**Reality**: CONFIRMED as ACCEPTED LIMITATION. There is no referential integrity guard. Deleting a question referenced by existing snapshots does not break historical attempts (snapshots are copies), but the question bank loses the source. No code searches for `questions` references at delete time.

### 4.2 Paper

**Normative claim**: Paper is an implicit/embedded composition concept (classification C).

**Reality**: CONFIRMED. No `papers` table, no `Paper` type, no `PaperRepository`. Composition authority lives on `Exam.questionSnapshot` and `Attempt.questionSnapshot`.

### 4.3 Exam

**Normative claim**: Exam has 6 lifecycle states; all transitions go through command functions.

**Reality**: CONFIRMED. `examCommands.ts` provides `publishExam`, `openExam`, `closeExam`, `cancelExam`, `unpublishExam`, `extendExam`, `archiveExam`, `publishResults`. All use `assertTransition()` from `examStateMachine.ts`. No route directly mutates `exam.status`.

**Normative claim**: Fields freeze at publish.

**Reality**: CONFIRMED with nuance. The route layer enforces that only schedule fields (`openAt`/`closeAt`) are mutable in `published` state, and only in `draft` for everything else. The `ExamUpdateNotAllowedError` is thrown for invalid state updates. However, this is enforced at the **route layer**, not the DB layer — there is no DB constraint that prevents mutation of frozen fields.

### 4.4 Enrollment

**Normative claim**: Enrollment tracks eligibility, attempt count, and final score.

**Reality**: CONFIRMED. `exam_enrollments` has `status`, `attemptCount`, `finalScore`, `finalPassed`, `finalAttemptId`. Unique constraint on `(org, exam, candidate)`.

### 4.5 Attempt

**Normative claim**: Attempt has 8 lifecycle states; only 4 are reachable.

**Reality**: CONFIRMED. `in_progress`, `disrupted`, `submitted`, `graded` have write paths. `not_started`, `queued`, `grading`, `voided` have NO write path.

**Finding**: The `grading` state is documented as "transient machine-only" but has NO write path at all. Auto-graded attempts go directly from `submitted` to `graded`. This is consistent with the normative document but worth noting: the `grading` state is currently **dead code** in the state machine (the `submitted:grade → grading` and `grading:complete_grading → graded` transitions exist in `attemptStateMachine.ts` but are never invoked by any command).

**Classification**: ARCHITECTURAL_DEBT — the `grading` state transition table entries are unreachable.

### 4.6 Grading workset

**Normative claim**: `attempt_grading_entries` is the single durable grading truth.

**Reality**: CONFIRMED. `materializeGradingWorkset()` creates entries at submit-freeze. `aggregateGradingEntries()` reads only entries + snapshot. `attempt.gradingResult` is written by `finalizeTerminalGrading()` and never read as scoring input.

## 5. Paper Reality

**Normative claim**: Paper is classification C (derived concept represented by `exam.questionSnapshot`).

**Reality**: CONFIRMED. No explicit Paper aggregate exists. The `exam.questionSnapshot` JSONB column is the composition authority. Total score is derived (validated at publish to equal the sum of question scores).

**Finding**: The `exam.totalScore` column is independently writable but validated at publish. There is no DB constraint enforcing `totalScore = SUM(questionSnapshot.score)`. This is enforced only by `publishExam()`.

**Classification**: ACCEPTED_LIMITATION — publish-time validation is the only guard.

## 6. Protocol Inventory

| Protocol | Documented? | Implemented? | Evidence |
|----------|-------------|--------------|----------|
| Question create/update/delete | Yes | Yes | `routes/question.ts` |
| Exam create/update | Yes | Yes | `routes/exam.ts` |
| Exam publish | Yes | Yes | `examCommands.ts::publishExam` |
| Exam open/close/cancel/archive | Yes | Yes | `examCommands.ts` |
| Exam unpublish/extend | Yes | Yes | `examCommands.ts` |
| Candidate enrollment | Yes | Yes | `routes/exam.ts` (enrollment routes) |
| Attempt start/restore | Yes | Yes | `attemptCommands.ts::startOrRestoreAttempt` |
| Save Answer | Yes | Yes | `answerProtocol.ts::saveAnswer` |
| Attempt heartbeat | Yes | Yes | `routes/attempts.candidate.ts` |
| Deadline reconciliation | Yes | Yes | `deadlineReconciliation.ts::ensureAttemptDeadlineReconciled` |
| Attempt submit | Yes | Yes | `attemptCommands.ts::submitAttempt` |
| Submit-answer freeze | Yes | Yes | `submitAttempt()` (inside attemptCommands) |
| Automatic grading | Yes | Yes | `gradingEngine.ts` + `grading.ts::finalizeGrading` |
| Manual grading | Yes | Yes | `manualGrading.ts::gradeQuestion` |
| Terminal grading finalization | Yes | Yes | `grading.ts::finalizeTerminalGrading` |
| Result read | Yes | Yes | `routes/scores.ts` |
| Result publication | Yes | Yes | `examCommands.ts::publishResults` |
| Result export | Yes | Yes | `routes/export.ts` |
| Email outbox enqueue | Yes | Yes | `emailOutboxRepo.ts::create` (no production caller) |
| Email worker claim/send/retry/dead | Yes | Yes | `emailDeliveryWorker.ts` + `emailOutboxRepo.ts` |

## 7. State-Machine Reality

### 7.1 Exam state machine

**Normative claim**: 6 states, transitions as documented.

**Reality**: CONFIRMED. `EXAM_VALID_TRANSITIONS` in `examStateMachine.ts` matches the normative document exactly.

**Finding**: `published → archived` is a legal transition in the state machine, but the route layer (`executeAdminExamTransition`) only allows archive from `closed` or `canceled` (after reconciliation). The state machine is more permissive than the route layer.

**Classification**: ACCEPTED_LIMITATION — the state machine defines the full transition space; the route layer restricts it further based on business rules. This is intentional layering, not a defect.

### 7.2 Attempt state machine

**Normative claim**: 8 states, 4 reachable.

**Reality**: CONFIRMED. The transition table in `attemptStateMachine.ts` defines 6 transitions:
- `in_progress:submit → submitted`
- `in_progress:disrupt → disrupted`
- `disrupted:submit → submitted`
- `disrupted:restore → in_progress`
- `submitted:grade → grading`
- `grading:complete_grading → graded`

**Finding**: The `submitted:grade` and `grading:complete_grading` transitions are **unreachable** in the current implementation. `finalizeTerminalGrading()` calls `transition(attempt.status, "grade")` which would move `submitted → grading`, but the closure then immediately writes `status = 'graded'` directly (bypassing the state machine for the second hop). The `grading` state is never persisted to the DB.

**Classification**: ARCHITECTURAL_DEBT — the two-hop `submitted → grading → graded` path is collapsed into a single write. The state machine table is misleading.

### 7.3 Enrollment state machine

**Normative claim**: 4 states (`assigned`, `started`, `completed`, `blocked`).

**Reality**: CONFIRMED. `ENROLLMENT_VALID_TRANSITIONS` matches the normative document.

## 8. Data-Authority Reality

### 8.1 Live Question joins in grading paths

**Audit**: Searched for any grading path that reads from the `questions` table.

**Finding**: NO live Question joins found in grading paths. `aggregateGradingEntries()` reads only `attempt.questionSnapshot` and `attempt_grading_entries`. `computeGradingResult()` (legacy path) reads `attempt.submittedAnswers` or `attempt.answers` + `attempt.questionSnapshot`.

**Status**: NOT_A_PROBLEM — INV-Q-001 and INV-G-001 are upheld.

### 8.2 Mutable submitted answers

**Audit**: Searched for any code path that writes to `submitted_answers` outside the submit transaction.

**Finding**: The only writer of `submitted_answers` is `submitAttempt()` in `attemptCommands.ts`. The backfill script (separate TypeScript tool, not a migration) also writes `submitted_answers` for historical rows, but this is a one-time operation, not a runtime path.

**Status**: NOT_A_PROBLEM — INV-A-002 is upheld at runtime.

### 8.3 Direct status writes outside commands

**Audit**: Searched for any route that directly sets `attempt.status` or `exam.status` without going through a command function.

**Finding**: NO direct status writes found in routes. All status changes go through `examCommands.ts` or `attemptCommands.ts` command functions.

**Status**: NOT_A_PROBLEM — INV-E-001 is upheld.

### 8.4 Direct repository updates bypassing engine protocols

**Audit**: Searched for routes that call repo methods directly instead of through engine commands.

**Finding**: The heartbeat route (`POST /attempts/:attemptId/heartbeat`) calls `attemptRepo.update(ctx, id, { lastActivityAt: now })` directly, bypassing the engine layer. This is a deliberate design choice (heartbeat is a simple timestamp update, not a state transition) but it is a **bypass of the engine protocol layer**.

**Classification**: ACCEPTED_LIMITATION — heartbeat is intentionally a lightweight operation that does not need the full engine protocol.

## 9. Transaction-Boundary Reality

### 9.1 Transactions containing external network IO

**Audit**: Searched for SMTP send or other network IO inside a DB transaction.

**Finding**: NO transactions contain SMTP send. `processDueEmails()` sends SMTP OUTSIDE the claim transaction. The `claimDue()` transaction only does DB reads + updates.

**Status**: NOT_A_PROBLEM — INV-N-001 is upheld.

### 9.2 Audits outside authoritative transactions

**Audit**: Searched for audit writes that should be atomic but are best-effort.

**Finding**: Exam create/update, question CRUD, login/logout, branding updates use **best-effort** (async drain queue) audit. This is intentional per `auditPolicy.ts` durability classification. The critical mutations (exam transitions, submit, grading, enrollment mutations) use **atomic** (in-tx) audit.

**Status**: NOT_A_PROBLEM — durability is explicitly classified.

### 9.3 Email worker crash after provider send

**Audit**: Verified the at-least-once delivery window.

**Finding**: If the worker crashes between `sender.send()` (SMTP success) and `markSent()` (DB update), the row remains `processing`. After the lock timeout, `recoverAbandoned()` resets it to `pending`, and it will be re-sent. This is the documented at-least-once behavior.

**Classification**: ACCEPTED_LIMITATION — duplicates are possible; the normative document acknowledges this.

## 10. Idempotency and Conflict Reality

### 10.1 Save Answer idempotency

**Audit**: Verified the idempotency mechanism.

**Finding**: `processSaveAnswer()` uses `clientSeqMap` (built from `clientSeqHistory` in the JSONB column) for idempotency. Same `(questionId, clientSeq)` + same payload = replay (accepted, no write). Same key + different payload = `CONFLICTING_PAYLOAD`.

**Status**: NOT_A_PROBLEM — INV-A-003 is upheld.

### 10.2 Submit idempotency

**Audit**: Verified the submit freeze barrier.

**Finding**: `submitAttempt()` reads via `findByIdForUpdate` and checks for existing `submitted/grading/graded` status BEFORE the transition assertion. If already frozen, returns the existing snapshot. The workset consistency is validated on re-entry.

**Status**: NOT_A_PROBLEM.

### 10.3 Deadline scanner vs. inline reconciliation

**Audit**: Verified both paths converge.

**Finding**: Both the deadline scanner (`deadlineScanner.ts`) and inline reconciliation (`ensureAttemptDeadlineReconciled()`) call `isAttemptDeadlineExpired()` → `submitAttempt()`. The scanner uses REPEATABLE READ; inline reconciliation runs in the caller's transaction.

**Status**: NOT_A_PROBLEM — both paths converge on the same authority.

## 11. Authorization Reality

### 11.1 Role-name authorization branches

**Audit**: Searched for any authorization decision based on `users.role` or JWT role claim.

**Finding**: NO production authorization decision uses `users.role` or JWT role. All authorization is resolved from `user_role_assignments` via `loadAssignmentAuthority()`. The `requireRole` decorator exists but has **zero production consumers** (confirmed by P4-V0-Gate-0.5 audit).

**Status**: NOT_A_PROBLEM — INV-SEC-001 is upheld.

### 11.2 Unscoped capabilities marked as scoped

**Audit**: Searched for capabilities that claim to be scoped but have no resolver.

**Finding**: The `requireScopedCapability` gate uses a resolver registry (`attempt`, `exam`). All scoped capabilities have a corresponding resolver. No unscoped capabilities are marked as scoped.

**Status**: NOT_A_PROBLEM.

### 11.3 Client-derived security decisions

**Audit**: Searched for any security decision based on client-supplied data.

**Finding**: The candidate's `candidateId` is NEVER trusted from the client. The server derives it from `ctx.actorId` via the candidate profile lookup. Exam eligibility is verified server-side.

**Status**: NOT_A_PROBLEM.

## 12. Security-Boundary Reality

### 12.1 Cross-organization access

**Audit**: Verified org scoping on all repo methods.

**Finding**: All repository methods filter by `ctx.organizationId`. The `baseRepo.ts` generic CRUD enforces this. The organization repo itself is cross-tenant (no org filter).

**Status**: NOT_A_PROBLEM.

### 12.2 Cross-Candidate attempt access

**Audit**: Verified the anti-enumeration behavior.

**Finding**: `requireOwnAttempt` returns 404 (not 403) for cross-candidate probes. The error message is generic.

**Status**: NOT_A_PROBLEM — INV-SEC-002 is upheld.

### 12.3 Standard-answer leakage

**Audit**: Verified candidate-facing projections.

**Finding**: `CandidateTakeSnapshotSchema` (Zod) does not include `standardAnswer` or `rubric`. The `toCandidateAttemptResponse` serializer strips these fields. The `CandidateQuestionSnapshotSchema` omits them.

**Status**: NOT_A_PROBLEM — INV-R-001 is upheld.

## 13. Frontend Projection Reality

### 13.1 Frontend consumes derived capabilities

**Audit**: Verified the frontend does not reconstruct business rules.

**Finding**: `deriveTakeExamView(snapshot)` is a pure function that derives ALL UI state from the backend `CandidateTakeSnapshot`. The frontend NEVER reconstructs `isEditable`, `canSave`, `canSubmit` from raw DB state. The `transientReducer` owns only short-lived UI phases (idle/saving/submitting).

**Status**: NOT_A_PROBLEM — the frontend is a pure projection.

### 13.2 Status authority

**Audit**: Verified the frontend uses `statusMeta` for all domain status presentation.

**Finding**: `StatusBadge` looks up `getStatusMeta(status)` for all domain statuses. The `statusMeta` registry covers ~40 status keys. No hardcoded status colors in business pages.

**Status**: NOT_A_PROBLEM (lint-enforced for high-confidence boundaries).

## 14. Worker and Asynchronous-Boundary Reality

### 14.1 Email worker liveness

**Audit**: Verified the heartbeat mechanism.

**Finding**: `worker_heartbeats` table records each poll cycle. The API diagnostics surface (`GET /api/system/diagnostics`) reads these to determine liveness. No Redis or process-local shared state.

**Status**: NOT_A_PROBLEM.

### 14.2 Heartbeat scanner

**Audit**: Verified the scanner marks disrupted attempts.

**Finding**: The scanner plugin runs `setInterval` every 30s. It iterates all organizations, lists in-progress attempts, and marks stale ones as `disrupted` via `markDisrupted()` (which uses `transition(status, "disrupt")` from the state machine).

**Status**: NOT_A_PROBLEM.

### 14.3 Deadline scanner

**Audit**: Verified the scanner auto-submits expired attempts.

**Finding**: The deadline scanner plugin runs every 30s. It discovers candidates via `listDeadlineCandidates()` (a DERIVED predicate), then makes the authoritative expiry decision under `Attempt FOR UPDATE` + `Exam FOR UPDATE` via `isAttemptDeadlineExpired()`. It calls `submitAttempt()` (source `deadline_scanner`, reason `deadline`) + `gradeAttemptIdempotent()`.

**Status**: NOT_A_PROBLEM.

## 15. Documentation Drift

### 15.1 SPEC.md vs. implementation

**Finding**: SPEC.md §2.2 describes the attempt state machine as "long-term goal design" and provides a table of current wiring. This is consistent with the implementation. However, SPEC.md §3.3 describes `voidAttempt` as "Phase 3 / planned" — the code confirms there is no `voidAttempt` command in `attemptCommands.ts`.

**Classification**: DOCUMENTATION_DRIFT — SPEC.md §3.3 lists `voidAttempt` as a command function, but it does not exist in the current code. The normative document correctly identifies this as "target design only."

### 15.2 CONTEXT.md vs. implementation

**Finding**: CONTEXT.md describes the `completeManualGrading` command as historical/non-existent. The code confirms the one-way manual completion command is `gradeQuestion`. This is consistent.

### 15.3 ADR-008 vs. implementation

**Finding**: ADR-008 describes the submit freeze barrier. The implementation in `submitAttempt()` follows the ADR's Option D (single-transaction submit + grade). The ADR mentions "WYSIWYG submit" as a follow-up — this is NOT IMPLEMENTED.

**Status**: NOT_A_PROBLEM — the ADR's follow-up is explicitly out of scope.

## 16. Missing Tests

| Area | Test coverage | Gap |
|------|--------------|-----|
| Save Answer idempotency | Unit tests for `processSaveAnswer()` | Integration test for concurrent save + submit is missing |
| Submit freeze barrier | Unit tests for `submitAttempt()` | E2E test for crash recovery (submit lands, grading doesn't) is missing |
| Deadline reconciliation | Unit tests for `ensureAttemptDeadlineReconciled()` | Integration test for concurrent deadline scanner + candidate save is missing |
| Manual grading terminality | Unit tests for `gradeQuestion()` | Integration test for concurrent grading of the last manual question is missing |
| Email worker claim | Unit tests for `claimDue()` | Integration test for concurrent workers is missing |
| Cross-candidate access | E2E test for anti-enumeration | Unit test for 404 vs 403 is missing |

## 17. Missing Constraints

| Constraint | Location | Status |
|------------|----------|--------|
| `exam.totalScore = SUM(questionSnapshot.score)` | DB level | **MISSING** — enforced only by `publishExam()` |
| `attempt.submittedAnswers` immutability | DB level | **MISSING** — enforced only by code (no trigger or constraint) |
| `attempt.gradingResult` is a projection | DB level | **MISSING** — no constraint prevents it from being used as input |
| `question` deletion guard against snapshot references | DB level | **MISSING** — no FK or trigger |

## 18. Architectural Defects

### 18.1 `grading` state is dead code

**Finding**: The `grading` attempt status has transition table entries (`submitted:grade → grading`, `grading:complete_grading → graded`) but is never persisted. `finalizeTerminalGrading()` writes `status = 'graded'` directly.

**Impact**: The state machine table is misleading. A reader of `attemptStateMachine.ts` might believe `grading` is a reachable state.

**Classification**: ARCHITECTURAL_DEBT

### 18.2 `hasSubjectiveQuestions` is deprecated but still exported

**Finding**: `gradingEngine.ts::hasSubjectiveQuestions()` is marked `@deprecated` but still exported and could be consumed by legacy code. The canonical classifier is `requiresManualGrading()`.

**Impact**: Low — the deprecation is clearly documented. But the function still exists and could be misused.

**Classification**: ARCHITECTURAL_DEBT

### 18.3 `computeGradingResult` is used for partial-score response only

**Finding**: `grading.ts::computeGradingResult()` is used in `gradeAttemptIdempotent()` to return a partial auto-graded score for `pending_manual` attempts. The doc comment explicitly states this is a "RESPONSE shape only (never persisted)" and "does NOT flow into terminal persistence." However, this is the one remaining use of `computeGradingResult` in the grading pipeline, and it reads from `attempt.submittedAnswers` (or falls back to `attempt.answers` for legacy rows).

**Impact**: The fallback to `attempt.answers` for legacy rows with NULL `submitted_answers` is a migration-window accommodation (TODO P3-L0-4). Once the backfill is complete, this fallback should be removed.

**Classification**: ACCEPTED_LIMITATION (migration window)

## 19. Accepted Limitations

1. **Email at-least-once delivery**: Duplicates possible on worker crash. Accepted by design.
2. **No question deletion guard**: Snapshots are copies, so historical attempts are safe, but the question bank loses the source.
3. **No DB-level constraint on totalScore**: Enforced only by `publishExam()`.
4. **Heartbeat bypasses engine layer**: Direct repo update, accepted for performance.
5. **`grading` state is dead code**: No write path, but transition table entries exist.
6. **Email has no business caller**: Outbox + worker exist but are never invoked by production routes.
7. **Notification Inbox not implemented**: Only the email channel exists.
8. **Disrupted recovery UI not productized**: Backend capability exists; frontend restore flow is incomplete.

## 20. Future Capabilities

| Capability | Phase | Dependency |
|------------|-------|------------|
| Notification Inbox + result-published Email | P5-N1 | P5-0 |
| Email delivery runtime hardening | P5-0 | P4 |
| Result publishing closeout (E2E) | P3 | P5-0 |
| WYSIWYG submit final-answer barrier | P3 | |
| Staff invitation + password reset | P3 | |
| Resource-relationship auth (M11) | Phase 3 | |
| IP/CIDR examination restrictions | Phase 2+ | |
| Question version table | Future | |
| Explicit Paper aggregate | Future | |
| Multi-tenant | Phase 4 | |

## 21. Overdesign Risks

| Risk | Assessment |
|------|------------|
| `ReconciledAttemptMutationContext` opaque evidence | Justified — the complexity is necessary to prove transaction affinity across the EA lock seam. The branded-symbol pattern prevents forgery. |
| `LockedEnrollmentAttemptIdentity` with dual private symbols | Justified — prevents mint bypass. The repo-affinity assertion is the correctness authority. |
| Three-state durability for audit | Justified — atomic vs. best-effort is explicitly classified per action. |
| `client_events` separate from `audit_logs` | Justified — different concerns (observability vs. compliance). |

## 22. Gap Register

See [ARCH-R0-EXAM-SYSTEM-GAP-REGISTER.md](./ARCH-R0-EXAM-SYSTEM-GAP-REGISTER.md) for the detailed gap register.

## 23. Recommended Next Jobs

| Job | Priority | Scope |
|-----|----------|-------|
| **ARCH-R1: Remove dead `grading` state transitions** | P2 | Clean up `attemptStateMachine.ts` to remove unreachable `submitted:grade → grading` and `grading:complete_grading → graded` entries, or document them as reserved. |
| **ARCH-R2: Add DB-level invariant constraints** | P2 | Add a trigger or check constraint for `exam.totalScore = SUM(questionSnapshot.score)` (if feasible with JSONB). Add a trigger to prevent `submitted_answers` mutation after submit. |
| **ARCH-R3: Integration test for concurrent save + submit** | P2 | Prove the submit freeze barrier under concurrent load. |
| **ARCH-R4: Integration test for concurrent email workers** | P3 | Prove `FOR UPDATE SKIP LOCKED` claim correctness. |
| **ARCH-R5: Remove `hasSubjectiveQuestions` export** | P3 | After confirming no consumers, remove the deprecated export. |
| **P5-0: Email delivery runtime hardening** | Queued | Target state machine, `FOR UPDATE SKIP LOCKED` claim, abandoned-lock recovery, worker build/start, PostgreSQL heartbeat. |
| **P5-N1: Notification Inbox + result-published Email** | Queued | `notifications` table, `NotificationService`, business caller integration. |
