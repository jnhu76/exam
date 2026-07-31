# Data Authority and Transaction Model

> Normative description of what data is authoritative, who writes it, when it becomes immutable, and which transaction boundaries protect those transitions.

```text
Last verified against commit:
cac6b85c425c85ad4077002bc518fca0b50f766f

Verification scope:
Current master implementation after merged P5-0 / PR #210.
```

## 1. Definition of Authoritative Data

Authoritative data is the **single source of truth** that all readers MUST consult. When copies or projections exist, they MUST be derived from the authoritative source and MUST NEVER be used as input to grading, scoring, or state transitions.

## 2. Live Authoring Data

| Data | Authoritative storage | Who writes | Mutable? |
|------|----------------------|------------|----------|
| Question content | `questions` row | Admin, Teacher (create/update routes) | Yes — always mutable while the row exists |
| Question standardAnswer | `questions.standardAnswer` | Admin, Teacher | Yes |
| Question rubric | `questions.rubric` | Admin, Teacher | Yes |
| Exam configuration | `exams` row (most fields) | Admin, Teacher (in draft) | Yes in draft; frozen at publish |
| Organization settings | `organization_settings` row | Admin | Yes |

**Rule**: Live authoring data is authoritative for the **next** snapshot, but NOT for any existing snapshot. Once a `QuestionSnapshot` is created, the live `questions` row is no longer consulted for that snapshot's grading.

## 3. Frozen Publication Data

| Data | Authoritative storage | Who writes | When frozen | Mutable after? |
|------|----------------------|------------|-------------|----------------|
| Exam question snapshot | `exams.questionSnapshot` | `publishExam()` | At publish | **Never** |
| Exam totalScore | `exams.totalScore` | `publishExam()` (validated) | At publish | **Never** |
| Exam passingScore | `exams.passingScore` | `publishExam()` (validated) | At publish | **Never** |
| Exam control flags | `exams.controlFlags` | `publishExam()` | At publish | **Never** |

**Invariant**: INV-E-002 — `publishExam()` MUST build the question snapshot.

## 4. Attempt Execution Data

| Data | Authoritative storage | Who writes | Mutable until |
|------|----------------------|------------|---------------|
| Attempt status | `exam_attempts.status` | Command functions | Terminal state |
| Draft answers | `exam_attempts.answers` (JSONB) | `saveAnswer()` | Submit freeze barrier |
| Question snapshot (attempt-level) | `exam_attempts.questionSnapshot` | `startOrRestoreAttempt()` (copied from exam) | Never |
| Heartbeat | `exam_attempts.lastActivityAt` | `saveAnswer()` / heartbeat route | Never (monotonic) |

### 4.1 Draft answers authority

Draft answers (`exam_attempts.answers`) are authoritative for the candidate's work-in-progress. The Save Answer protocol (`processSaveAnswer()`) is the sole writer.

### 4.2 Question membership

`saveAnswer()` validates that the `request.questionId` is a member of the attempt's frozen `questionSnapshot`. Accepting an answer for a question outside the universe is illegal.

## 5. Submitted-Answer Authority

| Data | Authoritative storage | Who writes | When authoritative | Mutable after? |
|------|----------------------|------------|-------------------|----------------|
| Submitted answers | `exam_attempts.submitted_answers` (JSONB) | `buildSubmittedAnswersSnapshot()` inside `submitAttempt()` | At submit freeze | **Never** |

**Invariant**: INV-A-002 — `submitted_answers` MUST be written exactly once, inside the submit transaction.

### 5.1 Hash is NOT the authority

`submitted_answers_hash` is **NOT a DB column**. Hash utilities exist for testing and backfill verification, but idempotency is guaranteed by transactions + status guards + immutability, not by hash comparison.

## 6. Grading Authority

| Data | Authoritative storage | Who writes | When authoritative |
|------|----------------------|------------|-------------------|
| Per-question auto grade | `attempt_grading_entries` (objective rows) | `materializeGradingEntries()` at submit-freeze | At submit-freeze |
| Per-question manual grade | `attempt_grading_entries` (manual rows) | `gradeQuestion()` (manual grading command) | At score entry |
| Grading queue | `attempt_grading_entries` WHERE `grading_mode='manual' AND status='pending_manual'` | N/A (derived) | At submit-freeze |
| Attempt total score | `exam_attempts.score` | `finalizeTerminalGrading()` | At terminal closure |
| Attempt pass/fail | `exam_attempts.passed` | `finalizeTerminalGrading()` | At terminal closure |
| Per-question results | `exam_attempts.gradingResult` | `finalizeTerminalGrading()` | At terminal closure |

### 6.1 Grading workset is the single durable truth

**Invariant**: INV-G-002 — `attempt_grading_entries` is the single durable grading truth. `attempt.gradingResult` is a denormalized projection — never consumed as scoring input.

### 6.2 No live Question joins in grading

**Invariant**: INV-G-001 — Terminal grading MUST derive from the frozen Attempt question snapshot and submitted answer authority, NOT live Question rows.

`aggregateGradingEntries()` reads ONLY:
- `attempt.questionSnapshot` (frozen question universe)
- `attempt_grading_entries` (materialized workset)

It NEVER reads `attempt.gradingResult` (output), draft `attempt.answers`, or live `questions`.

## 7. Result Projection Authority

| Data | Authoritative storage | Who writes | When authoritative |
|------|----------------------|------------|-------------------|
| Enrollment final score | `exam_enrollments.finalScore` | `finalizeTerminalGrading()` | At terminal closure |
| Enrollment final pass | `exam_enrollments.finalPassed` | `finalizeTerminalGrading()` | At terminal closure |
| Enrollment final attempt | `exam_enrollments.finalAttemptId` | `finalizeTerminalGrading()` | At terminal closure |
| Result visibility | Computed from `exam.resultPublicationMode` + `exam.resultsPublishedAt` + `attempt.gradingStatus` | `publishResults()` (for manual mode) | At publish or grading completion |

### 7.1 Candidate answer-key visibility

Under the current MVP contract (`apps/api/src/routes/attempts.shared.ts`):

```text
computeAnswerVisibility() always returns "hidden" (no arguments, no conditions).
CandidateTakeSnapshot and candidate attempt serializers never include standardAnswer or rubric.
Result own-view strips standardAnswer unconditionally.
Rubric is absent from the Candidate result contract.
```

**INV-R-001**: Under the current MVP contract, Candidate-facing Attempt and Result projections MUST NOT expose `standardAnswer` or `rubric`. `answerVisibility` is currently fixed to hidden. A future configurable answer-key release policy is NOT IMPLEMENTED.

### 7.2 What must never read live data

| Operation | Must NOT read | Must read instead |
|-----------|--------------|-------------------|
| Grading | `questions` table | `attempt.questionSnapshot` + `submitted_answers` |
| Result computation | `questions` table | `attempt.gradingResult` (projection from snapshot) |
| Score export | Live questions | `attempt.score` + `attempt.passed` |

## 8. Notification and Email Authority

### 8.1 Email outbox (infrastructure, IMPLEMENTED)

| Data | Authoritative storage | Who writes | When authoritative |
|------|----------------------|------------|-------------------|
| Email outbox row | `email_outbox` | Business transaction (P5-N1 `result_published` publication) | At enqueue |
| Email delivery status | `email_outbox.status` | Email worker (`markSent`/`markRetryWait`/`markDead`) | At send attempt |
| Provider message ID | `email_outbox.providerMessageId` | Email worker (`markSent`) | At successful send |

**Invariant**: INV-N-001 — Email outbox rows are written by business transactions; SMTP send happens OUTSIDE the transaction.

### 8.2 Business notification-to-outbox protocol (first caller IMPLEMENTED — P5-N1)

The first production business caller is `result_published`: the result-publication transaction atomically creates the candidate Inbox row and enqueues the Email outbox row (P5-N1, CLOSED, PR #213). Additional operational notification types remain P5-N2+ scope.

## 9. Transaction Boundaries

### 9.1 Rule: Engine layer has no transactions

The `packages/exam-engine/src/` layer contains **no explicit `db.transaction` calls**. Every function that requires transactional atomicity has a doc comment stating the **caller (API route layer) is responsible for transaction composition**.

### 9.2 Transaction inventory

| Operation | Transaction boundary | Isolation | Audit durability |
|-----------|---------------------|-----------|------------------|
| Exam publish | `executeInTransaction` → lock exam → `publishExam()` → update | REPEATABLE READ (default) | Atomic (in-tx) |
| Exam close/unpublish/extend/cancel/archive | `executeInTransaction` → lock exam → reconcile → command | REPEATABLE READ | Atomic |
| Exam create/update | Single repo call (no explicit tx) | N/A | Best-effort |
| Attempt start | `executeInTransaction` → `startOrRestoreAttempt()` | READ COMMITTED | Best-effort |
| Save answer | `executeInTransaction` → EA lock → reconcile → `saveAnswer()` | REPEATABLE READ | None |
| Submit + grade | `executeInTransaction` → EA lock → `submitAttempt()` → `finalizeGrading()` | REPEATABLE READ | Atomic |
| Deadline reconciliation | `executeInTransaction` → EA lock → `ensureAttemptDeadlineReconciled()` | REPEATABLE READ | Atomic |
| Manual grading | `executeInTransaction` → `gradeQuestion()` → `finalizeTerminalGrading()` | REPEATABLE READ | Atomic |
| Force submit | `executeInTransaction` → EA lock → `submitAttempt()` → grade | REPEATABLE READ | Atomic |
| Email claim | `executeInTransaction` → `claimDue()` (atomic CTE) | READ COMMITTED | None |
| Email mark result | Single repo call (after SMTP send outside tx) | N/A | None |

### 9.3 Lock ordering

To avoid deadlocks, all code paths MUST acquire locks in a consistent order:

```
Enrollment → Attempt → Exam
```

### 9.4 Row-lock acquisition methods

| Repository | Method | Lock |
|------------|--------|------|
| `examRepo` | `findByIdForUpdate(ctx, examId)` | `FOR UPDATE` |
| `attemptRepo` | `findByIdForUpdate(ctx, attemptId)` | `FOR UPDATE` |
| `enrollmentRepo` | `findByExamAndCandidateForUpdate(ctx, examId, candidateId)` | `FOR UPDATE` |
| `emailOutboxRepo` | `claimDue()` | `FOR UPDATE SKIP LOCKED` |

## 10. Idempotency and Concurrency

### 10.1 Save Answer idempotency

The Save Answer protocol is idempotent per `(questionId, clientSeq)` pair:
- Same key + same payload → accepted as replay (no write, returns prior `savedAt`).
- Same key + different payload → rejected as `CONFLICTING_PAYLOAD`.

### 10.2 Submit idempotency

`submitAttempt()` is idempotent: if the attempt is already `submitted`/`grading`/`graded`, returns the existing frozen snapshot unchanged.

### 10.3 Email worker concurrency

Multiple email workers can run concurrently. `claimDue()` uses `FOR UPDATE SKIP LOCKED` to ensure each row is claimed by at most one worker. Ownership fencing (`lockedBy = workerInstanceId`) prevents double-send.

## 11. Crash Recovery

### 11.1 Submit barrier crash

If the process crashes **during** the submit transaction:
- The DB transaction rolls back. The attempt remains `in_progress`.
- On the next access, `ensureAttemptDeadlineReconciled()` re-runs (idempotent).

### 11.2 Grading crash

If the process crashes **after** submit but **before** grading completes:
- The attempt is `submitted` (submit committed) but not `graded`.
- `gradeAttemptIdempotent()` detects `submitted` status and re-runs grading.

### 11.3 Email worker crash

If the email worker crashes while a row is in `processing`:
- The `lockedAt` timestamp remains set.
- On the next worker startup (or the next poll cycle), `recoverAbandoned()` resets rows where `lockedAt < cutoff` back to `pending`.
- The row is then re-claimed and re-sent (at-least-once delivery).

### 11.4 Candidate crash/disconnect

If the candidate's browser crashes:
- The attempt remains `in_progress`.
- After the heartbeat timeout (default 60s), the heartbeat scanner marks it `disrupted`.
- On reconnection, the candidate can `restoreInterruptedAttempt()` to resume (deadline adjusted per the interruption-time policy; operator grants are a separate `grantAttemptTime()` command).
- If the deadline passes while disrupted, deadline reconciliation auto-submits.

## 12. Projection versus Source-of-Truth Rules

| Projection | Source of truth | Rule |
|------------|----------------|------|
| `attempt.gradingResult` | `attempt_grading_entries` | Generated at terminal closure; never read as scoring input |
| Candidate result view | `attempt.score` + `attempt.passed` + exam visibility | Computed at read time; not stored |
| `exam_enrollments.finalScore` | `attempt.score` (selected by strategy) | Written at terminal closure |
| CandidateTakeSnapshot | `attempt` + `exam` (derived) | Computed at read time; never stored |
| GradingQuestionDTO | `attempt_grading_entries` + `questionSnapshot` | Computed at read time; never stored |
| Admin score export | `attempt.score` + candidate fields | Computed at read time; not stored |

**Golden rule**: If data can be re-derived from authoritative storage, it MUST NOT be stored separately (except for query-performance denormalization like `attempt.gradingResult`).
