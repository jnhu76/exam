# P2A-J4 — Exam Open/Close Semantics

## 1. Summary

Implement check-on-access auto-transition for exam status so that exams move from published to open to closed based on openAt/closeAt without requiring manual admin action.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[x] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: openExam() and closeExam() exist in code but no API or scheduler triggers them. Exams stay published forever.
- Impact: Exam status is misleading. Admins must manually intervene to open/close.
- Discovery source: 06-phase2-gap-analysis.md P0-3, 04-state-machine-audit.md
- Why this must be fixed now: Required for accurate exam lifecycle and admin operations.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate opens ExamListPage
  -> GET /api/candidate/exams
  -> deriveCandidateExamState checks now vs openAt/closeAt
  -> Exam status auto-transitions published->open or open->closed if needed
  -> Candidate sees correct availabilityStatus (canTake, upcoming, expired)
```

## 6. Current Behavior

Exam status is set to published on publish and stays there. OPEN_STATUSES includes both published and open, so candidates can start exams in published state.

## 7. Target Behavior

- On candidate access (startAttempt, candidateExamState derivation):
  - If exam.status === published and now >= openAt: call openExam().
  - If exam.status === open and now >= closeAt: call closeExam().
- Admin explicit open/close/archive actions remain available.
- Check-on-access is lazy; no scheduler required.

## 8. Scope

This job may modify:

```txt
packages/exam-engine/src/examCommands.ts
packages/exam-engine/src/examStateMachine.ts
packages/exam-engine/src/candidateExamSummary.ts
apps/api/src/routes/attempts.ts
apps/api/src/routes/exam.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend pages (status display already handles multiple statuses)
Cron/scheduler (check-on-access is sufficient for Phase 2)
Heartbeat behavior
```

## 10. Dependencies

```txt
Depends on: P2A-J1
Blocks: P2A-J6, P2B-J2
Can run in parallel with: P2A-J2, P2A-J3, P2A-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| domain / engine | examCommands.ts, candidateExamSummary.ts | Add check-on-access transitions |
| api routes | attempts.ts, exam.ts | Call transition checks before candidate/admin operations |
| e2e | attempts.test.ts, exam.test.ts | Verify status transitions on access |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /attempts/:examId/start, GET /candidate/exams |
| Request Schema | existing |
| Response Schema | existing |
| OpenAPI | already in P2.0-J1 |
| Domain Command | openExam, closeExam (existing) - called on access |
| Repository | examRepo.update |
| DB Tables | exams |
| Transaction | No (single status update) |
| Locking | No |
| Audit | exam.open, exam.close (new actions if not existing) |
| Tests | Unit and route tests |

## 13. API / Contract Changes

No API shape change. Behavior change: candidate/admin access may trigger status transition.

## 14. Error Contract

No new errors.

## 15. State Machine Contract

### State Entity

```txt
[x] Exam
[ ] Attempt
[ ] Enrollment
[ ] Answer
[ ] Grading
[ ] Result Visibility
```

### Current Transition

```txt
draft -> published (manual)
published -> archived (manual)
open/closed states unused
```

### Target Transition

```txt
draft -> published (manual)
published -> open (check-on-access when now >= openAt)
open -> closed (check-on-access when now >= closeAt)
closed -> archived (manual)
published -> archived (manual, cancel scenario)
```

### Rejected Transitions

```txt
[x] Cannot start closed or archived exam
[x] Cannot publish from open/closed/archived
```

### Authority

```txt
[x] enforced in backend domain / exam-engine
[x] enforced in API route
[ ] enforced in DB constraint / transaction / lock
[ ] frontend only displays state, not authoritative
```

### State Persistence

```txt
[x] persisted in DB column
[ ] derived from timestamp / query
[ ] stored in JSON snapshot
[ ] audit-only event
```

### State Machine Tests

```txt
[x] transition unit tests
[x] rejected transition tests
[x] route-level state tests
[ ] concurrency tests if applicable
[x] E2E abnormal path if user-visible
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: openExam, closeExam (existing)
Input: examRepo, examId
Output: updated Exam
Allowed states: published -> open, open -> closed
Rejected states: archived -> anything, draft -> open/closed
Side effects: updates exam.status
```

### Repository Layer

```txt
Repo method: examRepo.update
DB tables: exams
Columns read: status, openAt, closeAt
Columns written: status
Transaction: No
Lock: No
```

### Boundary Rule

```txt
[x] route performs auth + parsing + orchestration only
[x] domain command owns business rule
[x] repository owns persistence only
[x] frontend does not duplicate backend authority
```

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

- Two concurrent candidate starts on same exam: both may try to transition published->open. Idempotent update is safe.

## 19. Frontend UX States

N/A - no frontend change.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked
[x] organization boundary checked
[x] audit event recorded (exam.open, exam.close)
[x] sensitive metadata excluded
[x] permission boundary unchanged unless explicitly part of the job
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| unit | examStateMachine.test.ts - auto-transition on access |
| integration | exam.test.ts - status transitions on candidate start |
| e2e | Verify exam goes from published to open on first access |

## 23. Acceptance Criteria

```txt
[x] Exam transitions to open when candidate accesses it after openAt.
[x] Exam transitions to closed when candidate accesses it after closeAt.
[x] Admin can still manually archive a published exam.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Check-on-access may add latency to candidate exam list.
- Risk 2: Status transition may conflict with admin simultaneous archive.

## 25. Rollback / Compatibility

- Rollback strategy: revert check-on-access calls.
- Backward compatibility: Existing exams in published remain accessible.

## 26. PR Boundaries

Limited to exam status check-on-access only.

## 27. Review Guardrails

Must not weaken state-machine checks or introduce scheduler/cron.

## 28. Verification Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pg
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: examCommands.ts, candidateExamSummary.ts, attempts.ts, exam.ts, tests
2. Behavior changed: exam status auto-transitions on access
3. Behavior explicitly not changed: manual publish/archive, heartbeat, grading
4. API / contract changes: none
5. State-machine changes: published -> open -> closed now auto-triggered
6. DB / migration changes: none
7. Tests added/updated: auto-transition tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: none
```
