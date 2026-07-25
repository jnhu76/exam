# ARCH-R0: Exam System Gap Register

> Detailed register of every architecture gap found during the reality audit, classified and prioritized.

```text
Architecture reality base:
cac6b85c425c85ad4077002bc518fca0b50f766f
```

## Summary

| Classification | Count |
|----------------|-------|
| DEFECT | 0 |
| SECURITY_DEFECT | 0 |
| MISSING_PROOF | 3 |
| DOCUMENTATION_DRIFT | 1 |
| ARCHITECTURAL_DEBT | 2 |
| ACCEPTED_LIMITATION | 4 |
| NOT_A_PROBLEM | 0 |

Future capability inventory is **not included** in gap classification totals.

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
| **Expected invariant** | Either the `grading` state should be reachable, or the transition table entries should be removed/documented as reserved. |
| **Evidence** | `attemptStateMachine.ts` lines 43-44; `grading.ts::finalizeTerminalGrading()` writes `status: 'graded'` directly. |
| **Risk** | Low — no functional impact, but the state machine table is misleading. |
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
| **Proposed Job** | ARCH-R4 |
| **Priority** | P3 |
| **Scope boundary** | `packages/domain/src/gradingEngine.ts` |

---

### GAP-003

| Field | Value |
|-------|-------|
| **ID** | GAP-003 |
| **Title** | No integration test for concurrent deadline scanner + candidate save |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Deadline reconciliation + Save Answer protocol |
| **Current behavior** | Unit tests exist for `ensureAttemptDeadlineReconciled()` and `processSaveAnswer()`. No integration test proves the scanner and a candidate save don't corrupt each other under concurrent load. |
| **Expected invariant** | The deadline scanner's auto-submit MUST serialize against a concurrent candidate save. |
| **Evidence** | Test files for `deadlineReconciliation.ts` and `answerProtocol.ts` (unit only). |
| **Risk** | Medium — concurrent scanner + save could theoretically corrupt the answer set. |
| **User-visible consequence** | If serialization fails, a candidate's answers could be partially saved after auto-submit. |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that runs the deadline scanner while a concurrent save is in progress. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R2 |
| **Priority** | P2 |
| **Scope boundary** | Test files for `deadlineReconciliation.ts` + `answerProtocol.ts` |

---

### GAP-004

| Field | Value |
|-------|-------|
| **ID** | GAP-004 |
| **Title** | No integration test for concurrent grading of the last manual question |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Manual grading terminality (`manualGrading.ts::gradeQuestion`) |
| **Current behavior** | Unit tests exist for `gradeQuestion()`. No integration test proves that two concurrent graders scoring the last manual question don't both trigger `finalizeTerminalGrading()`. |
| **Expected invariant** | Only ONE `finalizeTerminalGrading()` call should succeed when the last manual question is scored. |
| **Evidence** | Test files for `manualGrading.ts` (unit only). |
| **Risk** | Medium — concurrent terminal grading could cause double-enrollment-updates. |
| **User-visible consequence** | If both succeed, the enrollment final score could be set twice (idempotent, but wasteful). |
| **Security consequence** | None. |
| **Recommended action** | Write an integration test that fires two concurrent `gradeQuestion()` calls for the last manual question. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R3 |
| **Priority** | P2 |
| **Scope boundary** | Test files for `manualGrading.ts` |

---

### GAP-005

| Field | Value |
|-------|-------|
| **ID** | GAP-005 |
| **Title** | No dedicated test for cross-Candidate 404 vs 403 anti-enumeration |
| **Classification** | MISSING_PROOF |
| **Affected aggregate/protocol** | Cross-Candidate attempt access (`requireOwnAttempt`) |
| **Current behavior** | Route tests exist for `requireOwnAttempt`. No dedicated test proves that cross-candidate probes return 404 (not 403). |
| **Expected invariant** | INV-SEC-002: Cross-Candidate attempt access MUST return 404. |
| **Evidence** | Route test files (general ownership tests exist). |
| **Risk** | Low — the 404 behavior is implemented in `ownAttemptCapability.ts`. |
| **User-visible consequence** | If 403 were returned, an attacker could enumerate attempt IDs. |
| **Security consequence** | Low — information leakage via status code distinction. |
| **Recommended action** | Add a dedicated test that verifies 404 (not 403) for cross-candidate attempt probes. |
| **Dependency** | None. |
| **Proposed Job** | ARCH-R2 |
| **Priority** | P2 |
| **Scope boundary** | Route test files for `attempts.candidate.ts` |

---

### GAP-006

| Field | Value |
|-------|-------|
| **ID** | GAP-006 |
| **Title** | SPEC.md lists `voidAttempt` as a command function but it does not exist |
| **Classification** | DOCUMENTATION_DRIFT |
| **Affected aggregate/protocol** | Attempt state machine (voided state) |
| **Current behavior** | SPEC.md §3.3 lists `voidAttempt(ctx, attemptId, reason)` as a command function. The code has no `voidAttempt` function in `attemptCommands.ts`. |
| **Expected invariant** | Documentation should accurately reflect the implemented command set. |
| **Evidence** | SPEC.md §3.3; `packages/exam-engine/src/attemptCommands.ts` (no `voidAttempt` export). |
| **Risk** | Low — `voided` is target design with no write path. |
| **User-visible consequence** | None. |
| **Security consequence** | None. |
| **Recommended action** | Update SPEC.md to mark `voidAttempt` as "target design — no implementation". |
| **Dependency** | None. |
| **Proposed Job** | Documentation fix. |
| **Priority** | P3 |
| **Scope boundary** | `docs/SPEC.md` §3.3 |

---

### GAP-007

| Field | Value |
|-------|-------|
| **ID** | GAP-007 |
| **Title** | No DB-level constraint enforcing `exam.totalScore = SUM(questionSnapshot.score)` |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Exam publish (`examCommands.ts::publishExam`) |
| **Current behavior** | `publishExam()` validates that `exam.totalScore` equals the sum of question scores. There is no DB constraint enforcing this invariant. The only publish path goes through `publishExam()`. |
| **Expected invariant** | totalScore should equal the sum of question scores. |
| **Evidence** | `examCommands.ts::publishExam()` validation logic; `packages/db/src/schema/pg.ts` `exams` table (no trigger). |
| **Risk** | Low — application-level enforcement is the accepted architecture. No production path bypasses `publishExam()`. A PostgreSQL trigger would duplicate complex domain logic (JSONB aggregation). |
| **User-visible consequence** | None (enforced at application layer). |
| **Security consequence** | None. |
| **Recommended action** | None required. Application-level enforcement is the accepted architecture. |
| **Dependency** | None. |
| **Proposed Job** | None (accepted). |
| **Priority** | P3 |
| **Scope boundary** | `packages/db/src/schema/pg.ts` + `examCommands.ts` |

---

### GAP-008

| Field | Value |
|-------|-------|
| **ID** | GAP-008 |
| **Title** | No DB-level constraint preventing `submitted_answers` mutation after submit |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Submit freeze barrier (`attemptCommands.ts::submitAttempt`) |
| **Current behavior** | `submitted_answers` is written once in the submit transaction. No DB constraint prevents a future code path from updating it. The only writer is `submitAttempt()`. |
| **Expected invariant** | `submitted_answers` should be immutable after submit. |
| **Evidence** | `attemptCommands.ts::submitAttempt()` writes `submitted_answers`; `packages/db/src/schema/pg.ts` `exam_attempts` table (no trigger or constraint). |
| **Risk** | Low — application-level enforcement is the accepted architecture. No production path bypasses `submitAttempt()`. |
| **User-visible consequence** | None (enforced at application layer). |
| **Security consequence** | None. |
| **Recommended action** | None required. Application-level enforcement is the accepted architecture. |
| **Dependency** | None. |
| **Proposed Job** | None (accepted). |
| **Priority** | P3 |
| **Scope boundary** | `packages/db/src/schema/pg.ts` + `attemptCommands.ts` |

---

### GAP-009

| Field | Value |
|-------|-------|
| **ID** | GAP-009 |
| **Title** | Email worker crash between SMTP send and `markSent` causes duplicate delivery |
| **Classification** | ACCEPTED_LIMITATION |
| **Affected aggregate/protocol** | Email worker delivery protocol |
| **Current behavior** | If the worker crashes after SMTP send succeeds but before `markSent()` commits, the row remains `processing`. After lock recovery, it is reset to `pending` and re-sent. |
| **Expected invariant** | At-least-once delivery is the accepted semantic. |
| **Evidence** | `apps/api/src/email/outboxService.ts` + `apps/api/src/workers/emailDeliveryWorker.ts`. |
| **Risk** | Low — duplicates are acceptable for the current use cases. |
| **User-visible consequence** | A candidate may receive the same email twice (rare). |
| **Security consequence** | None. |
| **Recommended action** | None required for Phase 1. |
| **Dependency** | None. |
| **Proposed Job** | None (accepted). |
| **Priority** | P3 |
| **Scope boundary** | `apps/api/src/email/` |

---

### GAP-010

| Field | Value |
|-------|-------|
| **ID** | GAP-010 |
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

## Disproven Gaps (removed)

| ID | Title | Reason |
|----|-------|--------|
| ~~GAP-005 (old)~~ | No integration test for concurrent Save + Submit | **DISPROVEN** — `submitFreezeBarrier.test.ts` uses real PostgreSQL with 5 race iterations; `save-submit-race.spec.ts` provides E2E evidence. Classified: PROVEN / NOT_A_PROBLEM. |
| ~~GAP-007 (old)~~ | No integration test for concurrent Email workers | **DISPROVEN** — `emailOutboxRepo.test.ts` has a `claimDue` SKIP LOCKED test with two workers and disjoint claim sets. Classified: PROVEN / NOT_A_PROBLEM. |

---

## Priority Summary

| Priority | Gaps | Action |
|----------|------|--------|
| **P0** | 0 | — |
| **P1** | 0 | — |
| **P2** | GAP-001, GAP-003, GAP-004, GAP-005 | ARCH-R1, ARCH-R2, ARCH-R3 |
| **P3** | GAP-002, GAP-006, GAP-007, GAP-008, GAP-009, GAP-010 | ARCH-R4, documentation fix |

---

## Grouped Future Jobs

| Job | Gaps addressed | Priority |
|-----|---------------|----------|
| **ARCH-R1: Clean up attempt state machine** | GAP-001 | P2 |
| **ARCH-R2: Integration tests for concurrency** | GAP-003, GAP-005 | P2 |
| **ARCH-R3: Integration test for manual grading** | GAP-004 | P2 |
| **ARCH-R4: Remove deprecated export** | GAP-002 | P3 |
| **Documentation: Fix SPEC.md voidAttempt** | GAP-006 | P3 |
