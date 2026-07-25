# Protocol Catalog

> Normative description of every protocol in the exam system: purpose, actor, preconditions, state transition, writes, transaction boundary, idempotency, and audit.

## Conventions

Each protocol is documented with:

- **Protocol name**: Stable identifier
- **Business purpose**: What the protocol achieves
- **Actor**: Who initiates it
- **Required capability**: The RBAC permission gate
- **Input contract**: The request shape
- **Preconditions**: What must be true before the protocol runs
- **Authoritative reads**: What data is read as truth
- **State transition**: The lifecycle change
- **Writes**: What data is mutated
- **Transaction boundary**: Where the transaction starts and ends
- **Idempotency behavior**: What happens on repeated calls
- **Conflict behavior**: How concurrent operations are handled
- **Audit event**: What is logged
- **Failure behavior**: Error codes and rollback semantics
- **Security invariants**: What must never be violated

---

## INV register

Invariant IDs used throughout this document:

| ID | Statement |
|----|-----------|
| INV-Q-001 | Question snapshots are immutable copies; grading MUST read from snapshots, never from live `questions` rows. |
| INV-E-001 | Exam status transitions MUST go through command functions; direct mutation in routes is forbidden. |
| INV-E-002 | `publishExam()` MUST build the question snapshot; an exam cannot be published without a snapshot. |
| INV-ENR-001 | A candidate MUST have an enrollment row to start an attempt. |
| INV-A-001 | Once an attempt becomes `submitted`, `grading`, `graded`, or `voided`, Candidate answer writes MUST NOT modify its answer set. |
| INV-A-002 | `submitted_answers` MUST be written exactly once, inside the submit transaction. |
| INV-A-003 | The Save Answer protocol MUST be idempotent per `(questionId, clientSeq)` pair. |
| INV-G-001 | Terminal grading MUST derive from the frozen Attempt question snapshot and submitted answer authority, not live Question rows. |
| INV-G-002 | `attempt_grading_entries` is the single durable grading truth; `attempt.gradingResult` is a projection. |
| INV-R-001 | Candidate result projection MUST NOT expose `standardAnswer` or `rubric` unless `answerVisibility` allows. |
| INV-R-002 | Result visibility is the AND of "result computable" and "publish policy satisfied". |
| INV-N-001 | Email outbox rows are written by business transactions; SMTP send happens OUTSIDE the transaction. |
| INV-MAIL-001 | Email worker claim uses `FOR UPDATE SKIP LOCKED` to prevent concurrent workers from sending the same row. |
| INV-SEC-001 | Authorization is resolved from active `user_role_assignments` rows, never from `users.role` or JWT claims. |
| INV-SEC-002 | Cross-candidate attempt access MUST return 404 (not 403) to prevent enumeration. |

---

## Protocol: Question Create

| Field | Value |
|-------|-------|
| **Protocol name** | Question Create |
| **Business purpose** | Add a new question to the question bank |
| **Actor** | Admin |
| **Required capability** | `question.create` |
| **Input contract** | `CreateQuestionRequest` (type, content, options, standardAnswer, score, difficulty, tags, gradingRule, rubric?) |
| **Preconditions** | Admin is authenticated; course exists |
| **Authoritative reads** | Course existence |
| **State transition** | None (Question has no lifecycle) |
| **Writes** | `questions` row |
| **Transaction boundary** | Single repo call (no explicit transaction) |
| **Idempotency behavior** | NOT idempotent — each call creates a new row |
| **Conflict behavior** | N/A |
| **Audit event** | `question.created` (best-effort) |
| **Failure behavior** | ValidationError → 400 |
| **Security invariants** | Organization scoping via ctx |

## Protocol: Question Update

| Field | Value |
|-------|-------|
| **Protocol name** | Question Update |
| **Business purpose** | Modify an existing question |
| **Actor** | Admin |
| **Required capability** | `question.update` |
| **Input contract** | `UpdateQuestionRequest` |
| **Preconditions** | Question exists in admin's organization |
| **Authoritative reads** | Question row |
| **State transition** | None |
| **Writes** | `questions` row (in-place mutation) |
| **Transaction boundary** | Single repo call |
| **Idempotency behavior** | NOT idempotent |
| **Conflict behavior** | N/A — last-write-wins (no optimistic locking on questions) |
| **Audit event** | `question.updated` (best-effort) |
| **Failure behavior** | NotFoundError → 404 |
| **Security invariants** | Organization scoping; live edits do NOT affect existing snapshots (INV-Q-001) |

## Protocol: Question Delete

| Field | Value |
|-------|-------|
| **Protocol name** | Question Delete |
| **Business purpose** | Remove a question from the bank |
| **Actor** | Admin |
| **Required capability** | `question.delete` |
| **Input contract** | Question ID |
| **Preconditions** | Question exists in admin's organization |
| **Authoritative reads** | Question row |
| **State transition** | None |
| **Writes** | `questions` row deleted |
| **Transaction boundary** | Single repo call |
| **Idempotency behavior** | Idempotent — deleting a missing row returns false |
| **Conflict behavior** | N/A |
| **Audit event** | `question.deleted` (best-effort) |
| **Failure behavior** | NotFoundError → 404 |
| **Security invariants** | **ACCEPTED LIMITATION**: no referential integrity guard against deleting questions referenced by existing snapshots |

---

## Protocol: Exam Create

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Create |
| **Business purpose** | Create a new exam in draft state |
| **Actor** | Admin |
| **Required capability** | `exam.create` |
| **Input contract** | `CreateExamRequest` |
| **Preconditions** | Admin is authenticated |
| **Authoritative reads** | Course existence |
| **State transition** | None (exam is created as `draft`) |
| **Writes** | `exams` row with `status = 'draft'` |
| **Transaction boundary** | Single repo call |
| **Idempotency behavior** | NOT idempotent |
| **Conflict behavior** | N/A |
| **Audit event** | `exam.created` (best-effort) |
| **Failure behavior** | ValidationError → 400 |
| **Security invariants** | Organization scoping via ctx |

## Protocol: Exam Update

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Update |
| **Business purpose** | Modify an exam's configuration |
| **Actor** | Admin |
| **Required capability** | `exam.update` |
| **Input contract** | `UpdateExamRequest` |
| **Preconditions** | Exam exists in admin's organization |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | None (status unchanged) |
| **Writes** | `exams` row |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → guard → update |
| **Idempotency behavior** | NOT idempotent |
| **Conflict behavior** | Row lock serializes concurrent updates |
| **Audit event** | `exam.updated` (best-effort for draft; atomic for published-schedule) |
| **Failure behavior** | `ExamUpdateNotAllowedError` → 409; `ExamNotDraftError` → 409 |
| **Security invariants** | Draft = full edit; Published = schedule fields only (openAt/closeAt); Open/Closed/Canceled/Archived = rejected |

## Protocol: Exam Publish

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Publish |
| **Business purpose** | Transition exam from draft to published, building the question snapshot |
| **Actor** | Admin |
| **Required capability** | `exam.publish` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is in `draft` state; ≥1 question; valid schedule; `timed_window`; manual selection; valid retake policy; totalScore matches question scores; passingScore ≤ totalScore; auto-graded questions have non-empty standardAnswer; text_response questions have non-empty rubric |
| **Authoritative reads** | Exam row (FOR UPDATE); Question rows (for snapshot) |
| **State transition** | `draft → published` |
| **Writes** | `exams.status = 'published'`; `exams.questionSnapshot` (frozen copy) |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → `publishExam()` → `repo.update` |
| **Idempotency behavior** | NOT idempotent — re-publish from `published` is rejected by state machine |
| **Conflict behavior** | Row lock serializes concurrent publish attempts |
| **Audit event** | `exam.published` (atomic, in-tx) |
| **Failure behavior** | `InvalidStateTransitionError` → 409; `ValidationError` → 400 |
| **Security invariants** | INV-E-002: snapshot is built at publish time; questions are validated for completeness |

## Protocol: Exam Open

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Open |
| **Business purpose** | Transition exam from published to open, allowing candidates to start attempts |
| **Actor** | Admin (manual) or `checkAndUpdateExamStatus` (lazy auto) |
| **Required capability** | `exam.publish` (manual) |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is in `published` state |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | `published → open` |
| **Writes** | `exams.status = 'open'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → `openExam()` |
| **Idempotency behavior** | Rejected for non-published states |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.opened` (atomic) |
| **Failure behavior** | `InvalidStateTransitionError` → 409 |

## Protocol: Exam Close

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Close |
| **Business purpose** | Transition exam from open to closed, preventing new attempts |
| **Actor** | Admin (manual) or `checkAndUpdateExamStatus` (lazy auto) |
| **Required capability** | `exam.close` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is in `open` state; no unresolved attempts (route-layer guard) |
| **Authoritative reads** | Exam row (FOR UPDATE); attempt count |
| **State transition** | `open → closed` |
| **Writes** | `exams.status = 'closed'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `closeExam()` |
| **Idempotency behavior** | **Idempotent** — already-closed returns unchanged (route suppresses duplicate audit) |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.closed` (atomic) |
| **Failure behavior** | `ExamCloseNotAllowedError` → 409 (unresolved attempts or wrong state) |

## Protocol: Exam Cancel

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Cancel |
| **Business purpose** | Abnormally cancel an exam (published or open) |
| **Actor** | Admin |
| **Required capability** | `exam.cancel` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is `published` or `open`; open exams must have no unresolved attempts |
| **Authoritative reads** | Exam row (FOR UPDATE); attempt count |
| **State transition** | `published → canceled` or `open → canceled` |
| **Writes** | `exams.status = 'canceled'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `cancelExam()` |
| **Idempotency behavior** | **NOT idempotent** — `canceled → canceled` is rejected |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.canceled` (atomic) |
| **Failure behavior** | `ExamCancelNotAllowedError` → 409 |
| **Security invariants** | Cancel does NOT void or force-submit attempts (route-layer guard) |

## Protocol: Exam Unpublish

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Unpublish |
| **Business purpose** | Revert a published exam back to draft |
| **Actor** | Admin |
| **Required capability** | `exam.unpublish` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is `published` AND `now < openAt` (route reconciles first) |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | `published → draft` |
| **Writes** | `exams.status = 'draft'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `unpublishExam()` |
| **Idempotency behavior** | Rejected for non-published states |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.unpublished` (atomic) |
| **Failure behavior** | `ExamUnpublishNotAllowedError` → 409 |

## Protocol: Exam Extend

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Extend |
| **Business purpose** | Extend an open exam's closeAt |
| **Actor** | Admin |
| **Required capability** | `exam.extend` |
| **Input contract** | Exam ID, `extendMinutes` (positive integer) |
| **Preconditions** | Exam is `open` AND `now < closeAt` (route reconciles first) |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | None (status stays `open`; only `closeAt` changes) |
| **Writes** | `exams.closeAt = oldCloseAt + extendMinutes * 60_000` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `extendExam()` |
| **Idempotency behavior** | NOT idempotent |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.extended` (atomic) |
| **Failure behavior** | `ExamExtendNotAllowedError` → 409 |

## Protocol: Exam Archive

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Archive |
| **Business purpose** | Terminal archive of a closed or canceled exam |
| **Actor** | Admin |
| **Required capability** | `exam.archive` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is `closed` or `canceled` |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | `closed → archived` or `canceled → archived` |
| **Writes** | `exams.status = 'archived'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `archiveExam()` |
| **Idempotency behavior** | Rejected for non-closed/canceled states |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.archived` (atomic) |
| **Failure behavior** | `ExamArchiveNotAllowedError` → 409 |

## Protocol: Publish Results

| Field | Value |
|-------|-------|
| **Protocol name** | Publish Results |
| **Business purpose** | Make manual-mode exam results visible to candidates |
| **Actor** | Admin |
| **Required capability** | `exam.result.publish` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is `published`, `open`, or `closed` |
| **Authoritative reads** | Exam row (FOR UPDATE) |
| **State transition** | None (status unchanged; `resultsPublishedAt` is a fact timestamp) |
| **Writes** | `exams.resultsPublishedAt = now` (write-once) |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `publishResults()` |
| **Idempotency behavior** | **Idempotent** — already-published returns `{ alreadyPublished: true }` |
| **Conflict behavior** | Row lock |
| **Audit event** | `exam.results_published` (atomic) |
| **Failure behavior** | `ExamPublishResultsNotAllowedError` → 409 |
| **Security invariants** | INV-R-002: visibility is AND of publish-policy and grading-completeness |

---

## Protocol: Candidate Enrollment

| Field | Value |
|-------|-------|
| **Protocol name** | Candidate Enrollment |
| **Business purpose** | Grant a candidate eligibility to take an exam |
| **Actor** | Admin |
| **Required capability** | `exam.enrollment.manage` |
| **Input contract** | Exam ID, candidate ID list |
| **Preconditions** | Exam exists; candidates exist |
| **Authoritative reads** | Exam row; candidate rows |
| **State transition** | None (enrollment is created as `assigned`) |
| **Writes** | `exam_enrollments` rows |
| **Transaction boundary** | Per-candidate `executeInTransaction` with atomic audit |
| **Idempotency behavior** | **ACCEPTED LIMITATION**: no upsert — re-enrolling an existing candidate creates a duplicate error (unique constraint) |
| **Conflict behavior** | Unique constraint on `(org, exam, candidate)` |
| **Audit event** | `enrollment.created` (atomic) |
| **Failure behavior** | `CandidateIdentityConflictError` → 409 |
| **Security invariants** | INV-ENR-001: enrollment is required to start attempts |

## Protocol: Attempt Start

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Start |
| **Business purpose** | Create a new attempt or restore a disrupted one |
| **Actor** | Candidate |
| **Required capability** | `attempt.start` + exam eligibility |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is `published` or `open`; `now` within `[openAt, closeAt)`; candidate is enrolled; retake policy allows; late-entry cutoff not passed |
| **Authoritative reads** | Exam row; enrollment row (FOR UPDATE); active attempt |
| **State transition** | `enrollment.status: assigned → started`; attempt created as `in_progress` |
| **Writes** | `exam_attempts` row; `exam_enrollments.attemptCount + 1` |
| **Transaction boundary** | `executeInTransaction` → `startOrRestoreAttempt()` |
| **Idempotency behavior** | **Idempotent** — if an active `in_progress` attempt exists, returns it directly |
| **Conflict behavior** | Enrollment FOR UPDATE serializes concurrent starts |
| **Audit event** | `attempt.started` (best-effort) |
| **Failure behavior** | `ExamNotOpenError` → 409; `MaxAttemptsReachedError` → 409; `ExamAlreadyPassedError` → 409; `AttemptLateEntryClosedError` → 409 |
| **Security invariants** | Candidate ownership verified; enrollment existence verified |

## Protocol: Save Answer

| Field | Value |
|-------|-------|
| **Protocol name** | Save Answer |
| **Business purpose** | Persist a candidate's answer to a specific question |
| **Actor** | Candidate |
| **Required capability** | `attempt.answer.save` + own attempt |
| **Input contract** | `{ attemptId, questionId, answer, clientSeq, clientSavedAt, baseVersion }` |
| **Preconditions** | Attempt is `in_progress`; `now < effectiveDeadline`; question is in the attempt's snapshot |
| **Authoritative reads** | Attempt row (via mutation context, which holds the EA lock); exam row (for effective deadline) |
| **State transition** | None (attempt stays `in_progress`) |
| **Writes** | `exam_attempts.answers` (new AnswerRecord); `exam_attempts.lastActivityAt` |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `prepareReconciledAttemptMutation` → `saveAnswer()` |
| **Idempotency behavior** | **Idempotent** per `(questionId, clientSeq)` — same key + same payload = replay (accepted, no write). Same key + different payload = `CONFLICTING_PAYLOAD`. |
| **Conflict behavior** | `baseVersion < currentVersion` → `STALE_VERSION`. EA lock serializes against submit. |
| **Audit event** | None (versioned answer state is authority; per ADR-006 audit contract) |
| **Failure behavior** | `ATTEMPT_ALREADY_SUBMITTED` → 409; `ATTEMPT_CLOSED` → 409; `DEADLINE_EXCEEDED` → 409; `STALE_VERSION` → 409; `CONFLICTING_PAYLOAD` → 409 |
| **Security invariants** | INV-A-003; question must be in the attempt's frozen snapshot; candidate ownership verified |

## Protocol: Attempt Heartbeat

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Heartbeat |
| **Business purpose** | Signal that the candidate is still connected |
| **Actor** | Candidate (every ~30s) |
| **Required capability** | `attempt.heartbeat.send` + own attempt |
| **Input contract** | `{ attemptId }` |
| **Preconditions** | Attempt exists and belongs to candidate |
| **Authoritative reads** | Attempt row |
| **State transition** | None |
| **Writes** | `exam_attempts.lastActivityAt = now` |
| **Transaction boundary** | **NO transaction** — single `attemptRepo.update` |
| **Idempotency behavior** | Idempotent — repeated heartbeats just update the timestamp |
| **Conflict behavior** | N/A |
| **Audit event** | None |
| **Failure behavior** | NotFoundError → 404 |
| **Security invariants** | Candidate ownership verified |

## Protocol: Deadline Reconciliation

| Field | Value |
|-------|-------|
| **Protocol name** | Deadline Reconciliation |
| **Business purpose** | Lazily freeze an attempt that has passed its effective deadline |
| **Actor** | System (triggered at candidate entry points) |
| **Required capability** | None (internal) |
| **Input contract** | Attempt ID, `now` |
| **Preconditions** | Attempt is `in_progress` or `disrupted`; `now >= effectiveDeadline` |
| **Authoritative reads** | Attempt row (FOR UPDATE); exam row |
| **State transition** | `in_progress/disrupted → submitted` (then `→ graded` if auto-gradable) |
| **Writes** | `exam_attempts.status`, `submitted_answers`, `submittedAt`, `submissionReason = 'deadline'`, grading result |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `ensureAttemptDeadlineReconciled()` |
| **Idempotency behavior** | **Idempotent** — already-frozen attempts returned unchanged |
| **Conflict behavior** | EA lock serializes against concurrent save/submit |
| **Audit event** | `attempt.deadline_reconciled` (atomic) |
| **Failure behavior** | `NotFoundError` → 404 |
| **Security invariants** | `submittedAt = effectiveDeadline` (business deadline), not wall-clock instant |

## Protocol: Attempt Submit

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Submit |
| **Business purpose** | Freeze answers and trigger grading |
| **Actor** | Candidate (manual) or System (deadline) or Admin (force-submit) |
| **Required capability** | `attempt.submit` (candidate) / `attempt.force_submit` (admin) |
| **Input contract** | `{ attemptId }` (no answer payload — grades whatever is persisted) |
| **Preconditions** | Attempt is `in_progress` or `disrupted`; candidate submit respects `minSubmitAfterStartMinutes` |
| **Authoritative reads** | Attempt row (FOR UPDATE); grading workset |
| **State transition** | `in_progress/disrupted → submitted` (then `→ graded` if auto-gradable) |
| **Writes** | `exam_attempts.status = 'submitted'`; `submitted_answers` (frozen snapshot); `submittedAt`; `submissionReason`; `gradingStatus`; `attempt_grading_entries` (materialized workset) |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `submitAttempt()` |
| **Idempotency behavior** | **Idempotent** — already-submitted returns frozen snapshot unchanged; validates workset consistency |
| **Conflict behavior** | Attempt FOR UPDATE serializes against concurrent save. Fresh-submit precondition: zero pre-existing grading entries (fail closed). |
| **Audit event** | `attempt.submit` (atomic) |
| **Failure behavior** | `InvalidStateTransitionError` → 409; `AttemptSubmitTooEarlyError` → 409 |
| **Security invariants** | INV-A-001, INV-A-002; submit carries NO answer payload |

## Protocol: Submit-Answer Freeze

| Field | Value |
|-------|-------|
| **Protocol name** | Submit-Answer Freeze |
| **Business purpose** | The atomic barrier that freezes draft answers into the authoritative submitted snapshot |
| **Actor** | `submitAttempt()` (internal) |
| **Required capability** | None (internal) |
| **Input contract** | Attempt ID, `now` |
| **Preconditions** | Attempt is `in_progress` or `disrupted`; EA lock held |
| **Authoritative reads** | Attempt row (FOR UPDATE); draft `answers`; `questionSnapshot` |
| **State transition** | `in_progress/disrupted → submitted` |
| **Writes** | `submitted_answers` (built by `buildSubmittedAnswersSnapshot`); `status`; `submittedAt`; `submissionReason`; `gradingStatus`; `attempt_grading_entries` |
| **Transaction boundary** | Inside the submit transaction (caller-managed) |
| **Idempotency behavior** | Idempotent — re-entry returns existing snapshot |
| **Conflict behavior** | Attempt FOR UPDATE; zero-pre-existing-entries precondition |
| **Audit event** | `attempt.submit` |
| **Failure behavior** | Workset inconsistency → Error (500, invariant violation) |
| **Security invariants** | INV-A-002: written exactly once; protocol metadata stripped |

## Protocol: Automatic Grading

| Field | Value |
|-------|-------|
| **Protocol name** | Automatic Grading |
| **Business purpose** | Score objective questions against the frozen snapshot |
| **Actor** | System (triggered by submit or deadline reconciliation) |
| **Required capability** | None (internal) |
| **Input contract** | Attempt ID |
| **Preconditions** | Attempt is `submitted`; `gradingStatus !== pending_manual` |
| **Authoritative reads** | `submitted_answers`; `question_snapshot`; `attempt_grading_entries` |
| **State transition** | `submitted → graded` (if pure-objective) |
| **Writes** | `exam_attempts.status = 'graded'`; `score`; `passed`; `gradingResult`; `gradedAt`; `gradingStatus = 'auto_graded'`; enrollment final score |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `finalizeGrading()` → `finalizeTerminalGrading()` |
| **Idempotency behavior** | **Idempotent** — already-graded returns `false` |
| **Conflict behavior** | EA lock; workset terminality validated by `aggregateGradingEntries` |
| **Audit event** | `grading.finalized` (atomic) |
| **Failure behavior** | Workset inconsistency → Error (500) |
| **Security invariants** | INV-G-001: derives from frozen truth, not live questions |

## Protocol: Manual Grading

| Field | Value |
|-------|-------|
| **Protocol name** | Manual Grading |
| **Business purpose** | A grader scores a text_response question |
| **Actor** | Grader (or Admin with grading permission) |
| **Required capability** | `grading.score.write` + scoped to attempt |
| **Input contract** | `{ attemptId, questionId, score, comment }` |
| **Preconditions** | Attempt is `submitted`; `gradingStatus = 'pending_manual'`; entry is `pending_manual` |
| **Authoritative reads** | Attempt row; grading entry (materialized workset) |
| **State transition** | Entry: `pending_manual → completed_manual`. If last manual entry: attempt `submitted → graded`. |
| **Writes** | `attempt_grading_entries` (entry updated); if terminal: attempt `score`, `passed`, `gradingResult`, `gradedAt`, `gradingStatus = 'fully_graded'`; enrollment final score |
| **Transaction boundary** | `executeInTransaction` → `gradeQuestion()` → `finalizeTerminalGrading()` |
| **Idempotency behavior** | **NOT idempotent** — re-grading a `completed_manual` entry is rejected (one-way) |
| **Conflict behavior** | Caller holds attempt row lock |
| **Audit event** | `grading.score_entered` (atomic) |
| **Failure behavior** | `PermissionDeniedError` → 403 (auto-graded question); `InvalidStateTransitionError` → 409 (already scored) |
| **Security invariants** | INV-G-002: materialized entry is the sole manual-work authority |

## Protocol: Terminal Grading Finalization

| Field | Value |
|-------|-------|
| **Protocol name** | Terminal Grading Finalization |
| **Business purpose** | The single canonical closure that projects the attempt total and enrollment result |
| **Actor** | `finalizeTerminalGrading()` (internal, called by auto-grade or manual-grade) |
| **Required capability** | None (internal) |
| **Input contract** | EA capability, exam, `now` |
| **Preconditions** | Workset is fully terminal (all entries `completed_auto` or `completed_manual`); attempt is `submitted` |
| **Authoritative reads** | Attempt row; grading entries; enrollment row |
| **State transition** | `submitted → graded`; enrollment `started → completed` (if policy says so) |
| **Writes** | `exam_attempts`: `status`, `score`, `passed`, `gradingResult`, `gradedAt`, `gradingStatus`; `exam_enrollments`: `status`, `finalScore`, `finalPassed`, `finalAttemptId` |
| **Transaction boundary** | Inside the caller's transaction (caller holds EA lock) |
| **Idempotency behavior** | **Idempotent** — already-graded returns `false` |
| **Conflict behavior** | EA lock serializes concurrent finalizers |
| **Audit event** | `grading.finalized` (atomic) |
| **Failure behavior** | Workset inconsistency → Error (500) |
| **Security invariants** | INV-G-001, INV-G-002 |

## Protocol: Result Read

| Field | Value |
|-------|-------|
| **Protocol name** | Result Read |
| **Business purpose** | Return a candidate's result (score, pass status) if visible |
| **Actor** | Candidate (own) or Admin (all) |
| **Required capability** | `score.own.view` / `score.all.view` |
| **Input contract** | Attempt ID |
| **Preconditions** | Attempt exists; caller has permission |
| **Authoritative reads** | Attempt row; exam row (for `resultPublicationMode`, `resultsPublishedAt`) |
| **State transition** | None |
| **Writes** | None |
| **Transaction boundary** | Single repo read |
| **Idempotency behavior** | Idempotent |
| **Conflict behavior** | N/A |
| **Audit event** | None (read-only) |
| **Failure behavior** | NotFoundError → 404; hidden result → specific `hiddenReason` |
| **Security invariants** | INV-R-001: no standardAnswer/rubric unless `answerVisibility` allows; INV-R-002: visibility is AND of publish-policy and grading-completeness |

## Protocol: Result Export

| Field | Value |
|-------|-------|
| **Protocol name** | Result Export |
| **Business purpose** | Export exam scores as CSV |
| **Actor** | Admin |
| **Required capability** | `score.export` |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is ended; no unresolved attempts (route guard) |
| **Authoritative reads** | Exam row; graded attempts; candidate profiles |
| **State transition** | None |
| **Writes** | None |
| **Transaction boundary** | Read-only |
| **Idempotency behavior** | Idempotent |
| **Conflict behavior** | N/A |
| **Audit event** | `export_scores` (synchronous sensitive read) |
| **Failure behavior** | `ExamCanceledResultsUnavailableError` → 409 |
| **Security invariants** | Canceled exams MUST NOT expose normal scores/export |

## Protocol: Email Outbox Enqueue

| Field | Value |
|-------|-------|
| **Protocol name** | Email Outbox Enqueue |
| **Business purpose** | Insert a durable email record for async delivery |
| **Actor** | Business transaction (currently **NO production caller**) |
| **Required capability** | None (internal) |
| **Input contract** | `{ type, recipientEmail, subject, bodyText, bodyHtml?, dedupeKey? }` |
| **Preconditions** | None |
| **Authoritative reads** | Dedupe check (if `dedupeKey` provided) |
| **State transition** | None (row created as `pending`) |
| **Writes** | `email_outbox` row with `status = 'pending'`, `attemptCount = 0` |
| **Transaction boundary** | Inside the business transaction (atomic with business mutation) |
| **Idempotency behavior** | Dedupe via unique partial index on `(org, dedupeKey)` |
| **Conflict behavior** | Unique constraint prevents duplicate dedupe keys |
| **Audit event** | None |
| **Failure behavior** | Unique violation → 409 |
| **Security invariants** | INV-N-001: SMTP send happens outside the transaction |

## Protocol: Email Worker Claim

| Field | Value |
|-------|-------|
| **Protocol name** | Email Worker Claim |
| **Business purpose** | Atomically claim due email rows for sending |
| **Actor** | Email delivery worker |
| **Required capability** | None (worker process) |
| **Input contract** | `now`, `workerInstanceId`, `batchSize` |
| **Preconditions** | Worker is running |
| **Authoritative reads** | Due `pending` or `retry_wait` rows |
| **State transition** | `pending/retry_wait → processing` |
| **Writes** | `email_outbox.status = 'processing'`; `lockedAt`; `lockedBy`; `attemptCount + 1` |
| **Transaction boundary** | `executeInTransaction` (READ COMMITTED) — single atomic CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE RETURNING` |
| **Idempotency behavior** | **NOT idempotent** — each claim increments `attemptCount` |
| **Conflict behavior** | INV-MAIL-001: `FOR UPDATE SKIP LOCKED` prevents concurrent workers from claiming the same row |
| **Audit event** | None |
| **Failure behavior** | N/A |
| **Security invariants** | Ownership fence: subsequent updates require `lockedBy = workerInstanceId` |

## Protocol: Email Worker Send/Retry/Dead

| Field | Value |
|-------|-------|
| **Protocol name** | Email Worker Send/Retry/Dead |
| **Business purpose** | Send a claimed email and update its status |
| **Actor** | Email delivery worker |
| **Required capability** | None (worker process) |
| **Input contract** | Claimed email row |
| **Preconditions** | Row is in `processing` status; owned by this worker |
| **Authoritative reads** | Row ownership verified |
| **State transition** | Success: `processing → sent`. Retryable failure: `processing → retry_wait`. Terminal failure: `processing → dead`. |
| **Writes** | `email_outbox.status`, `sentAt`/`nextAttemptAt`/`lastError`/`providerMessageId` |
| **Transaction boundary** | Send happens OUTSIDE the DB transaction; status update is a separate transaction |
| **Idempotency behavior** | Ownership fence prevents double-send |
| **Conflict behavior** | `markSent`/`markRetryWait`/`markDead` are ownership-fenced (`WHERE status='processing' AND lockedBy=workerInstanceId`) |
| **Audit event** | `email.send_retried` (on retry); `email.send_failed` (on dead) |
| **Failure behavior** | Abandoned-lock recovery: `recoverAbandoned` resets stuck `processing` rows to `pending` |
| **Security invariants** | INV-N-001: SMTP never inside a DB transaction; secrets scrubbed from errors |
