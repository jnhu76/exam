# P2A-J1 — Atomic startAttempt

## 1. Summary

Make `startAttempt` transaction-safe with enrollment row locking to prevent duplicate active attempts from concurrent requests.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[x] backend state-machine job
[x] backend API / route job
[x] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: `startAttempt()` calls `findActiveByEnrollment` then `create` without transaction or lock. Two concurrent requests could create duplicate attempts for the same enrollment.
- Impact: Data corruption — one enrollment could have multiple active `in_progress` attempts.
- Discovery source: `06-phase2-gap-analysis.md` P0-2, `04-state-machine-audit.md` §2
- Why this must be fixed now: Duplicate attempts break the entire candidate runtime invariant.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate clicks "开始考试" on StartExamPage
  -> POST /api/attempts/:examId/start
  -> startAttempt() command
  -> DB: SELECT FOR UPDATE enrollment -> check active attempt -> create attempt -> update enrollment
  -> LoadAttemptResponse
  -> navigate to TakeExamPage
```

## 6. Current Behavior

`attemptCommands.ts:61-143` — `startAttempt` is a series of independent await calls: find exam, find enrollment, find active attempt, create attempt, update enrollment. No transaction wraps them.

## 7. Target Behavior

- `startAttempt` executes inside `executeInTransaction`.
- Enrollment row is locked with `SELECT ... FOR UPDATE` before checking for active attempts.
- If active attempt exists, return it (idempotent).
- If no active attempt, create attempt and update enrollment atomically.
- Concurrent requests block on the same enrollment row and serialize.

## 8. Scope

This job may modify:

```txt
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/attemptCommands.test.ts
packages/db/src/repository/enrollmentRepo.ts (add findByExamAndCandidateForUpdate)
apps/api/src/routes/attempts.ts (pass transaction context)
apps/api/src/routes/attempts.test.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend behavior
OpenAPI contract (except route schema if already in P2.0-J1)
Grading pipeline
Heartbeat behavior
Exam state machine
```

## 10. Dependencies

```txt
Depends on: P2.0-J1
Blocks: P2A-J2, P2A-J4, P2A-J5, P2A-J6
Can run in parallel with: nothing (first P0 backend fix)
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | — | — |
| domain / engine | `packages/exam-engine/src/attemptCommands.ts` | Wrap in transaction; add enrollment lock |
| api routes | `apps/api/src/routes/attempts.ts` | Pass tx context to command |
| db / repository | `packages/db/src/repository/enrollmentRepo.ts` | Add `findByExamAndCandidateForUpdate` |
| frontend | — | — |
| e2e | `apps/api/src/routes/attempts.test.ts` | Add concurrent start test |
| docs | — | — |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /api/attempts/:examId/start (already exists) |
| Request Schema | `StartAttemptRequestSchema` |
| Response Schema | `LoadAttemptResponseSchema` |
| OpenAPI | Already registered in P2.0-J1 |
| Domain Command | `startAttempt` — transaction-safe enrollment lock |
| Repository | `enrollmentRepo.findByExamAndCandidateForUpdate`; `attemptRepo.create` inside tx |
| DB Tables | exam_enrollments, exam_attempts |
| Transaction | YES — `executeInTransaction` around entire command |
| Locking | YES — `SELECT ... FOR UPDATE` on enrollment row |
| Audit | `attempt.start` (already exists) |
| Tests | Route concurrent test; unit test for duplicate start |

## 13. API / Contract Changes

No API shape change. Behavior change only (transaction safety).

## 14. Error Contract

No new error cases. Existing errors preserved:
- `ExamNotOpenError` -> 403
- `ValidationError` -> 400
- `MaxAttemptsReachedError` -> 403
- `ExamAlreadyPassedError` -> 403

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[ ] Enrollment
[ ] Answer
[ ] Grading
[ ] Result Visibility
```

### Current Transition

```txt
published/open exam + no active attempt -> startAttempt -> in_progress
```

### Target Transition

Same transition, but atomic and locked.

### Rejected Transitions

```txt
[x] Cannot create second active attempt for same enrollment
[x] Cannot start if maxAttempts reached
[x] Cannot start if pass_then_stop and already passed
```

### Authority

```txt
[x] enforced in backend domain / exam-engine
[x] enforced in API route
[x] enforced in DB constraint / transaction / lock
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
[x] concurrency tests if applicable
[ ] E2E abnormal path if user-visible
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: startAttempt
Input: examRepo, enrollmentRepo, attemptRepo, examId, candidateId, now
Output: ExamAttempt
Allowed states: published/open exam, assigned/started enrollment
Rejected states: max attempts reached, already passed, no enrollment
Side effects: creates attempt, updates enrollment attemptCount
```

### Repository Layer

```txt
Repo method: enrollmentRepo.findByExamAndCandidateForUpdate
DB tables: exam_enrollments
Columns read: all enrollment columns
Columns written: none (lock only)
Transaction: YES
Lock: YES — row-level FOR UPDATE
Unique constraint: org_exam_candidate_unique
```

### Boundary Rule

```txt
[x] route performs auth + parsing + orchestration only
[x] domain command owns business rule
[x] repository owns persistence only
[x] frontend does not duplicate backend authority
```

## 17. DB / Transaction / Locking Plan

```txt
[ ] migration needed? no
[ ] new table needed? no
[ ] new column needed? no
[ ] enum change needed? no
[x] transaction needed? yes
[x] row lock needed? yes
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

Explain: No schema change. Only execution semantics change: wrap in transaction and use FOR UPDATE.

## 18. Concurrency / Idempotency / Race Cases

```txt
[x] duplicate request
[ ] retry after network failure
[ ] stale client state
[ ] submit while save is pending
[ ] deadline while save is pending
[ ] force-submit while candidate submits
[ ] extend-time while deadline scanner runs
[ ] grading retry
[ ] scanner double-run
```

### Expected Behavior

| Race Case | Expected Result | Test Required |
|---|---|---|
| duplicate start | only one active attempt | yes |
| save after submit | rejected | no (not in scope) |
| submit twice | idempotent | no (not in scope) |

## 19. Frontend UX States

N/A — no frontend change.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked
[x] organization boundary checked
[x] candidate ownership checked
[x] audit event recorded (attempt.start)
[x] sensitive metadata excluded
[x] permission boundary unchanged unless explicitly part of the job
```

## 21. Seed Impact

```txt
[x] no seed change
[ ] demo seed update
[ ] e2e seed update
[ ] test factory only
```

## 22. Tests

| Type | Required Test |
|---|---|
| unit | `attemptCommands.test.ts` — concurrent start returns same attempt |
| integration | `attempts.test.ts` — double-click start simulation |
| repository / transaction | `repository.test.ts` — FOR UPDATE behavior |
| api route | `attempts.test.ts` — concurrent POST start |
| contract / OpenAPI | N/A |
| frontend component | N/A |
| e2e | Optional — can be covered in P2A-J6 |
| regression | Ensure existing start flow still works |

## 23. Acceptance Criteria

```txt
[x] Concurrent start requests for same enrollment cannot create duplicate active attempts.
[x] Existing start flow behavior is preserved (same response shape).
[x] Transaction rolls back on error (no partial attempt creation).
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Transaction wrapping may change error timing or deadlock under load.
- Risk 2: Enrollment repo FOR UPDATE may interact unexpectedly with other queries.

## 25. Rollback / Compatibility

- Rollback strategy: revert transaction wrapping.
- Backward compatibility: 100% — same API contract.
- Data compatibility: N/A — no schema change.

## 26. PR Boundaries

Limited to transaction safety of startAttempt only.

## 27. Review Guardrails

Must not weaken state-machine checks, change E2E expectations to hide bugs, or mix with unrelated UI changes.

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
1. Modified files: attemptCommands.ts, enrollmentRepo.ts, attempts.ts, tests
2. Behavior changed: startAttempt is now atomic and enrollment-locked
3. Behavior explicitly not changed: response shape, validation rules, grading
4. API / contract changes: none (shape unchanged)
5. State-machine changes: same transitions, now transaction-safe
6. DB / migration changes: none
7. Tests added/updated: concurrent start tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: monitor for deadlock in production
```
