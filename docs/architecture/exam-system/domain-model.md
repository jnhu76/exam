# Domain and Aggregate Model

> Normative description of the exam system's core domain objects, their classification, ownership, and relationships.

```text
Last verified against commit:
cac6b85c425c85ad4077002bc518fca0b50f766f

Verification scope:
Current master implementation after merged P5-0 / PR #210.
```

## 1. System Purpose

The exam platform is a configurable LAN/on-premise assessment system. Its core domain supports: authoring reusable questions, composing them into exams, enrolling candidates, executing timed attempts, saving and submitting answers, grading (automatic and manual), and publishing results.

Phase 1 is single-tenant (one internal default organization). All business data carries `organizationId` from that default organization.

## 2. Actor Model

| Actor | Source of Authority | Phase |
|-------|---------------------|-------|
| Admin | `user_role_assignments` with Admin preset | Phase 1 product role |
| Candidate | `user_role_assignments` with Candidate preset | Phase 1 product role |
| Teacher | `user_role_assignments` with Teacher preset | Phase 3 infrastructure / Phase 3 product role |
| Proctor | `user_role_assignments` with Proctor preset | Phase 3 infrastructure |
| Grader | `user_role_assignments` with Grader preset | Phase 3 infrastructure |
| System | Synthetic actor (`system:deadline-scanner`, `system:heartbeat`) | Phase 2 infrastructure |

**Critical rule**: Authorization is resolved from **active `user_role_assignments` rows** at request time, never from `users.role` or JWT role claims (those are compatibility projections only).

### 2.1 Teacher capability scope gap

Teacher has the following relevant capabilities (from `packages/authz/src/presets.ts`):

```text
question.create, question.update, question.delete, question.import
course.view, course.create, course.update
exam.view, exam.create, exam.update, exam.publish, exam.close
exam.enrollment.manage, exam.result.publish
score.all.view
```

**Scope status**: Teacher's `course.create`, `course.update`, `exam.create`, `exam.update`, `exam.publish`, `exam.close`, `exam.enrollment.manage`, `exam.result.publish`, and `score.all.view` are marked scoped in the preset matrix, but the scoped resolver infrastructure (Teacher@course) is **NOT IMPLEMENTED**. Teacher permissions are currently flat org-wide. This is a **known Teacher resource-scope gap** (future M11 work).

## 3. Aggregate Catalog

### 3.1 Classification methodology

Each object is classified by its actual consistency ownership:

- **Aggregate root**: Can be mutated independently through a business command; defines its own consistency boundary.
- **Child entity**: Lifecycle owned by a parent aggregate; mutated only through the parent.
- **Embedded value**: Immutable copy stored inside a parent; no independent identity.
- **Projection**: Derived data regenerated from authoritative sources; never consumed as input.
- **Infrastructure record**: Durable record owned by a background process or cross-cutting concern.

A row with an ID and repository is **not** automatically an aggregate root. The test is: can it be mutated independently through a business command?

### 3.2 Catalog

| Object | Classification | Authority | Mutable until | Frozen at | Consumers |
|--------|---------------|-----------|---------------|-----------|-----------|
| Organization | Aggregate root | `organizations` table | Always mutable | Never | All tenant-scoped operations |
| User | Aggregate root | `users` table | Always mutable | Never | Auth, authorization |
| Candidate | Aggregate root | `candidate_profiles` table | Always mutable | Never | Enrollment, attempt ownership |
| Course | Aggregate root | `courses` table | Always mutable | Never | Question/Exam grouping |
| Question | Aggregate root | `questions` table | Always mutable (until deletion) | N/A | Exam composition, grading reference |
| QuestionSnapshot | Embedded value | `exam.questionSnapshot` / `attempt.questionSnapshot` | Never (immutable copy) | Exam publish / Attempt start | Grading, result computation |
| Exam | Aggregate root | `exams` table | Draft state only | Publish (partial fields freeze) | Candidate enrollment, attempt creation |
| ExamEnrollment | Child entity of Exam | `exam_enrollments` table | Attempt lifecycle | Completion | Retake policy, final score selection |
| ExamAttempt | Aggregate root | `exam_attempts` table | In-progress state | Submit (answers freeze) | Grading, result projection |
| AnswerRecord | Embedded value | `exam_attempts.answers` JSONB | In-progress state | Submit (copied to submittedAnswers) | Grading input |
| SubmittedAnswersSnapshot | Embedded value | `exam_attempts.submitted_answers` JSONB | Never (written once) | Submit freeze barrier | Grading authority, result computation |
| AttemptGradingEntry | Child entity of Attempt | `attempt_grading_entries` table | Created at submit; updated during manual grading | Terminal status | Grading queue, terminal aggregation |
| gradingResult | Projection | `exam_attempts.gradingResult` JSONB | N/A | N/A | Result display |
| ScoreResult | Projection | Computed from AttemptGradingEntry | N/A | N/A | Result display |
| AuditLog | Infrastructure record | `audit_logs` table | Never (append-only) | Write time | Compliance, timeline |
| EmailOutbox | Infrastructure record | `email_outbox` table | Pending → terminal | Terminal (`sent` / `dead`) | Email delivery |
| WorkerHeartbeat | Infrastructure record | `worker_heartbeats` table | Always mutable | Never | Worker liveness diagnostics |

### 3.3 Aggregate ownership rules

1. **ExamEnrollment** is a child entity of Exam. Its lifecycle is bounded by the exam: it is created when a candidate is enrolled, transitions when attempts are made, and completes when the exam window closes or retake policy is exhausted. It is always mutated in the same transaction as the attempt or exam operation that affects it.

2. **AttemptGradingEntry** is a child entity of Attempt. It is created at submit-freeze time (inside the submit transaction), updated by manual grading, and read by terminal aggregation. It cannot exist without its parent attempt.

3. **gradingResult** (on ExamAttempt) is a projection. It is regenerated from AttemptGradingEntries at terminal closure. It is never read as scoring input.

4. **AuditLog** and **WorkerHeartbeat** are infrastructure records — append-only, no business lifecycle, mutated by background processes or cross-cutting audit writes.

## 4. Question Model

### 4.1 Question (live authoring entity)

- **Identity**: `questions.id` (UUID, app-generated)
- **Owner**: Aggregate root, scoped by `organizationId`
- **Mutable fields**: `content`, `options`, `standardAnswer`, `rubric`, `score`, `difficulty`, `tags`, `gradingRule`, `attachments`
- **Immutable fields**: `id`, `organizationId`, `courseId`, `type`, `createdAt`
- **Creation command**: Question create route (`POST /api/questions`)
- **Mutation commands**: Question update route (`PATCH /api/questions/:id`)
- **Deletion**: Question delete route (`DELETE /api/questions/:id`) — **ACCEPTED LIMITATION**: no referential integrity guard against deletion of questions referenced by existing snapshots (snapshots are copies, so deletion does not break historical attempts)

### 4.2 Question is a live mutable authoring entity until deletion

Question has **no lifecycle state field**. It is always mutable while it row-exists. Snapshot creation freezes the **copy**, not the live source row. The live `questions` row remains mutable even after one or more snapshots have been created.

### 4.3 Question versions

Question has **NO version table**. Edits mutate the row in place. Historical fidelity is preserved not by question versions but by **QuestionSnapshot** — copies made at exam publish time (exam-level snapshot) and attempt start time (attempt-level snapshot).

### 4.4 standardAnswer and rubric protection

- `questions.standardAnswer` is the authoring source. It is copied into `QuestionSnapshot.standardAnswer` at snapshot creation.
- `questions.rubric` (P3-L0-1 dual-layer) is the authoring source for manual grading guidance. It is copied into `QuestionSnapshot.rubric` at snapshot creation.
- **Grading paths MUST read from the snapshot, never JOIN the live `questions` table.** This is the invariant that prevents live question edits from affecting in-progress or completed attempts.

## 5. Paper Classification

### 5.1 Paper is currently an implicit or embedded composition concept

**Evidence from code and schema:**

- There is **no `papers` table** in the database schema.
- There is **no `Paper` type** in `packages/domain/src/types.ts`.
- There is **no `PaperRepository`** or paper-specific command functions.
- The `Exam` entity carries `questionIds: string[]` (ordered list) and `questionSnapshot: QuestionSnapshot[]` (frozen copy).
- The `ExamAttempt` entity carries its own `questionSnapshot: QuestionSnapshot[]` (copied from exam at attempt start).

**Classification**: **C — a derived concept represented by `exam.questionSnapshot` (exam-level) and `attempt.questionSnapshot` (attempt-level).**

### 5.2 Composition authority

Composition authority lives on the `Exam` aggregate:
- `exam.questionIds` defines which questions are in what order.
- `exam.questionSelectionMode` is `manual` (Phase 1) or `random` (Phase 2 planned).
- `exam.questionSnapshot` is the frozen copy built at publish time by `publishExam()` → `buildQuestionSnapshot()`.

### 5.3 Reuse between Exams

Composition **cannot be reused between exams** in the current implementation. Each exam carries its own embedded snapshot. Copying questions between exams requires manual re-selection.

### 5.4 Total score

`exam.totalScore` is an independently writable field, but `publishExam()` enforces that it MUST equal the sum of `questionSnapshot.score`. This is a publish-time invariant enforced at the application layer, not a database constraint.

### 5.5 Decision boundary for a future Paper aggregate

The following evaluation criteria are recorded for future consideration only (NOT authorization to implement):

- Would multiple Exams reuse one versioned composition?
- Would Paper require independent review or approval?
- Would Paper exist before scheduling an Exam?
- Would Paper need independent retirement/versioning?

## 6. Exam Model

### 6.1 Core entity

- **Identity**: `exams.id` (UUID)
- **Owner**: Aggregate root, scoped by `organizationId`
- **State machine**: `draft → published → open → closed → archived` (+ `canceled` branch)

### 6.2 Fields that freeze at publish

The following fields are written by `publishExam()` and MUST NOT change after publish (enforced by route-layer guards, not DB constraints):

| Field | Frozen at publish? | Notes |
|-------|-------------------|-------|
| `questionSnapshot` | Yes | Built by `buildQuestionSnapshot()` |
| `questionIds` | Yes | Validated against snapshot |
| `totalScore` | Yes | Must equal sum of question scores |
| `passingScore` | Yes | Must be ≤ totalScore |
| `durationMinutes` | Yes | Must be positive |
| `timingMode` | Yes | Phase 1: `timed_window` only |
| `questionSelectionMode` | Yes | Phase 1: `manual` only |
| `controlFlags` | Yes | All flags |
| `retakePolicy` | Yes | Phase 1: `unlimited`, `max_attempts`, `pass_then_stop` |
| `scoreStrategy` | Yes | `highest`, `latest`, `first` |
| `maxAttempts` | Yes | |
| `resultPublicationMode` | Yes | `immediate`, `after_grading`, `manual` |

### 6.3 Fields that remain mutable after publish

| Field | Mutable until | Notes |
|-------|--------------|-------|
| `status` | Archived | All transitions via command functions |
| `openAt` | `now >= openAt` | Only in `published` state (route guard) |
| `closeAt` | Archived | Only via `extendExam()` in `open` state |
| `resultsPublishedAt` | Write-once | Set by `publishResults()`, idempotent |

### 6.4 Fact timestamps (not states)

| Field | Meaning | Set by |
|-------|---------|--------|
| `resultsPublishedAt` | When an admin first published results for a manual-mode exam | `publishResults()` — write-once, never updated |

### 6.5 Policy fields

| Field | Type | Effect |
|-------|------|--------|
| `retakePolicy` | `unlimited` / `max_attempts` / `pass_then_stop` | Controls whether a candidate may start a new attempt |
| `scoreStrategy` | `highest` / `latest` / `first` | Selects which attempt's score becomes the enrollment final score |
| `resultPublicationMode` | `immediate` / `after_grading` / `manual` | Controls when candidates see results |
| `latestStartOffsetMinutes` | integer or null | Late-entry cutoff offset from `openAt` |
| `minSubmitAfterStartMinutes` | integer or null | Minimum duration before a candidate may submit |

## 7. Enrollment Model

### 7.1 Core entity

- **Identity**: `exam_enrollments.id` (UUID)
- **Classification**: Child entity of Exam (lifecycle bounded by exam)
- **Unique constraint**: `(organizationId, examId, candidateId)` — one enrollment per candidate per exam
- **State machine**: `assigned → started → completed` (+ `blocked` branch)

### 7.2 Authority

- **Eligibility**: An enrollment row grants a candidate eligibility to take the exam. Without an enrollment, a candidate cannot start attempts.
- **Attempt limits**: `attemptCount` tracks attempts used. `retakePolicy` on the exam determines whether a new attempt is allowed.
- **Final score selection**: `finalScore`, `finalPassed`, `finalAttemptId` are computed by `finalizeTerminalGrading()` using the exam's `scoreStrategy`.

### 7.3 Concurrent attempt start

`startOrRestoreAttempt()` acquires the enrollment row via `findByExamAndCandidateForUpdate` (FOR UPDATE) before creating a new attempt. This serializes concurrent attempt starts for the same enrollment.

## 8. Attempt Model

### 8.1 Core entity

- **Identity**: `exam_attempts.id` (UUID)
- **Owner**: Aggregate root, scoped by `organizationId`
- **Unique constraint**: `(organizationId, enrollmentId, attemptNo)`
- **State machine**: `in_progress → disrupted | submitted → graded | voided` (reachable states)

### 8.2 Reachable vs. designed states

| Status | Reachable? | Write path |
|--------|-----------|------------|
| `not_started` | **NO** | No write path — attempt goes directly to `in_progress` on start |
| `queued` | **NO** | Phase 2 planned (timed_sync queue admission) |
| `in_progress` | YES | `startOrRestoreAttempt()`, `restoreInterruptedAttempt()` |
| `disrupted` | YES | Heartbeat scanner (`markDisrupted`) |
| `submitted` | YES | `submitAttempt()`, deadline reconciliation |
| `grading` | **NO** | No write path — `finalizeTerminalGrading()` writes `graded` directly, bypassing the `grading` state. The state machine table has `submitted:grade → grading` entries but they are unreachable. |
| `graded` | YES | `finalizeTerminalGrading()` |
| `voided` | **NO** | Target design only — no admin/proctor entry point |

### 8.3 The two-column answer model

| Column | Purpose | Writable when | Frozen when |
|--------|---------|---------------|-------------|
| `answers` (JSONB) | Draft work-in-progress answers | `in_progress` | Submit (copied to `submittedAnswers`) |
| `submitted_answers` (JSONB) | Frozen snapshot for grading | Written once at submit | Submit freeze barrier (immutable) |

### 8.4 Draft answer versioning

Each `AnswerRecord` in `answers` carries a monotonic `version` field. The Save Answer protocol uses `baseVersion` for optimistic concurrency: a save with `baseVersion < currentVersion` is rejected as `STALE_VERSION`.

Idempotency is tracked by `clientSeq`: the pair `(questionId, clientSeq)` is stored in `clientSeqHistory` and checked for replay. Same key + same payload = idempotent replay (accepted, no write). Same key + different payload = `CONFLICTING_PAYLOAD`.

### 8.5 Submitted answer authority

`submitted_answers` is authoritative for grading. It is:
1. Built by `buildSubmittedAnswersSnapshot()` — normalizes draft `answers` against the question snapshot, strips protocol metadata.
2. Written once in the submit transaction.
3. Never modified after submit.
4. Read exclusively by grading and result paths.

### 8.6 Save vs. Submit concurrency

The submit freeze barrier (`submitAttempt()`) reads the attempt via `findByIdForUpdate` (FOR UPDATE). This serializes the submit against concurrent `saveAnswer` operations. A save that arrives after the submit lock is acquired will see the attempt in `submitted` state and be rejected as `ATTEMPT_ALREADY_SUBMITTED`.

### 8.7 Deadline reconciliation

Lazy-triggered at candidate entry points (`/take`, save, submit, resume) via `ensureAttemptDeadlineReconciled()`. No background worker, no scheduled scan.

Trigger: `attemptStatus in (in_progress, disrupted) AND now >= effectiveDeadline`, where `effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)`.

Behavior: freezes draft answers into `submitted_answers`, sets `submittedAt = effectiveDeadline`, `submissionReason = 'deadline'`, then grades. Idempotent — repeated calls do not overwrite existing `submitted_answers`.

### 8.8 Recoverable states

- `disrupted` → `in_progress`: via `restoreInterruptedAttempt()` (applies the interruption-time policy, writing a `bounded_grace` adjustment only when the policy grants one; operator grants are a separate `grantAttemptTime()` command).
- `in_progress` → `in_progress`: via `saveAnswer()` (while not expired).

Once `submitted`/`graded`, the attempt is terminal — no recovery path (except `voided`, which is target design).

## 9. Grading Model

### 9.1 Automatic grading authority

`gradeQuestion()` in `packages/domain/src/gradingEngine.ts` is the single authority for per-question auto-grading. It dispatches by `QuestionType`:

| Type | Rule |
|------|------|
| `single_choice` / `true_false` | Exact match against `standardAnswer` |
| `multiple_choice` | All-correct = full; partial (subset, no wrong) = half (if `partial_half`); any-wrong = zero |
| `fill_blank` | Exact or keyword match (configurable), case-sensitivity configurable |
| `text_response` | NOT auto-graded — returns zero-score placeholder |

### 9.2 Manual grading authority

`gradeQuestion()` in `packages/exam-engine/src/manualGrading.ts` is the single authority for per-question manual scoring. It:
1. Validates `attempt.status === 'submitted'` and `attempt.gradingStatus === 'pending_manual'`.
2. Reads the materialized `AttemptGradingEntry` (the sole manual-work authority).
3. Validates `entry.gradingMode === 'manual'` and `entry.status === 'pending_manual'`.
4. Updates the SAME entry: `pending_manual → completed_manual`.
5. When the last manual entry is completed, delegates to `finalizeTerminalGrading()`.

### 9.3 Materialized grading workset

`attempt_grading_entries` is the **single durable grading truth**:
- Created at submit-freeze time by `materializeGradingWorkset()` — one row per frozen question.
- Manual grading queue reads `WHERE grading_mode = 'manual' AND status = 'pending_manual'`.
- Terminal aggregation reads all completed entries via `aggregateGradingEntries()`.
- `attempt.gradingResult` is a **denormalized projection** generated from these entries — never consumed as scoring input.

### 9.4 Terminal grading command

`finalizeTerminalGrading()` is the **single canonical terminal grading closure** (P3-FORMAL-P0-A). It:
1. Validates the workset is fully terminal (all entries `completed_auto` or `completed_manual`).
2. Writes `attempt.status = 'graded'`, `score`, `passed`, `gradingResult`, `gradedAt`.
3. Updates `enrollment` final score via `shouldSelectAttempt()` (score strategy).

**Idempotent**: if `attempt.status === 'graded'`, returns `false` (no-op).

### 9.5 Can terminal grading be repeated?

No. Once `attempt.status === 'graded'`, `finalizeTerminalGrading()` returns `false`. The transition guard rejects `graded → grade`. Manual grading of a `completed_manual` entry is rejected.

### 9.6 Can live Question edits change grading?

**No.** Grading reads exclusively from the frozen `QuestionSnapshot` (via `submittedAnswers` + `questionSnapshot` on the attempt). Live `questions` table edits do not affect existing attempts.

## 10. Result Model

### 10.1 Result is a projection, not a stored entity

There is **no `results` table**. The result is a projection computed from:
- `exam_attempts.score`, `passed`, `gradingResult` (terminal attempt state)
- `exam.resultPublicationMode`, `resultsPublishedAt` (visibility policy)
- `exam_attempts.submittedAnswers` (for answer visibility)

### 10.2 What makes a result ready?

A result is computable when the attempt reaches terminal grading:
- `gradingStatus === 'auto_graded'` (pure-objective attempt, graded at submit)
- `gradingStatus === 'fully_graded'` (all manual scoring complete)

### 10.3 What makes a result visible?

Visibility is the AND of "result computable" and "publish policy satisfied":

| `resultPublicationMode` | Visible when |
|------------------------|--------------|
| `immediate` | Result computable (auto_graded or fully_graded) |
| `after_grading` | `gradingStatus === 'fully_graded'` |
| `manual` | `resultsPublishedAt IS NOT NULL` AND result computable |

### 10.4 Candidate answer-key visibility

Under the current MVP contract (`apps/api/src/routes/attempts.shared.ts`):

```text
CandidateTakeSnapshot.computeAnswerVisibility() always returns "hidden".
CandidateTakeSnapshot and candidate attempt serializers never include standardAnswer or rubric.
Result own-view strips standardAnswer unconditionally.
Rubric is absent from the Candidate result contract.
```

**INV-R-001**: Under the current MVP contract, Candidate-facing Attempt and Result projections MUST NOT expose `standardAnswer` or `rubric`. `answerVisibility` is currently fixed to hidden. A future configurable answer-key release policy is **NOT IMPLEMENTED**.

### 10.5 Candidate vs. all-view actors

| Field | Candidate view | Admin/Teacher view |
|-------|---------------|-------------------|
| `score` | Only if result visible | Always (if graded) |
| `passed` | Only if result visible | Always (if graded) |
| `standardAnswer` | **Never** (fixed hidden) | Always (in grading detail) |
| `rubric` | **Never** (absent from contract) | Always (in grading detail) |
| `gradingResult` | Only if result visible | Always (if graded) |

### 10.6 Manual publication command

`publishResults()` sets `exam.resultsPublishedAt` (write-once, idempotent). Allowed from `published | open | closed`. Does NOT advance grading — if grading is still pending, the result stays hidden.

### 10.7 Repeated/concurrent publication

`publishResults()` is idempotent: if `resultsPublishedAt` is already set, returns `{ exam, alreadyPublished: true }` without updating. The route layer detects this to suppress duplicate audit.

## 11. Notification and Email Infrastructure

### 11.1 Email outbox infrastructure primitive (IMPLEMENTED)

- **Identity**: `email_outbox.id` (UUID)
- **State machine**: `pending → processing → sent | retry_wait → processing → ... | dead`
- **Classification**: Infrastructure record (durable queue)
- **Owner**: Background worker process, scoped by `organizationId`

### 11.2 Email worker (IMPLEMENTED)

- Standalone Node process (`apps/api/src/workers/emailDeliveryWorker.ts`).
- Poll loop: `recoverAbandoned` → `processDueEmails` → heartbeat → sleep.
- Claim: atomic CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE RETURNING`.
- Send: OUTSIDE the claim transaction (SMTP never inside a DB transaction).
- Retry: exponential backoff (`baseSeconds * 2^(attempts-1)`).
- Terminal: `sent` (success) or `dead` (max attempts exceeded).

### 11.3 Email delivery semantics

- Ownership fencing prevents a stale/lost worker from updating delivery state; it does **NOT** guarantee exactly-once SMTP delivery.
- A crash after provider acceptance but before `markSent` may cause duplicate delivery.
- Current semantic is **at-least-once**.

### 11.4 Business notification-to-outbox protocol (NOT IMPLEMENTED)

No production business transaction currently inserts an outbox row atomically. The infrastructure primitives (table, repo, service, worker) exist, but the business protocol that enqueues notification emails is **NOT IMPLEMENTED**. This is the P5-N1 scope.

### 11.5 Notification Inbox (NOT IMPLEMENTED)

There is no `notifications` table, no `NotificationService`, and no business caller that enqueues notifications.

## 12. Audit and Observability

### 12.1 AuditLog

- **Identity**: `audit_logs.id` (UUID)
- **Classification**: Infrastructure record (append-only compliance log)
- **Immutable**: Yes — written once, never updated
- **Fields**: `actorId`, `action`, `targetType`, `targetId`, `metadata`, `ipAddress`, `userAgent`, `createdAt`

### 12.2 Durability tiers

| Tier | Mechanism | Used for |
|------|-----------|----------|
| Atomic | Written inside the caller's transaction | Exam transitions, submit, force-submit, grading, enrollment mutations |
| Synchronous sensitive read | Written synchronously (not in tx) | Attempt export, grading detail view, score export |
| Best-effort | Async drain queue (`fastify.auditWrites.schedule`) | Login/logout, create/update operations, branding |

### 12.3 Client events

`client_events` is a separate table for frontend observability telemetry. Deliberately separate from `audit_logs` (compliance). Server-stamped `organizationId`, `userId`, `receivedAt`.

## 13. Aggregate Ownership Rules

1. **All business tables carry `organizationId`**. Every repository method receives `ctx` and filters by `ctx.organizationId`.
2. **No bare SQL in routes**. All DB access goes through `repo.method(ctx, ...)`.
3. **All state changes go through command functions**. Direct status mutation in routes is forbidden.
4. **The engine layer has no transaction boundaries**. Transaction composition is owned by the API route layer.
5. **Row-lock ordering**: Enrollment → Attempt → Exam (to avoid deadlock).
6. **The `LockedEnrollmentAttemptIdentity` capability** is an opaque witness that the canonical lock protocol ran. It is threaded through submit, grade, and deadline reconciliation.
7. **ExamEnrollment** is always mutated inside the same transaction as its parent attempt or exam operation.
8. **AttemptGradingEntry** is always created inside the submit transaction and updated inside the grading transaction.

## 14. Explicitly Absent Aggregates

| Aggregate | Status | Notes |
|-----------|--------|-------|
| Paper | **Implicit/embedded** | Composition is `exam.questionSnapshot` |
| Result | **Projection** | No table; computed from attempt + exam |
| Notification | **NOT IMPLEMENTED** | No table, no service |
| ExamRoom | **NOT IMPLEMENTED** | Phase 2 planned |
| QuestionVersion | **NOT IMPLEMENTED** | Snapshots serve this role |
| Incident | **IMPLEMENTED (J3, in review on PR)** | ADR-014 (ACCEPTED) froze the aggregate, lifecycle, and relationships; J3 (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`) implements the tables, commands, Admin API, and audit; see [incident-authority.md](./incident-authority.md). Recovery Center UI (J5), Proctor scope (J4/M11), and system incidents are NOT IMPLEMENTED |

## 15. Accepted Limitations

1. **Question deletion**: No referential integrity guard against deleting questions referenced by existing snapshots. Snapshots are copies, so historical attempts are not broken, but the question bank loses the source.
2. **No question lifecycle**: Questions are always mutable (no publish/archive state).
3. **Disrupted recovery UI (candidate side)**: **IMPLEMENTED** (REC-I3, PR #219) — the candidate-facing restore flow (`useAttemptRestore()`, restoring/failed/retry surface, authoritative snapshot reload) is live. What remains open is the **operator/proctor** side: the operator time-grant route/permission is implemented (REC-I4-I3B2 CLOSED); the incident authority Admin runtime is implemented (J3 `REC-I6-I1`, in review on PR — see [incident-authority.md](./incident-authority.md)); a dedicated recovery center is not implemented (REC-OPS J5/J6), and Proctor incident scope (J4/M11) is not implemented. (P6 closed before REC-I3 landed, so older audits list this as not-productized — that is frozen history.)
4. **Email business caller**: **IMPLEMENTED** — the `result_published` publication (P5-N1, CLOSED, PR #213) is the first production caller; additional operational notification types remain P5-N2+ scope.
5. **Notification Inbox**: **IMPLEMENTED** (P5-N1, CLOSED, PR #213) for `result_published`; additional operational notification types remain P5-N2+ scope.
6. **`grading` attempt status**: No write path — auto-graded attempts go directly from `submitted` to `graded`. State machine table entries for `grading` are unreachable.
7. **`not_started` / `queued` / `voided`**: No write path — target design only.
8. **Teacher resource scope**: Teacher has capabilities but scoped authorization (Teacher@course) is NOT IMPLEMENTED — currently flat org-wide.
9. **Candidate answer-key visibility**: Fixed to hidden. Configurable release is NOT IMPLEMENTED.
