# Exam Runtime Architecture

> Reconstructed from production code at the verified commit.

```text
STATUS:          CURRENT
AUTHORITY:        Architecture
SCOPE:            Exam runtime kernel, exam-engine package boundary, attempt lifecycle
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
LAST VERIFIED REPOSITORY COMMIT:
                 2ca3d687371a2f20eec518634d2e70c2c03421f5
                 The baseline system commit is NOT the final verification
                 commit of the reorganized repository.
SUPERSEDES:       —
RELATED ADRS:     ADR-005 (operation state baseline), ADR-006 (time authority),
                  ADR-008 (submit answer freeze)
```

## 1. Core entity

**`ExamAttempt` is the core entity, not `ExamPaper`.** An attempt supports
multiple takes per exam. `ExamEnrollment` tracks qualification, attempt count,
and the selected final score. At attempt creation the questions are copied into
a `QuestionSnapshot`; later edits to the QuestionBank do not affect existing
attempts.

## 2. The runtime kernel: `packages/exam-engine`

`exam-engine` is the **framework-agnostic exam runtime kernel**. Verified
facts:

- Internal deps: `@exam/domain` only.
- No `fastify`, `drizzle-orm`, or `react` imports (verified by `rg`).
- Sole runtime consumer today: `apps/api`. (Web does not import it.)

The package owns deterministic, side-effect-free logic where possible:

| Module | Responsibility |
|--------|----------------|
| `examStateMachine.ts` | Exam lifecycle transitions (`draft → published → open → closed → canceled → archived`) |
| `enrollmentStateMachine.ts` | Enrollment transitions |
| `attemptStateMachine.ts` | Attempt transitions (incl. `disrupted`) |
| `examCommands.ts` / `attemptCommands.ts` | Command surface — the only sanctioned way to mutate state |
| `answerProtocol.ts` | Answer Save Protocol: versioned, idempotent saves with conflict detection |
| `grading.ts` / `gradingWorkset.ts` / `manualGrading.ts` | Auto-grading bridge, workset assembly, manual grading flow |
| `timer.ts` | Pure server-authoritative time helpers (`calculateDeadlineAt`, `getRemainingSeconds`) |
| `deadlineReconciliation.ts` | Deadline reconciliation |
| `lockSeam.ts` | Concurrency lock abstraction |
| `candidateExamSummary.ts` | Candidate-facing summary projection |
| `systemMonitor.ts` | System monitor helper |

**Why it is a package, not folded into the API:** the value is domain
isolation. State-machine logic, the answer protocol, and timer/deadline math
are deterministic and must not depend on DB, HTTP, or I/O. Keeping them in a
framework-agnostic package prevents drift and protects the runtime invariants.
Extracting this logic from a merged API later would be costly.

## 3. Invariants (binding)

- **Exam is not CRUD.** All state changes go through command functions
  (`publishExam`, `startAttempt`, `submitAttempt`, `cancelExam`, `closeExam`,
  `extendExam`, `unpublishExam`, `archiveExam`). Direct status mutation is
  forbidden.
- **Server is time authority.** Timer/deadline math runs on server `now`
  (`fastify.now()`, ADR-006). Client countdown is cosmetic.
- **Answers are saved on every change** via the Answer Save Protocol, not just
  on submit. Saves are versioned and idempotent: the same `clientSeq` is only
  accepted if the payload is structurally identical; a conflicting payload at
  the same `clientSeq` is rejected.
- **Submit is a single transaction under the row lock.** `submitAndGradeAttempt`
  collapses submit + grade into one transaction to close the stale-snapshot
  window (ADR-008). Concurrent save-vs-submit ordering is decided by Postgres
  lock-acquisition order and is documented as legitimate.
- **Disrupted attempts recover from the server.** `lastActivityAt` is the
  heartbeat; client timeout auto-triggers the `disrupted` state; recovery
  restores answers + remaining time from the server.
- **Lock-reconcile-assert-mutate.** Stateful admin operations follow the
  mandatory transaction pattern: acquire row lock, reconcile current state,
  assert preconditions, mutate (ADR-005).

## 4. Candidate runtime flow

1. Candidate logs in (no org slug), sees assigned exams.
2. `startAttempt` creates the attempt + captures the `QuestionSnapshot` +
   starts the server-side timer.
3. Each answer change is saved via the Answer Save Protocol
   (`POST /attempts/:id/answers/:questionId`) — heartbeat keeps the attempt
   alive.
4. `submitAttempt` runs in a single transaction with auto-grading.
5. Results are displayed per the exam's result-publishing mode; admin can
   manually grade questions that lack a `standardAnswer` or that the exam
   marks for manual review.

## 5. Manual grading

- `gradingQueue.ts` exposes the admin manual-grading queue + per-question grade
  endpoint, backed by `attempt_grading_entries` worksets and the
  `manualGrading.ts` command in `exam-engine`.
- Manual-grade candidate-answer detail E2E and full subjective grading
  workflow are deferred to Phase 3.

## 6. Timing modes

Phase 1 implements **only `timed_window`**. `timed_sync`, `untimed`, queue
admission (`requireQueue` + `batchSize` + `batchInterval`), and degradation
are deferred to Phase 2+ (see `docs/roadmap/current.md`).

## 7. Known dead code in `exam-engine` (Wave 1 cleanup)

- `packages/exam-engine/src/types.ts` — three `declare function` stubs,
  **zero callers** (verified by `rg` outside the package). Slated for
  mechanical deletion in Wave 1.

Other exam-engine purifications (renaming the `gradeQuestion` collision,
unifying `getRemainingSeconds`, pruning dead barrel re-exports) are **Wave 2**
boundary-purification work and are not authorized by this document.

## 8. Wave 1 boundary (what this doc does NOT authorize)

This document does **not** authorize:

- Merging `exam-engine` into `apps/api` (rejected by scan review §2.3).
- Moving `gradeAttempt` / `startAttempt` to test helpers (Wave 2).
- Renaming `gradeQuestion` → `completeManualGrade` (Wave 2).
- Auto-grading fill-blank / subjective runtime changes (Phase 3).
