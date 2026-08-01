# Protocol Catalog

> Normative description of every protocol in the exam system: purpose, actor, preconditions, state transition, writes, transaction boundary, idempotency, and audit.

```text
Last verified against commit:
cac6b85c425c85ad4077002bc518fca0b50f766f

Verification scope:
Current master implementation after merged P5-0 / PR #210.
```

## Conventions

Each protocol is documented with:

- **Protocol name**: Stable identifier
- **Business purpose**: What the protocol achieves
- **Actor**: Who initiates it
- **Required capability**: The RBAC permission gate
- **Current preset actors**: Which role presets grant this capability
- **Scope status**: flat org-wide / scoped resolver / marked scoped but currently flat
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
| INV-R-001 | Under the current MVP contract, Candidate-facing Attempt and Result projections MUST NOT expose `standardAnswer` or `rubric`. `answerVisibility` is currently fixed to hidden. A future configurable answer-key release policy is NOT IMPLEMENTED. |
| INV-R-002 | Result visibility is the AND of "result computable" and "publish policy satisfied". |
| INV-N-001 | Email outbox rows are written by business transactions; SMTP send happens OUTSIDE the transaction. |
| INV-MAIL-001 | Email worker claim uses `FOR UPDATE SKIP LOCKED` to prevent concurrent workers from claiming the same row. |
| INV-SEC-001 | Authorization is resolved from active `user_role_assignments` rows, never from `users.role` or JWT claims. |
| INV-SEC-002 | Cross-candidate attempt access MUST return 404 (not 403) to prevent enumeration. |
| INV-I-001 | (PROPOSED, ADR-014) An ExamIncident is an orthogonal operational case: its status MUST NOT drive Attempt status, grading, score, deadline, or punishment; resolving or dismissing an incident MUST NOT trigger any exam effect. |
| INV-I-002 | (PROPOSED, ADR-014) Incident status is terminal-monotonic (`open → investigating → resolved/dismissed`, with direct `open → resolved/dismissed` allowed); terminal incidents MUST NOT reopen and incident `type` is immutable after creation; every write command carries an `operationId` arbitrated by `UNIQUE (organization_id, operation_id)` on `exam_incident_events` (same identity + same canonical payload → replay; same identity + different command/payload → 409 `IDEMPOTENCY_CONFLICT`); mutating transitions additionally carry `expectedVersion` and fail closed with 409 `INCIDENT_VERSION_CONFLICT` on mismatch. |
| INV-I-003 | (PROPOSED, ADR-014) Incident commands lock ONLY the incident row when they bump version (investigate, severity change, resolve, dismiss); append-only commands (create, note, links) MUST NOT lock the incident row and MUST NOT update `exam_incidents.updatedAt`. Any future shared transaction that also locks an incident MUST lock it strictly after Exam in the Enrollment → Attempt → Exam order. |
| INV-I-004 | (PROPOSED, ADR-014) Every incident link (operator action, affected attempt, interruption episode) and the combined grant+link path MUST satisfy the scope quadruple — same organization, same exam, `incident.attemptId` null-or-matching, and `incident.candidateId` null-or-matching target attempt's candidate — derived server-side from the authoritative target row; organization, exam, and candidate are NEVER taken from the request body; composite FKs reuse existing uniques (`exam_attempts_org_id_unique`, `attempt_interruptions_org_attempt_id_unique`) to enforce organization/attempt consistency at the DB level. |
| INV-I-005 | (PROPOSED, ADR-014) `exam_incident_events.event_sequence` (`BIGINT GENERATED ALWAYS AS IDENTITY`) is the sole ordering authority for reconstruction and display; state events carry `before_version`/`after_version`, the per-incident version chain MUST be contiguous and verifiable across bump events only (notes/links carry `after=before` and are skipped in contiguity verification), and the materialized `version` equals the latest `after_version`; wall-clock timestamps and UUID ids define no causal order. |

---

## Protocol: Question Create

| Field | Value |
|-------|-------|
| **Protocol name** | Question Create |
| **Business purpose** | Add a new question to the question bank |
| **Actor** | Admin, Teacher |
| **Required capability** | `question.create` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | `CreateQuestionRequest` (type, content, options, standardAnswer, score, difficulty, tags, gradingRule, rubric?) |
| **Preconditions** | Actor is authenticated; course exists |
| **State transition** | None (Question has no lifecycle) |
| **Writes** | `questions` row |
| **Transaction boundary** | Single repo call (no explicit transaction) |
| **Audit event** | `question.created` (best-effort) |

## Protocol: Question Update

| Field | Value |
|-------|-------|
| **Protocol name** | Question Update |
| **Business purpose** | Modify an existing question |
| **Actor** | Admin, Teacher |
| **Required capability** | `question.update` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide |
| **Input contract** | `UpdateQuestionRequest` |
| **Preconditions** | Question exists in actor's organization |
| **State transition** | None |
| **Writes** | `questions` row (in-place mutation) |
| **Transaction boundary** | Single repo call |
| **Audit event** | `question.updated` (best-effort) |
| **Security invariants** | Organization scoping; live edits do NOT affect existing snapshots (INV-Q-001) |

## Protocol: Question Delete

| Field | Value |
|-------|-------|
| **Protocol name** | Question Delete |
| **Business purpose** | Remove a question from the bank |
| **Actor** | Admin, Teacher |
| **Required capability** | `question.delete` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide |
| **Input contract** | Question ID |
| **Preconditions** | Question exists in actor's organization |
| **State transition** | None |
| **Writes** | `questions` row deleted |
| **Transaction boundary** | Single repo call |
| **Audit event** | `question.deleted` (best-effort) |
| **Security invariants** | **ACCEPTED LIMITATION**: no referential integrity guard against deleting questions referenced by existing snapshots |

---

## Protocol: Exam Create

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Create |
| **Business purpose** | Create a new exam in draft state |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.create` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | `CreateExamRequest` |
| **Preconditions** | Actor is authenticated |
| **State transition** | None (exam is created as `draft`) |
| **Writes** | `exams` row with `status = 'draft'` |
| **Transaction boundary** | Single repo call |
| **Audit event** | `exam.created` (best-effort) |

## Protocol: Exam Update

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Update |
| **Business purpose** | Modify an exam's configuration |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.update` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | `UpdateExamRequest` |
| **Preconditions** | Exam exists in actor's organization |
| **State transition** | None (status unchanged) |
| **Writes** | `exams` row |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → guard → update |
| **Audit event** | `exam.updated` (best-effort for draft; atomic for published-schedule) |
| **Security invariants** | Draft = full edit; Published = schedule fields only (openAt/closeAt); Open/Closed/Canceled/Archived = rejected |

## Protocol: Exam Publish

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Publish |
| **Business purpose** | Transition exam from draft to published, building the question snapshot |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.publish` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is in `draft` state; ≥1 question; valid schedule; `timed_window`; manual selection; valid retake policy; totalScore matches question scores; auto-graded questions have non-empty standardAnswer; text_response questions have non-empty rubric |
| **State transition** | `draft → published` |
| **Writes** | `exams.status = 'published'`; `exams.questionSnapshot` (frozen copy) |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → `publishExam()` → `repo.update` |
| **Audit event** | `exam.published` (atomic, in-tx) |

## Protocol: Exam Close

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Close |
| **Business purpose** | Transition exam from open to closed, preventing new attempts |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.close` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | Exam ID |
| **Preconditions** | Exam is in `open` state; no unresolved attempts (route-layer guard) |
| **State transition** | `open → closed` |
| **Writes** | `exams.status = 'closed'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `closeExam()` |
| **Audit event** | `exam.closed` (atomic) |
| **Idempotency behavior** | **Idempotent** — already-closed returns unchanged |

## Protocol: Exam Cancel

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Cancel |
| **Business purpose** | Abnormally cancel an exam (published or open) |
| **Actor** | Admin |
| **Required capability** | `exam.cancel` |
| **Current preset actors** | Admin only (Teacher does NOT have this capability) |
| **Scope status** | flat org-wide |
| **State transition** | `published → canceled` or `open → canceled` |
| **Writes** | `exams.status = 'canceled'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `cancelExam()` |
| **Audit event** | `exam.canceled` (atomic) |

## Protocol: Exam Unpublish

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Unpublish |
| **Business purpose** | Revert a published exam back to draft |
| **Actor** | Admin |
| **Required capability** | `exam.unpublish` |
| **Current preset actors** | Admin only |
| **State transition** | `published → draft` |
| **Writes** | `exams.status = 'draft'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `unpublishExam()` |
| **Audit event** | `exam.unpublished` (atomic) |

## Protocol: Exam Extend

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Extend |
| **Business purpose** | Extend an open exam's closeAt |
| **Actor** | Admin |
| **Required capability** | `exam.extend` |
| **Current preset actors** | Admin only |
| **State transition** | None (status stays `open`; only `closeAt` changes) |
| **Writes** | `exams.closeAt = oldCloseAt + extendMinutes * 60_000` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `extendExam()` |
| **Audit event** | `exam.extended` (atomic) |

## Protocol: Exam Archive

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Archive |
| **Business purpose** | Terminal archive of a closed or canceled exam |
| **Actor** | Admin |
| **Required capability** | `exam.archive` |
| **Current preset actors** | Admin only |
| **State transition** | `closed → archived` or `canceled → archived` |
| **Writes** | `exams.status = 'archived'` |
| **Transaction boundary** | `executeInTransaction` → `findByIdForUpdate` → reconcile → `archiveExam()` |
| **Audit event** | `exam.archived` (atomic) |
| **Idempotency behavior** | **Idempotent** — already-archived returns unchanged |

## Protocol: Exam Delete

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Delete |
| **Business purpose** | Delete a draft exam |
| **Actor** | Admin |
| **Required capability** | `exam.delete` |
| **Current preset actors** | Admin only |
| **Preconditions** | Exam is in `draft` state |
| **State transition** | None (row deleted) |
| **Writes** | `exams` row deleted |
| **Transaction boundary** | `executeInTransaction` → lock → guard (draft only) → `repo.delete` |
| **Audit event** | `exam.deleted` (atomic) |

## Protocol: Publish Results

| Field | Value |
|-------|-------|
| **Protocol name** | Publish Results |
| **Business purpose** | Make manual-mode exam results visible to candidates |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.result.publish` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Route** | `POST /exams/:id/publish-results` |
| **Preconditions** | Exam is `published`, `open`, or `closed` |
| **State transition** | None (status unchanged; `resultsPublishedAt` is a fact timestamp) |
| **Writes** | `exams.resultsPublishedAt = now` (write-once) |
| **Transaction boundary** | `executeInTransaction` → `publishResults()` (NO route-level reconciliation step) |
| **Idempotency behavior** | **Idempotent** — already-published returns `{ alreadyPublished: true }` without updating timestamp or re-emitting audit |
| **Audit event** | `exam.publish_results` (atomic, only on first publish) |
| **Security invariants** | INV-R-002: visibility is AND of publish-policy and grading-completeness |

---

## Protocol: Candidate Enrollment

| Field | Value |
|-------|-------|
| **Protocol name** | Candidate Enrollment |
| **Business purpose** | Grant a candidate eligibility to take an exam |
| **Actor** | Admin, Teacher |
| **Required capability** | `exam.enrollment.manage` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **Input contract** | Exam ID, candidate ID list |
| **State transition** | None (enrollment is created as `assigned`) |
| **Writes** | `exam_enrollments` rows |
| **Transaction boundary** | Per-candidate `executeInTransaction` with atomic audit |
| **Audit event** | `enrollment.created` (atomic) |

## Protocol: Attempt Start

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Start |
| **Business purpose** | Create a new attempt or resume a disrupted one |
| **Actor** | Candidate |
| **Required capability** | `attempt.start` + exam eligibility |
| **Current preset actors** | Candidate |
| **Route** | `POST /attempts/:examId/start` |
| **Preconditions** | Exam is `published` or `open`; `now` within `[openAt, closeAt)`; candidate is enrolled; retake policy allows; late-entry cutoff not passed |
| **State transition** | `enrollment.status: assigned → started`; attempt created as `in_progress` |
| **Writes** | `exam_attempts` row; `exam_enrollments.attemptCount + 1` |
| **Transaction boundary** | `executeInTransaction` → `startOrRestoreAttempt()` |
| **Idempotency behavior** | **Idempotent** — if an active `in_progress` attempt exists, returns it directly |
| **Audit event** | `attempt.started` (best-effort) |

## Protocol: Attempt Restore

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Restore |
| **Business purpose** | Explicitly restore a disrupted attempt back to in-progress |
| **Actor** | Candidate |
| **Required capability** | `attempt.restore` + own attempt |
| **Current preset actors** | Candidate |
| **Route** | `POST /attempts/:attemptId/restore` |
| **Preconditions** | Attempt exists and is owned by candidate; attempt status is `disrupted` |
| **Authoritative reads** | Attempt row (via EA lock); exam row |
| **State transition** | `disrupted → in_progress` |
| **Writes** | `exam_attempts.status = 'in_progress'`; `lastActivityAt`; interruption outcome event (`restored`); `bounded_grace` time-adjustment ledger row + adjusted `deadlineAt` only when the policy grants one |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `restoreInterruptedAttempt()` (composes: `evaluateInterruptionTimePolicy()` → optional `bounded_grace` adjustment + `deadlineAt` update → `ensureAttemptDeadlineReconciled()` → lifecycle-only `restoreAttemptState()` → `restored` outcome event). `grantAttemptTime()` is a separate operator command, not part of candidate restore. |
| **Idempotency behavior** | **Idempotent** — if already `in_progress`, reconstructs from the latest outcome; if terminal, reconstructs from outcome events without re-invoking lifecycle restore |
| **Audit event** | Interruption `restored` outcome event (append-only) |
| **Security invariants** | Candidate ownership verified; full episode identity (parent attempt + detected event + `interruptedAt`) validated; time compensation only via the frozen interruption-time policy |

## Protocol: Save Answer

| Field | Value |
|-------|-------|
| **Protocol name** | Save Answer |
| **Business purpose** | Persist a candidate's answer to a specific question |
| **Actor** | Candidate |
| **Required capability** | `attempt.answer.save` + own attempt |
| **Current preset actors** | Candidate |
| **Input contract** | `{ attemptId, questionId, answer, clientSeq, clientSavedAt, baseVersion }` |
| **Preconditions** | Attempt is `in_progress`; `now < effectiveDeadline`; question is in the attempt's snapshot |
| **State transition** | None (attempt stays `in_progress`) |
| **Writes** | `exam_attempts.answers` (new AnswerRecord); `exam_attempts.lastActivityAt` |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `prepareReconciledAttemptMutation` → `saveAnswer()` |
| **Idempotency behavior** | **Idempotent** per `(questionId, clientSeq)` — same key + same payload = replay (accepted, no write). Same key + different payload = `CONFLICTING_PAYLOAD`. |
| **Audit event** | None (versioned answer state is authority; per ADR-006 audit contract) |
| **Security invariants** | INV-A-003; question must be in the attempt's frozen snapshot; candidate ownership verified |

## Protocol: Attempt Heartbeat

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Heartbeat |
| **Business purpose** | Signal that the candidate is still connected |
| **Actor** | Candidate |
| **Required capability** | `attempt.heartbeat.send` + own attempt |
| **Current preset actors** | Candidate |
| **State transition** | None |
| **Writes** | `exam_attempts.lastActivityAt = now` |
| **Transaction boundary** | **NO transaction** — single `attemptRepo.update` |
| **Audit event** | None |

## Protocol: Deadline Reconciliation

| Field | Value |
|-------|-------|
| **Protocol name** | Deadline Reconciliation |
| **Business purpose** | Lazily freeze an attempt that has passed its effective deadline |
| **Actor** | System (triggered at candidate entry points) |
| **Required capability** | None (internal) |
| **Preconditions** | Attempt is `in_progress` or `disrupted`; `now >= effectiveDeadline` |
| **State transition** | `in_progress/disrupted → submitted` (then `→ graded` if auto-gradable) |
| **Writes** | `exam_attempts.status`, `submitted_answers`, `submittedAt`, `submissionReason = 'deadline'`, grading result |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `ensureAttemptDeadlineReconciled()` |
| **Idempotency behavior** | **Idempotent** — already-frozen attempts returned unchanged |
| **Audit event** | `attempt.deadline_reconciled` (atomic) |

## Protocol: Attempt Submit

| Field | Value |
|-------|-------|
| **Protocol name** | Attempt Submit |
| **Business purpose** | Freeze answers and trigger grading |
| **Actor** | Candidate (manual) or System (deadline) or Admin (force-submit) |
| **Required capability** | `attempt.submit` (candidate) / `attempt.force_submit` (admin) |
| **Current preset actors** | Candidate, Admin |
| **Input contract** | `{ attemptId }` (no answer payload — grades whatever is persisted) |
| **Preconditions** | Attempt is `in_progress` or `disrupted`; candidate submit respects `minSubmitAfterStartMinutes` |
| **State transition** | `in_progress/disrupted → submitted` (then `→ graded` if auto-gradable) |
| **Writes** | `exam_attempts.status = 'submitted'`; `submitted_answers` (frozen snapshot); `submittedAt`; `submissionReason`; `gradingStatus`; `attempt_grading_entries` (materialized workset) |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `submitAttempt()` |
| **Idempotency behavior** | **Idempotent** — already-submitted returns frozen snapshot unchanged; validates workset consistency |
| **Audit event** | `attempt.submit` (atomic) |
| **Security invariants** | INV-A-001, INV-A-002; submit carries NO answer payload |

## Protocol: Proctor Force Submit

| Field | Value |
|-------|-------|
| **Protocol name** | Proctor Force Submit |
| **Business purpose** | Force-submit an in-flight attempt |
| **Actor** | Admin, Proctor |
| **Required capability** | `attempt.force_submit` |
| **Current preset actors** | Admin, Proctor |
| **Preconditions** | Attempt is `in_progress` or `disrupted` |
| **State transition** | `in_progress/disrupted → submitted` (then `→ graded` if auto-gradable) |
| **Writes** | Same as Attempt Submit |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `submitAttempt()` (source `proctor`) |
| **Audit event** | `attempt.forceSubmit` (atomic) |

## Protocol: Operator Time Grant

| Field | Value |
|-------|-------|
| **Protocol name** | Operator Time Grant |
| **Business purpose** | Record one explicit Admin decision to add positive time to an eligible Attempt |
| **Actor** | Admin only; Proctor is not activated before M11 resource scope |
| **Required capability** | `attempt.time.grant` at Attempt scope |
| **Current preset actors** | Admin |
| **Route / contract** | `POST /admin/attempts/:attemptId/time-grants`; `TimeGrantRequest` / `TimeGrantResponse` |
| **Preconditions** | Target Attempt resolves in the actor organization; frozen policy is `operator_incident`; Attempt remains `in_progress` or `disrupted` after deadline reconciliation; `afterDeadline ≤ exam.closeAt` |
| **State transition** | None; terminal reconciliation wins and returns `terminal` without a grant |
| **Writes** | One append-only `attempt_time_adjustments` row; `exam_attempts.deadlineAt`; atomic `attempt.timeGrant` compliance audit on a real grant only |
| **Transaction boundary** | `grantWithOperationRaceRecovery()` → `executeInTransaction` → lock Enrollment → Attempt → Exam → `grantAttemptTime()` → adjustment insert → deadline update → atomic audit → commit |
| **Idempotency / conflict** | Same `operationId` + canonical payload returns `idempotent_replay`; different payload returns `IDEMPOTENCY_CONFLICT`; the exact `(organization_id, operation_id)` unique violation triggers one fresh-transaction recovery run for cross-Attempt races |
| **Security invariants** | The route uses `requireScopedCapability(AttemptTimeGrant, Attempt)`; client cannot set actor, source, policy, deadlines, or `incidentId`; no route-level deadline or ledger write exists |

The former `POST /admin/attempts/:id/extend-time` protocol is removed. Its
deprecated `attempt.extendTime` audit vocabulary is retained only for historical
facts; new positive operator decisions use this protocol and
`attempt.timeGrant`.

## Protocol: Automatic Grading

| Field | Value |
|-------|-------|
| **Protocol name** | Automatic Grading |
| **Business purpose** | Score objective questions against the frozen snapshot |
| **Actor** | System (triggered by submit or deadline reconciliation) |
| **Required capability** | None (internal) |
| **Preconditions** | Attempt is `submitted`; `gradingStatus !== pending_manual` |
| **State transition** | `submitted → graded` (if pure-objective) |
| **Writes** | `exam_attempts.status = 'graded'`; `score`; `passed`; `gradingResult`; `gradedAt`; `gradingStatus = 'auto_graded'`; enrollment final score |
| **Transaction boundary** | `executeInTransaction` → `lockEnrollmentAndAttempt` → `finalizeGrading()` → `finalizeTerminalGrading()` |
| **Idempotency behavior** | **Idempotent** — already-graded returns `false` |
| **Audit event** | `grading.finalized` (atomic) |
| **Security invariants** | INV-G-001: derives from frozen truth, not live questions |

## Protocol: Manual Grading

| Field | Value |
|-------|-------|
| **Protocol name** | Manual Grading |
| **Business purpose** | A grader scores a text_response question |
| **Actor** | Admin, Grader |
| **Required capability** | `grading.score.write` + scoped to attempt |
| **Current preset actors** | Admin, Grader |
| **Preconditions** | Attempt is `submitted`; `gradingStatus = 'pending_manual'`; entry is `pending_manual` |
| **State transition** | Entry: `pending_manual → completed_manual`. If last manual entry: attempt `submitted → graded`. |
| **Writes** | `attempt_grading_entries` (entry updated); if terminal: attempt `score`, `passed`, `gradingResult`, `gradedAt`, `gradingStatus = 'fully_graded'`; enrollment final score |
| **Transaction boundary** | `executeInTransaction` → `gradeQuestion()` → `finalizeTerminalGrading()` |
| **Idempotency behavior** | **NOT idempotent** — re-grading a `completed_manual` entry is rejected (one-way) |
| **Audit event** | `grading.score_entered` (atomic) |
| **Security invariants** | INV-G-002: materialized entry is the sole manual-work authority |

## Protocol: Terminal Grading Finalization

| Field | Value |
|-------|-------|
| **Protocol name** | Terminal Grading Finalization |
| **Business purpose** | The single canonical closure that projects the attempt total and enrollment result |
| **Actor** | `finalizeTerminalGrading()` (internal, called by auto-grade or manual-grade) |
| **Required capability** | None (internal) |
| **Preconditions** | Workset is fully terminal (all entries `completed_auto` or `completed_manual`); attempt is `submitted` |
| **State transition** | `submitted → graded`; enrollment `started → completed` (if policy says so) |
| **Writes** | `exam_attempts`: `status`, `score`, `passed`, `gradingResult`, `gradedAt`, `gradingStatus`; `exam_enrollments`: `status`, `finalScore`, `finalPassed`, `finalAttemptId` |
| **Transaction boundary** | Inside the caller's transaction (caller holds EA lock) |
| **Idempotency behavior** | **Idempotent** — already-graded returns `false` |
| **Audit event** | `grading.finalized` (atomic) |

## Protocol: Result Read

| Field | Value |
|-------|-------|
| **Protocol name** | Result Read (Candidate) |
| **Business purpose** | Return a candidate's result if visible |
| **Actor** | Candidate |
| **Required capability** | `score.own.view` |
| **Current preset actors** | Candidate |
| **State transition** | None |
| **Writes** | None |
| **Security invariants** | INV-R-001: standardAnswer/rubric NEVER exposed. INV-R-002: visibility is AND of publish-policy and grading-completeness. |

| Field | Value |
|-------|-------|
| **Protocol name** | Result Read (Admin/Teacher) |
| **Business purpose** | Return any candidate's result |
| **Actor** | Admin, Teacher |
| **Required capability** | `score.all.view` |
| **Current preset actors** | Admin, Teacher |
| **Scope status** | flat org-wide (Teacher marked scoped but resolver not implemented) |
| **State transition** | None |
| **Writes** | None |
| **Security invariants** | INV-R-001 does NOT apply — Admin/Teacher may see frozen standardAnswer in grading detail. Candidate ownership is NOT required for ScoreAllView. |

## Protocol: Result Export

| Field | Value |
|-------|-------|
| **Protocol name** | Result Export |
| **Business purpose** | Export exam scores as CSV |
| **Actor** | Admin |
| **Required capability** | `score.export` |
| **Current preset actors** | Admin only |
| **Preconditions** | Exam is ended; no unresolved attempts (route guard) |
| **Writes** | None |
| **Audit event** | `export_scores` (synchronous sensitive read) |
| **Security invariants** | Canceled exams MUST NOT expose normal scores/export |

---

## Email Infrastructure Protocols

### Email Outbox Claim (infrastructure, IMPLEMENTED)

| Field | Value |
|-------|-------|
| **Protocol name** | Email Worker Claim |
| **Business purpose** | Atomically claim due email rows for sending |
| **Actor** | Email delivery worker |
| **Preconditions** | Worker is running |
| **State transition** | `pending/retry_wait → processing` |
| **Writes** | `email_outbox.status = 'processing'`; `lockedAt`; `lockedBy`; `attemptCount + 1` |
| **Transaction boundary** | `executeInTransaction` (READ COMMITTED) — single atomic CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE RETURNING` |
| **Conflict behavior** | INV-MAIL-001: `FOR UPDATE SKIP LOCKED` prevents concurrent workers from claiming the same row |
| **Security invariants** | Ownership fence: subsequent updates require `lockedBy = workerInstanceId` |

### Email Worker Send/Retry/Dead (infrastructure, IMPLEMENTED)

| Field | Value |
|-------|-------|
| **Protocol name** | Email Worker Send/Retry/Dead |
| **Business purpose** | Send a claimed email and update its status |
| **Actor** | Email delivery worker |
| **State transition** | Success: `processing → sent`. Retryable failure: `processing → retry_wait`. Terminal failure: `processing → dead`. |
| **Writes** | `email_outbox.status`, `sentAt`/`nextAttemptAt`/`lastError`/`providerMessageId` |
| **Transaction boundary** | Send happens OUTSIDE the DB transaction; status update is a separate transaction |
| **Security invariants** | INV-N-001: SMTP never inside a DB transaction. Current semantic is at-least-once (crash after provider acceptance but before markSent may cause duplicate delivery). |

### Business Notification-to-Outbox Protocol (NOT IMPLEMENTED)

No production business transaction currently inserts an outbox row atomically. The infrastructure primitives (table, repo, service, worker) exist, but the business protocol that enqueues notification emails is NOT IMPLEMENTED. This is the P5-N1 scope.

## Protocol: Incident Authority (TARGET — NOT IMPLEMENTED)

Status: TARGET — designed by [ADR-014](../../adr/ADR-014-exam-incident-authority.md) (PROPOSED, pending human acceptance); runtime implementation NOT STARTED. The entries below are the proposed contracts that J3 (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`) will implement after ADR-014 is accepted; they are not live protocols. The architecture projection (state diagram, command inventory, permission matrix, sequences) lives in [incident-authority.md](./incident-authority.md).

### Incident Lifecycle

| Field | Value |
|-------|-------|
| **Protocol name** | Exam Incident Lifecycle |
| **Business purpose** | Record one operational incident (disruption, suspected misconduct, operator error, …) and carry its investigation to resolution or dismissal |
| **Actor** | Admin (all commands); Proctor (view/create/investigate only — activation blocked until M11 Proctor-to-Exam scope) |
| **Required capability** | `incident.view` / `incident.create` / `incident.investigate` (start, note, severity, action/attempt/interruption links) / `incident.resolve` (resolve AND dismiss; sensitive). All four are PROPOSED; J3 grants them to Admin only; Proctor grants are deferred to J4 (M11). |
| **Current preset actors** | None today; Admin after J3. The Proctor column is a target grant applied by J4 (M11) with exam-scope enforcement — J3 leaves the Proctor preset unchanged |
| **Route / contract** | `POST /admin/exams/:examId/incidents`, `GET /admin/exams/:examId/incidents`, `GET /admin/incidents/:incidentId`, `POST /admin/incidents/:incidentId/investigate`, `.../notes`, `.../severity`, `.../resolve`, `.../dismiss`, `.../actions`, `.../attempts`, `.../interruptions` (all PROPOSED) |
| **Preconditions** | Exam resolves in the actor organization; attempt anchor (if any) belongs to that exam; `type` is immutable after creation (a misclassification is dismissed and replaced by a new incident); the `attemptId` anchor is set at creation and immutable — membership links (`linkIncidentAttempt`) are allowed only on exam-wide incidents (`attemptId` null); terminal incidents reject every mutation except append-only notes and evidence/action links |
| **State transition** | `open → investigating → resolved` or `open → investigating → dismissed`; direct `open → resolved/dismissed` allowed; terminal states are monotonic (no reopen) |
| **Writes** | `exam_incidents` materialized row (version increment from 1); one append-only `exam_incident_events` row carrying `event_sequence` (IDENTITY), `operation_id` + `command_type`, and `before_version`/`after_version`; atomic `incident.created/investigated/note_added/severity_changed/resolved/dismissed` compliance audit |
| **Transaction boundary** | One transaction per command; `SELECT ... FOR UPDATE` on the incident row ONLY for version-bumping commands (investigate, severity change, resolve, dismiss); append-only commands (create, note, links) do NOT lock the incident row and rely on the operation unique constraint for idempotency and link uniques for deduplication. Incident commands never lock Attempt or Exam (non-locking validation reads). Notes and links MUST NOT update `exam_incidents.updatedAt` (conflict risk without row lock). On `23505` operation-unique violation: rollback → fresh transaction → query by `operationId` → same command + same payload → `idempotent_replayed`; different payload → `IDEMPOTENCY_CONFLICT`. On `23505` link-unique violation: entire transaction rolls back (no orphaned event). |
| **Idempotency / conflict** | Every write carries an `operationId` (client UUIDv4; retries reuse it), arbitrated by `UNIQUE (organization_id, operation_id)` on `exam_incident_events`: same `operationId` + same command + same canonical payload → idempotent replay (wire outcome `idempotent_replayed`); same `operationId` + different command/payload → 409 `IDEMPOTENCY_CONFLICT`; new `operationId` + stale `expectedVersion` → 409 `INCIDENT_VERSION_CONFLICT`; new `operationId` + invalid transition (including any on a terminal incident) → 409 `INVALID_STATE_TRANSITION`. There is no reason-text equivalence rule. `expectedVersion` is required only on investigate/severity/resolve/dismiss; append-only commands (create, note, links) carry none. Notes are append-only and concurrent-safe, each under its own `operationId`; display order is `event_sequence`. Concurrency: `23505` on the operation unique triggers rollback + fresh-transaction recovery (see Transaction boundary). `23505` on any link unique rolls back the entire transaction. Other `23505` is surfaced, never swallowed. |
| **Security invariants** | INV-I-001 (orthogonality), INV-I-002 (terminal monotonicity + type immutability + operationId/version), INV-I-003 (version-bumping commands only lock incident row; append-only commands do not lock), INV-I-005 (event_sequence ordering + verifiable version chain across bump events only; notes/links skipped); no candidate-facing API; note/description bodies are never duplicated into audit metadata |

### Incident-to-Action Link

| Field | Value |
|-------|-------|
| **Protocol name** | Incident Action Link |
| **Business purpose** | Correlate an already-authoritative operator action (time grant, force submit) with the incident that motivated it, without making the incident an authority over the action. `misconduct_mark` is deferred: its jsonb flag is overwritten on re-flag and has no stable append-only action receipt, so J3 rejects it with 400 `VALIDATION_ERROR` (audit-log ids never substitute for business action identity) |
| **Actor** | Admin |
| **Required capability** | `incident.investigate` for retroactive links; the action's own capability for the combined grant+link path (`attempt.time.grant`) |
| **Current preset actors** | Admin (holds `attempt.time.grant` today; `incident.investigate` after J3); Proctor deferred to J4 (M11) |
| **Route / contract** | `POST /admin/incidents/:incidentId/actions` (retroactive, PROPOSED); `POST /admin/attempts/:attemptId/time-grants` extended with an optional `incidentId` (combined path, PROPOSED) |
| **Preconditions** | Link-scope quadruple derived server-side from the authoritative action/Attempt row (never from the request): `incident.organizationId == action.organizationId`, `incident.examId == action.examId`, `incident.attemptId` null or matching the action's attempt, and `incident.candidateId` null or matching the target attempt's candidate; the action row exists (retroactive) or is created atomically (combined); action type ∈ `time_grant` / `force_submit`; for `force_submit`, a committed `attempt.forceSubmit` audit fact must exist for the target attempt (submission source is not persisted on the attempt row) |
| **State transition** | None on either side; incident status and attempt status are unchanged by linking |
| **Writes** | One `exam_incident_actions` row (action identity + type ∈ `time_grant` / `force_submit`; `misconduct_mark` deferred); `attempt_time_adjustments.incidentId` set only on the combined grant path; append-only `action_linked` event (with `event_sequence`, `operation_id`, `before_version`/`after_version`) + atomic audit |
| **Transaction boundary** | Combined grant+link runs inside the existing time-grant transaction (Enrollment → Attempt → Exam lock order unchanged; the incident row is validated without a lock, exam derived from the locked Attempt); retroactive link does NOT lock the incident row (append-only, constraint-arbiterated) |
| **Idempotency / conflict** | Every link carries an `operationId`; `UNIQUE (organization_id, action_type, action_id)` — one action links to at most one incident; duplicate under the same `operationId` + same payload → idempotent replay; duplicate under a new `operationId` (including a same-incident re-link) → 409 `INCIDENT_ACTION_ALREADY_LINKED` (23505 on the named constraint); the combined path keeps the grant's `operationId` idempotency (`granted` / `idempotent_replay` / `terminal`). On `23505` operation-unique violation during the retroactive link's event insert: rollback → fresh-transaction query by `operationId` → same command + same payload → `idempotent_replayed`; different payload → `IDEMPOTENCY_CONFLICT`. On `23505` link-unique: entire transaction rolls back (no orphaned event). |
| **Security invariants** | INV-I-001: the link is correlation, not authority — incident resolution never triggers, modifies, or reverses the action; INV-I-003: only version-bumping incident commands lock the incident row; append-only links do not; INV-I-004: scope quadruple server-derived (org, exam, attempt, candidate), composite FKs enforce organization/attempt consistency; INV-I-005: event ordering |

### Incident-to-Attempt Evidence Link

| Field | Value |
|-------|-------|
| **Protocol name** | Incident Attempt Evidence Link |
| **Business purpose** | Record which attempts an exam-wide incident affected or referenced, as append-only evidence relationships that do not absorb Attempt authority |
| **Actor** | Admin |
| **Required capability** | `incident.investigate` |
| **Current preset actors** | Admin after J3; Proctor deferred to J4 (M11) |
| **Route / contract** | `POST /admin/incidents/:incidentId/attempts` (PROPOSED) |
| **Preconditions** | The incident is exam-wide (`attemptId` null) — anchored incidents reject membership links with 409 `INVALID_STATE_TRANSITION` (anchor exclusivity); the attempt belongs to `incident.examId` (server-derived); when `incident.candidateId` is set, the target attempt's candidate MUST match (validated server-side); `relationshipType` ∈ `affected` / `referenced` |
| **State transition** | None; attempt status is unchanged |
| **Writes** | One `exam_incident_attempts` row (`incidentId`, `attemptId`, `relationshipType`, `linkedAt`, `linkedBy`); append-only `attempt_linked` event + atomic `incident.attempt_linked` audit |
| **Transaction boundary** | Scope validation (non-locking) → insert junction (unique arbiter) + event + audit; no incident row lock (append-only, constraint-arbiterated) |
| **Idempotency / conflict** | Every link carries an `operationId`; `UNIQUE (incident_id, attempt_id)`; duplicate under the same `operationId` + same payload → idempotent replay; duplicate under a new `operationId` → 409 `INCIDENT_ACTION_ALREADY_LINKED` (the code covers all three link uniques); no unlink, no bulk-link (a batch is N operationId-keyed calls). On `23505` operation-unique violation: rollback → fresh-transaction query by `operationId` → same command + same payload → `idempotent_replayed`; different payload → `IDEMPOTENCY_CONFLICT`. |
| **Security invariants** | INV-I-001 (evidence, not authority), INV-I-003 (only version-bumping commands lock incident row; append-only links do not), INV-I-004 (scope quadruple + composite FK reusing `exam_attempts_org_id_unique`), INV-I-005 (event ordering) |

### Incident-to-Interruption Evidence Link

| Field | Value |
|-------|-------|
| **Protocol name** | Incident Interruption Evidence Link |
| **Business purpose** | Correlate interruption episodes with the incident that explains them, as append-only evidence; the interruption ledger row remains the authority for compensated time |
| **Actor** | Admin |
| **Required capability** | `incident.investigate` |
| **Current preset actors** | Admin after J3; Proctor deferred to J4 (M11) |
| **Route / contract** | `POST /admin/incidents/:incidentId/interruptions` (PROPOSED) |
| **Preconditions** | The episode's attempt belongs to `incident.examId` (server-derived); when `incident.candidateId` is set, the episode's attempt candidate MUST match (validated server-side); anchored incidents require `episode.attemptId == incident.attemptId`; `interruptionId` and `incidentId` are never interchangeable (ADR-013) |
| **State transition** | None; episode and attempt status are unchanged |
| **Writes** | One `exam_incident_interruption_links` row (`incidentId`, `attemptId`, `interruptionId`, `linkedAt`, `linkedBy`); append-only `interruption_linked` event + atomic `incident.interruption_linked` audit |
| **Transaction boundary** | Scope validation (non-locking) → insert junction (unique arbiter) + event + audit; no incident row lock (append-only, constraint-arbiterated) |
| **Idempotency / conflict** | Every link carries an `operationId`; `UNIQUE (incident_id, interruption_id)`; duplicate under the same `operationId` + same payload → idempotent replay; duplicate under a new `operationId` → 409 `INCIDENT_ACTION_ALREADY_LINKED` (the code covers all three link uniques). On `23505` operation-unique violation: rollback → fresh-transaction query by `operationId` → same command + same payload → `idempotent_replayed`; different payload → `IDEMPOTENCY_CONFLICT`. |
| **Security invariants** | INV-I-001 (evidence, not authority; the ledger stays authoritative for compensated interruptions), INV-I-003 (only version-bumping commands lock incident row; append-only links do not), INV-I-004 (scope quadruple + composite FK reusing `attempt_interruptions_org_attempt_id_unique`), INV-I-005 (event ordering) |
