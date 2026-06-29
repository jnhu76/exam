# State Machine Closeout — Phase 1

**Date**: 2026-06-16
**Scope**: Persistent state machine correctness for Phase 1 closeout.

---

## 1. State Machine Inventory

| # | Entity | Enum location | Guard module | Phase 1 enforced? |
|---|--------|---------------|--------------|-------------------|
| 1 | **ExamStatus** | `packages/domain/src/enums.ts:71` | `packages/exam-engine/src/examStateMachine.ts` | ✅ Yes |
| 2 | **AttemptStatus** | `packages/domain/src/enums.ts:50` | `packages/exam-engine/src/attemptStateMachine.ts` | ✅ Yes |
| 3 | **EnrollmentStatus** | `packages/domain/src/enums.ts:62` | `packages/exam-engine/src/enrollmentStateMachine.ts` | ✅ Yes (newly added) |

### Implicit state fields (NOT state machines, left as-is)

| Field | Type | Why not a state machine |
|-------|------|------------------------|
| Answer Save Protocol | versioned protocol | Conflict detection via `clientSeq`/`version`/`baseVersion` — a protocol, not status transitions |
| Queue status | `waiting`/`ready` | In-memory computed (Phase 2), not persisted |
| User `isActive` | boolean | Admin free-toggle, no transition rules |
| HealthStatus | `ok`/`degraded`/`critical` | Derived from metrics, not stored |
| Question import status | `valid`/`warning`/`error` | Transient validation result, not persisted |

---

## 2. Officially Enforced State Machines

### 2.1 ExamStatus

```ts
// packages/exam-engine/src/examStateMachine.ts
export const EXAM_VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  draft: ["published"],
  published: ["open", "archived"],
  open: ["closed"],
  closed: ["archived"],
  archived: [],
};
```

**Enforcement points**: `publishExam`, `openExam`, `closeExam`, `archiveExam` in `examCommands.ts` all call `assertTransition`.

### 2.2 AttemptStatus

```ts
// packages/exam-engine/src/attemptStateMachine.ts
const TRANSITION_TABLE: Record<string, AttemptStatus> = {
  "in_progress:submit": "submitted",
  "in_progress:disrupt": "disrupted",
  "disrupted:submit": "submitted",
  "disrupted:restore": "in_progress",
  "submitted:grade": "grading",
  "grading:complete_grading": "graded",
};
```

**Enforcement points**: `submitAttempt`, `markDisrupted`, `restoreAttempt`, `finalizeGrading` all call `transition` + `isTransitionOk`.

### 2.3 EnrollmentStatus

```ts
// packages/exam-engine/src/enrollmentStateMachine.ts
export const ENROLLMENT_VALID_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  assigned: ["started", "blocked"],
  started: ["completed", "blocked"],
  blocked: ["started"],
  completed: [],
};
```

**Enforcement points**:
- `startAttempt` (`attemptCommands.ts:131`): writes `started`, guarded by `assertEnrollmentTransition`
- `finalizeGrading` (`grading.ts:173`): writes `completed` or `started`, guarded by `assertEnrollmentTransition`
- `exam.ts:570` enrollment creation: writes `assigned` as initial state (not a transition)

---

## 3. Reserved / Implicit States

### AttemptStatus reserved for Phase 2+

| Status | Status | Reason |
|--------|--------|--------|
| `not_started` | Reserved | Phase 2 queue entry: candidate assigned but hasn't joined queue yet |
| `queued` | Reserved | Phase 2: candidate in queue waiting for batch admission |
| `voided` | Reserved | Phase 2+: admin voids a graded attempt (e.g., misconduct) |

These exist in the enum but have **no transition edges** in Phase 1. They are not reachable through any business command. Tests explicitly verify they remain unreachable.

---

## 4. EnrollmentStatus Semantics

| Status | Meaning | Entry condition |
|--------|---------|-----------------|
| `assigned` | Admin assigned candidate to exam, no attempt started yet | Enrollment creation |
| `started` | At least one attempt has been started; candidate may still have actions (retake, resume, restore) | First `startAttempt`, or grading when retake still possible |
| `completed` | Candidate has no further exam actions available | `maxAttempts` exhausted, OR `pass_then_stop` passed, OR exam window closed |
| `blocked` | Admin/system blocked candidate from further participation | Phase 1: no UI entry; state machine defines it but does not set it |

### Key rule: grading ≠ completed

`finalizeGrading` computes target status via `shouldEnrollmentComplete()`:

```
if max_attempts AND attemptCount >= maxAttempts → completed
if pass_then_stop AND (this attempt passed OR already passed) → completed
if now >= exam.closeAt → completed
else → started (still can retake)
```

---

## 5. AttemptStatus Reachable vs Reserved

```
Phase 1 reachable:
  in_progress ──submit──→ submitted ──grade──→ grading ──complete──→ graded
      │                                                      
      └──disrupt──→ disrupted ──restore──→ in_progress
                     │
                     └──submit──→ submitted

Phase 2 reserved (no edges in Phase 1):
  not_started, queued, voided
```

---

## 6. ExamStatus Real Transition Table

```
draft ──publish──→ published ──open──→ open ──close──→ closed ──archive──→ archived
                     │                                     
                     └──archive──→ archived

Terminal: archived (no outgoing edges)

NOT allowed in Phase 1:
  draft → archived   (must publish first)
  draft → open       (must publish first)
  published → draft  (no rollback to draft)
  open → archived    (must close first)
  closed → open      (cannot reopen)
```

---

## 7. Disrupted Query Chain Fix

### Problem
`findActiveByEnrollment` and `findActiveByExamAndCandidate` only matched `status = 'in_progress'`, ignoring `disrupted`. The state machine defined `disrupted → in_progress` via `restore`, but the query layer couldn't find disrupted attempts.

### Fix
Both queries now use `inArray(status, ['in_progress', 'disrupted'])`.

**Engine layer** (`attemptCommands.ts:91-97`): `startAttempt` detects disrupted attempt and calls `restoreAttempt` instead of creating a new one.

**Route layer** (`attempts.ts:524-543`): `POST /attempts/:examId/start` detects disrupted attempt, calls `restoreAttempt`, records `attempt.restore` audit, returns restored attempt.

---

## 8. Why CandidateExamSummary Is a Derived Projection, Not a State Machine

`CandidateExamSummary` (proposed in `candidate-exam-state-audit.md`) exposes `availabilityStatus` and `primaryAction` to the frontend. These are **not persisted states** and **not governed by a transition table**.

They are **derived projections** computed at query time from:
- Exam status + window (openAt/closeAt/now)
- Enrollment status + attemptCount + finalPassed
- Active/resumable attempt existence (in_progress/disrupted)
- Latest attempt status

The frontend must consume `availabilityStatus`/`primaryAction` as read-only derived values. It must not attempt to transition them or maintain its own transition logic.

The underlying persisted state machines (ExamStatus, AttemptStatus, EnrollmentStatus) remain the source of truth. `CandidateExamSummary` is a read model that projects them into a candidate-facing decision.

---

## 9. Changes Made

### New files
- `packages/exam-engine/src/examStateMachine.ts` — extracted from examCommands.ts
- `packages/exam-engine/src/enrollmentStateMachine.ts` — new guard module
- `packages/exam-engine/src/examStateMachine.test.ts`
- `packages/exam-engine/src/enrollmentStateMachine.test.ts`

### Modified files
- `packages/exam-engine/src/examCommands.ts` — imports from examStateMachine, removed inline table
- `packages/exam-engine/src/grading.ts` — `shouldEnrollmentComplete()` + conditional status + guard
- `packages/exam-engine/src/attemptCommands.ts` — disrupted restore in startAttempt + enrollment guard
- `packages/exam-engine/src/index.ts` — exports new modules
- `packages/db/src/repository/attemptRepo.ts` — `findActive*` includes disrupted
- `apps/api/src/routes/attempts.ts` — route restores disrupted attempt
- `packages/domain/src/__tests__/state-lifecycle.spec.ts` — enum-only, no fake transition tables
- `packages/exam-engine/src/gradingRefactor.test.ts` — updated expectations + new `shouldEnrollmentComplete` tests
- `packages/exam-engine/src/grading.test.ts` — updated enrollment status expectation
- `packages/exam-engine/src/attemptCommands.test.ts` — disrupted restore test + mock fix
- `packages/db/src/repository/attemptEnrollment.test.ts` — disrupted findActive test
- `apps/api/src/routes/scores.test.ts` — updated enrollment status expectation

---

## 10. Known Debts

| Debt | Priority | Phase |
|------|----------|-------|
| `CandidateExamSummary` contract not yet implemented — frontend still infers availability from raw fields | P0 | Phase 1 (next task) |
| `listInProgress` query still only matches `in_progress` — heartbeat scanner won't re-scan disrupted attempts (acceptable: disrupted is terminal-until-restore, not stale) | P2 | Phase 1 |
| `EnrollmentStatus.blocked` has no entry point in Phase 1 (no admin UI to block a candidate) | P3 | Phase 3 |
| AttemptStatus `not_started`/`queued`/`voided` remain dead enums — Phase 2 queue and void will activate them | P3 | Phase 2+ |
| Seed data: candidate4 open-exam enrollment missing `finalScore`/`finalPassed` writeback | P1 | Phase 1 |
