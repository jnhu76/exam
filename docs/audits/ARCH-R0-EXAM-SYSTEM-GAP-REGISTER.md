# ARCH-R0: Exam System Gap Register

> Detailed register of every architecture gap found during the reality audit, classified and prioritized.

## Summary

| Classification | Count |
|----------------|-------|
| DEFECT | 0 |
| SECURITY_DEFECT | 0 |
| MISSING_PROOF | 6 |
| DOCUMENTATION_DRIFT | 1 |
| ARCHITECTURAL_DEBT | 3 |
| ACCEPTED_LIMITATION | 5 |
| FUTURE_CAPABILITY | 0 |
| OPEN_DECISION | 0 |
| OVERDESIGN_RISK | 0 |
| NOT_A_PROBLEM | 14 |

---

## Gaps

### GAP-001

| Field | Value |
|-------|-------|
| **ID** | GAP-001 |
| **Title** | `grading` attempt state transition table entries are unreachable |
| **Classification** | ARCHITECTURAL_DEBT |
| **Affected aggregate/protocol** | Attempt state machine (`attemptStateMachine.ts`) |
| **Current behavior** | The transition table defines `submitted:grade → grading` and `grading:complete_grading → graded`, but `finalizeTerminalGrading()` writes `status = 'graded'` directly, bypassing the `grading` state entirely. |
| **Expected invariant** | Either the `grading` state should be reachable (for future async grading), or the transition table entries should be removed to avoid misleading readers. |
| **Evidence** | `attemptStateMachine.ts` lines 43-44; `grading.ts::finalizeTerminalGrading()` writes `status: 'graded'` directly. |
| **Risk** | Low — no functional impact, but the state machine table is misleading for readers. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | Document the `grading` state as "reserved for future async grading" in the state machine file, or remove the transition table entries. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R1 |
| **Priority** | P2 |
| **Scope boundary** | `packages/exam-engine/src/attemptStateMachine.ts` + documentation |

---

### GAP-002

| Field | Value |
|-------|-------|
| **ID** | GAP-002 |
| **Title** | `hasSubjectiveQuestions` deprecated but still exported |
| **Classification** | ARCHITECTURAL_DEBT |
| **Affected aggregate/protocol** | Grading classification (`gradingEngine.ts`) |
| **Current behavior** | `hasSubjectiveQuestions()` is marked `@deprecated` with a clear doc comment directing consumers to `requiresManualGrading()`. It is still exported from the module. |
| **Expected invariant** | Deprecated functions with a canonical replacement should be removed after confirming zero consumers. |
| **Evidence** | `gradingEngine.ts::hasSubjectiveQuestions()` (deprecated). |
| **Risk** | Low — the deprecation is clearly documented. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | After confirming zero internal consumers, remove the deprecated export. |
| **Dependency** | Confirm zero consumers. |
| **Proposed Job** | ARCH-R5 |
| **Priority** | P3 |
| **Scope boundary** | `packages/domain/src/gradingEngine.ts` |

---

### GAP-003

| Field | Value |
|-------|-------|
| **ID** | GAP-003 |
| **Title** | No DB-level constraint enforcing `exam.totalScore = SUM(questionSnapshot.score)` |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Exam publish (`examCommands.ts::publishExam`) |
| **Current behavior** | `publishExam()` validates that `exam.totalScore` equals the sum of question scores. There is no DB constraint enforcing this invariant. |
| **Expected invariant** | The invariant should be enforced at the DB level (trigger or application-level guarantee) to prevent data corruption from future code paths that bypass `publishExam()`. |
| **Evidence** | `examCommands.ts::publishExam()` validation logic; `packages/db/src/schema/pg.ts` `exams` table (no trigger). |
| **Risk** | Low — the only publish path goes through `publishExam()`. Future code paths could bypass it. |
| **User-visible consequence** | If totalScore is wrong, passing score calculations are wrong. |
| **Security consequence** | None. |
| **Recommended action** | Add a DB trigger or document the application-level guarantee as the permanent enforcement. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R2 |
| **Priority** | P2 |
| **Scope boundary** | `packages/db/src/schema/pg.ts` + migration |

---

### GAP-004

| Field | Value |
|-------|-------|
| **ID** | GAP-004 |
| **Title** | No DB-level constraint preventing `submitted_answers` mutation after submit |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Submit freeze barrier (`attemptCommands.ts::submitAttempt`) |
| **Current behavior** | `submitted_answers` is written once in the submit transaction. No DB constraint prevents a future code path from updating it. |
| **Expected invariant** | `submitted_answers` should be immutable after submit. |
| **Evidence** | `attemptCommands.ts::submitAttempt()` writes `submitted_answers`; `packages/db/src/schema/pg.ts` `exam_attempts` table (no trigger or constraint). |
| **Risk** | Low — the only writer is `submitAttempt()`. But the invariant is not enforced at the DB level. |
| **User-visible consequence** | If `submitted_answers` were mutated, grading would be based on wrong answers. |
| **Security consequence** | None. |
| **Recommended action** | Add a DB trigger to prevent `submitted_answers` mutation after the attempt is `submitted`/`grading`/`graded`. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R2 |
| **Priority** | P2 |
| **Scope boundary** | `packages/db/src/schema/pg.ts` + migration |

---

### GAP-005

| Field | Value |
|-------|-------|
| **ID** | GAP-005 |
| **Title** | No integration test for concurrent Save + Submit |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Save Answer protocol + Submit freeze barrier |
| **Current behavior** | Unit tests exist for `processSaveAnswer()` and `submitAttempt()` in isolation. No integration test proves the barrier under concurrent load (one thread saving while another submits). |
| **Expected invariant** | The submit freeze barrier MUST serialize save against submit. |
| **Evidence** | Test files for `answerProtocol.ts` and `attemptCommands.ts` (unit only). |
| **Risk** | Medium — the barrier is critical for answer integrity. Without an integration test, a regression could go unnoticed. |
| **User-visible consequence** | If the barrier fails, a candidate could save answers after submit, corrupting grading. |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that fires concurrent save + submit on the same attempt and verifies exactly one wins. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R3 |
| **Priority** | P2 |
| **Scope boundary** | Test files for `answerProtocol.ts` + `attemptCommands.ts` |

---

### GAP-006

| Field | Value |
|-------|-------|
| **ID** | GAP-006 |
| **Title** | No integration test for concurrent deadline scanner + candidate save |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Deadline reconciliation + Save Answer protocol |
| **Current behavior** | Unit tests exist for `ensureAttemptDeadlineReconciled()` and `processSaveAnswer()`. No integration test proves the scanner and a candidate save don't corrupt each other. |
| **Expected invariant** | The deadline scanner's auto-submit MUST serialize against a concurrent candidate save. |
| **Evidence** | Test files for `deadlineReconciliation.ts` and `answerProtocol.ts` (unit only). |
| **Risk** | Medium — concurrent scanner + save could theoretically corrupt the answer set. |
| **User-visible consequence** | If serialization fails, a candidate's answers could be partially saved after auto-submit. |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that runs the deadline scanner while a concurrent save is in progress. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R3 |
| **Priority** | P2 |
| **Scope boundary** | Test files for `deadlineReconciliation.ts` + `answerProtocol.ts` |

---

### GAP-007

| Field | Value |
|-------|-------|
| **ID** | GAP-007 |
| **Title** | No integration test for concurrent email workers |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Email worker claim protocol |
| **Current behavior** | Unit tests exist for `claimDue()`. No integration test proves that two concurrent workers never claim the same row. |
| **Expected invariant** | `FOR UPDATE SKIP LOCKED` MUST prevent double-claim. |
| **Evidence** | Test files for `emailOutboxRepo.ts` (unit only). |
| **Risk** | Low — `FOR UPDATE SKIP LOCKED` is a well-understood PostgreSQL primitive. But the specific query should be proven. |
| **User-visible consequence** | If double-claim occurs, a candidate receives duplicate emails. |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that runs two concurrent `claimDue()` calls and verifies no row is claimed twice. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R4 |
| **Priority** | P3 |
| **Scope boundary** | Test files for `emailOutboxRepo.ts` |

---

### GAP-008

| Field | Value |
|-------|-------|
| **ID** | GAP-008 |
| **Title** | No integration test for concurrent grading of the last manual question |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Manual grading terminality (`manualGrading.ts::gradeQuestion`) |
| **Current behavior** | Unit tests exist for `gradeQuestion()`. No integration test proves that two concurrent graders scoring the last manual question don't both trigger `finalizeTerminalGrading()`. |
| **Expected invariant** | Only ONE `finalizeTerminalGrading()` call should succeed when the last manual question is scored. |
| **Evidence** | Test files for `manualGrading.ts` (unit only). |
| **Risk** | Medium — concurrent terminal grading could cause double-enrollment-updates or inconsistent state. |
| **User-visible consequence** | If both succeed, the enrollment final score could be set twice (idempotent, but wasteful). |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that fires two concurrent `gradeQuestion()` calls for the last manual question. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R3 |
| **Priority** | P2 |
| **Scope boundary** | Test files for `manualGrading.ts` |

---

### GAP-009

| Field | Value |
|-------|-------|
| **ID** | GAP-009 |
| **Title** | SPEC.md lists `voidAttempt` as a command function but it does not exist |
| **Classification** | DOCUMENTATION_DRIFT |
| **Affected aggregate/protocol** | Attempt state machine (voided state) |
| **Current behavior** | SPEC.md §3.3 lists `voidAttempt(ctx, attemptId, reason)` as a command function. The code has no `voidAttempt` function in `attemptCommands.ts`. |
| **Expected invariant** | Documentation should accurately reflect the implemented command set. |
| **Evidence** | SPEC.md §3.3; `packages/exam-engine/src/attemptCommands.ts` (no `voidAttempt` export). |
| **Risk** | Low — `voided` is target design with no write path. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | Update SPEC.md to mark `voidAttempt` as "target design — no implementation" (consistent with the attempt state table in SPEC.md §2.2). |
| **Dependency** | None. |
| **Proposed Job** | Documentation fix. |
| **Priority** | P3 |
| **Scope boundary** | `docs/SPEC.md` §3.3 |

---

### GAP-010

| Field | Value |
|-------|-------|
| **ID** | GAP-010 |
| **Title** | `computeGradingResult` fallback to draft answers for legacy rows |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Grading computation (`grading.ts::computeGradingResult`) |
| **Current behavior** | For legacy attempts with NULL `submitted_answers`, `computeGradingResult()` falls back to draft `attempt.answers`. The TODO comment (P3-L0-4) says this fallback should be removed after backfill. |
| **Expected invariant** | After backfill, all submitted/graded attempts should have non-null `submitted_answers`, and the fallback should be removed. |
| **Evidence** | `grading.ts::computeGradingResult()` (fallback logic + TODO comment). |
| **Risk** | Low — the fallback is a migration-window accommodation. |
| **User-visible consequence** | None (legacy rows are historical). |
| **Security consequence** | None. |
| **Recommended action** | After the backfill script completes, remove the fallback and require `submitted_answers` strictly. |
| **Dependency** | P3-L0-4 backfill completion. |
| **Proposed Job** | P3-L0-4 follow-up. |
| **Priority** | P3 |
| **Scope boundary** | `packages/exam-engine/src/grading.ts` |

---

### GAP-011

| Field | Value |
|-------|-------|
| **ID** | GAP-011 |
| **Title** | Email worker crash between SMTP send and `markSent` causes duplicate delivery |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Email worker delivery protocol |
| **Current behavior** | If the worker crashes after SMTP send succeeds but before `markSent()` commits, the row remains `processing`. After lock recovery, it is reset to `pending` and re-sent. |
| **Expected invariant** | At-least-once delivery is the accepted semantic. |
| **Evidence** | `apps/api/src/email/outboxService.ts` + `apps/api/src/workers/emailDeliveryWorker.ts`. |
| **Risk** | Low — duplicates are acceptable for the current use cases. |
| **User-visible consequence** | A candidate may receive the same email twice (rare). |
| **Security consequence** | None. |
| **Recommended action** | None required for Phase 1. For higher-assurance delivery, consider idempotent provider-side deduplication. |
| **Dependency** | None. |
| **Proposed Job** | None (accepted). |
| **Priority** | P3 |
| **Scope boundary** | `apps/api/src/email/` |

---

### GAP-012

| Field | Value |
|-------|-------|
| **ID** | GAP-012 |
| **Title** | Heartbeat route bypasses engine layer (direct repo update) |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Attempt heartbeat protocol |
| **Current behavior** | `POST /attempts/:attemptId/heartbeat` calls `attemptRepo.update(ctx, id, { lastActivityAt: now })` directly, without going through `attemptCommands.ts`. |
| **Expected invariant** | All attempt mutations should go through engine command functions. |
| **Evidence** | `apps/api/src/routes/attempts.candidate.ts` (heartbeat handler). |
| **Risk** | Low — heartbeat is a simple timestamp update with no state transition. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | None required — the bypass is intentional for performance (heartbeat is high-frequency). |
| **Dependency** | None. |
| **Proposed Job** | None (accepted). |
| **Priority** | P3 |
| **Scope boundary** | `apps/api/src/routes/attempts.candidate.ts` |

---

### GAP-013

| Field | Value |
|-------|-------|
| **ID** | GAP-013 |
| **Title** | No referential integrity guard for question deletion |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Question delete protocol |
| **Current behavior** | Deleting a question does not check whether it is referenced by existing `exam.questionSnapshot` or `attempt.questionSnapshot` rows. Snapshots are copies, so historical attempts are not broken. |
| **Expected invariant** | The question bank should warn or prevent deletion of questions referenced by published exams. |
| **Evidence** | `apps/api/src/routes/question.ts` (delete handler). |
| **Risk** | Low — snapshots are copies. But the question bank loses the source. |
| **User-visible consequence** | An admin may delete a question that is still in use by a published exam. The exam continues to work (snapshot), but the question bank is inconsistent. |
| **Security consequence** | None. |
| **Recommended action** | Add a warning or soft-delete for questions referenced by published exams. |
| **Dependency** | None. |
| **Proposed Job** | Future product job. |
| **Priority** | P3 |
| **Scope boundary** | `apps/api/src/routes/question.ts` + `packages/db/src/repository/questionRepo.ts` |

---

### GAP-014

| Field | Value |
|-------|-------|
| **ID** | GAP-014 |
| **Title** | Email outbox has no production business caller |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Email outbox enqueue protocol |
| **Current behavior** | The `email_outbox` table, repository, worker, and senders exist. No production route ever calls `emailOutboxRepo.create()`. The infrastructure is complete but unused. |
| **Expected invariant** | Email infrastructure should have at least one business caller to be meaningful. |
| **Evidence** | `apps/api/src/email/outboxService.ts` (no callers in routes/). |
| **Risk** | None — unused code is not a defect. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | Implement P5-N1 (Notification Inbox + result-published Email) to activate the email infrastructure. |
| **Dependency** | P5-0 (Email delivery runtime hardening). |
| **Proposed Job** | P5-N1 |
| **Priority** | P3 (queued) |
| **Scope boundary** | `apps/api/src/email/` + `apps/api/src/routes/` |

---

## Priority Summary

| Priority | Gaps | Action |
|----------|------|--------|
| **P0** | 0 | — |
| **P1** | 0 | — |
| **P2** | GAP-001, GAP-003, GAP-004, GAP-005, GAP-006, GAP-008 | ARCH-R1, ARCH-R2, ARCH-R3 |
| **P3** | GAP-002, GAP-007, GAP-009, GAP-010, GAP-011, GAP-012, GAP-013, GAP-014 | ARCH-R4, ARCH-R5, documentation fix, P3-L0-4 follow-up, P5-N1 |

---

## Grouped Future Jobs

| Job | Gaps addressed | Priority |
|-----|---------------|----------|
| **ARCH-R1: Clean up attempt state machine** | GAP-001 | P2 |
| **ARCH-R2: Add DB-level invariant constraints** | GAP-003, GAP-004 | P2 |
| **ARCH-R3: Integration tests for concurrency** | GAP-005, GAP-006, GAP-008 | P2 |
| **ARCH-R4: Integration test for email workers** | GAP-007 | P3 |
| **ARCH-R5: Remove deprecated export** | GAP-002 | P3 |
| **Documentation: Fix SPEC.md voidAttempt** | GAP-009 | P3 |
| **P3-L0-4 follow-up: Remove draft-answer fallback** | GAP-010 | P3 |
| **P5-N1: Activate email infrastructure** | GAP-014 | P3 (queued) |
