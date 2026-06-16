# P2A-J5 — Restore Runtime Semantics

## 1. Summary

Fix restoreAttempt to preserve the candidate's remaining time by adjusting deadlineAt to account for time spent disconnected.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[x] backend state-machine job
[ ] backend API / route job
[x] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: restoreAttempt sets lastActivityAt = now but does NOT adjust deadlineAt. Candidate loses time spent disconnected.
- Impact: Unfair time loss for candidates who experience brief disconnections.
- Discovery source: 04-state-machine-audit.md
- Why this must be fixed now: Required for fair exam runtime.

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
Candidate disconnects during exam
  -> Heartbeat scanner marks disrupted
  -> Candidate reconnects and clicks "继续考试"
  -> POST /api/attempts/:examId/start detects disrupted attempt
  -> restoreAttempt adjusts deadlineAt = originalDeadlineAt + (now - lastActivityAt)
  -> Candidate resumes with full remaining time preserved
```

## 6. Current Behavior

restoreAttempt in attemptCommands.ts:194-225 sets lastActivityAt = now but leaves deadlineAt unchanged.

## 7. Target Behavior

- restoreAttempt calculates time spent disconnected: `now - lastActivityAt`.
- Adjusts `deadlineAt` by adding the disconnected duration: `newDeadlineAt = originalDeadlineAt + (now - lastActivityAt)`.
- Caps `newDeadlineAt` at `exam.closeAt` if applicable.
- Returns restored attempt with updated deadlineAt.

## 8. Scope

This job may modify:

```txt
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/attemptCommands.test.ts
apps/api/src/routes/attempts.test.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend behavior
Heartbeat timeout logic
Disrupted detection scanner
```

## 10. Dependencies

```txt
Depends on: P2A-J1
Blocks: P2A-J6
Can run in parallel with: P2A-J2, P2A-J3, P2A-J4
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| domain / engine | attemptCommands.ts | Adjust deadlineAt on restore |
| db / repository | `packages/db/src/repository/attemptRepo.ts` | Ensure findByIdForUpdate available for restore path |
| e2e | attempts.test.ts | Restore with time preservation test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /attempts/:examId/start (restore path) |
| Request Schema | existing |
| Response Schema | LoadAttemptResponse (deadlineAt now adjusted) |
| OpenAPI | already in P2.0-J1 |
| Domain Command | restoreAttempt |
| Repository | attemptRepo.update |
| DB Tables | exam_attempts |
| Transaction | No (single update) |
| Locking | No |
| Audit | attempt.restore (already exists) |
| Tests | Unit and route tests |

## 13. API / Contract Changes

Response shape unchanged. deadlineAt value may differ from before.

## 14. Error Contract

No new errors.

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[ ] Exam
[ ] Enrollment
[ ] Answer
[ ] Grading
[ ] Result Visibility
```

### Current Transition

```txt
disrupted -> restore -> in_progress (deadlineAt unchanged)
```

### Target Transition

```txt
disrupted -> restore -> in_progress (deadlineAt adjusted for disconnected time)
```

### Authority

```txt
[x] enforced in backend domain / exam-engine
[x] enforced in API route
[ ] enforced in DB constraint / transaction / lock
[ ] frontend only displays state, not authoritative
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: restoreAttempt
Input: examRepo, attemptRepo, attemptId, now
Output: restored ExamAttempt
Allowed states: disrupted -> in_progress
Rejected states: in_progress -> restore (no-op or error)
Side effects: updates status, lastActivityAt, deadlineAt
```

### Repository Layer

```txt
Repo method: attemptRepo.update
DB tables: exam_attempts
Columns read: deadlineAt, lastActivityAt
Columns written: status, lastActivityAt, deadlineAt
Transaction: YES
Lock: YES — row-level FOR UPDATE
```

## 17. DB / Transaction / Locking Plan

```txt
[x] transaction needed? yes
[x] row lock needed? yes
```

restoreAttempt must run inside executeInTransaction with findByIdForUpdate to prevent concurrent restore from double-applying deadline adjustment.

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
| duplicate restore | only one deadline adjustment applied | yes |
| concurrent restore | row lock serializes, no double adjustment | yes |

- restoreAttempt is idempotent if called multiple times on same disrupted attempt.

### Restore Deadline Policy (P2-PLAN-J1 Review Fix)

Phase 2 policy decision: restore DOES automatically adjust deadlineAt to compensate for disconnected time. This is the default behavior.

Requirements:
- restoreAttempt must run inside executeInTransaction
- restoreAttempt must use attemptRepo.findByIdForUpdate
- concurrent restore requests must not double-apply deadline adjustment (protected by row lock)
- deadlineAt adjustment is capped at exam.closeAt
- concurrent restore is tested

If the disconnected time is so long that `newDeadlineAt > exam.closeAt`, the deadline is clamped to `exam.closeAt`. The candidate cannot receive more time than the exam window allows.

Admin extend-time (P2C-J3) is the authoritative compensation path for cases where auto-adjustment is insufficient.

## 19. Frontend UX States

N/A - no frontend change.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked
[x] organization boundary checked
[x] candidate ownership checked
[x] audit event recorded (attempt.restore)
[x] sensitive metadata excluded
[x] permission boundary unchanged unless explicitly part of the job
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| unit | restoreAttempt adjusts deadlineAt correctly |
| integration | Route test: restore returns updated deadlineAt |
| e2e | Resume after disconnect preserves remaining time |
| repository / transaction | `repository.test.ts` — concurrent restore does not double-apply adjustment |

## 23. Acceptance Criteria

```txt
[x] restoreAttempt adjusts deadlineAt by the time spent disconnected.
[x] Candidate receives full remaining time after restore.
[x] deadlineAt does not exceed exam.closeAt.
[x] pnpm verify passes.
[ ] restoreAttempt runs inside executeInTransaction with findByIdForUpdate.
[ ] Concurrent restore requests do not double-apply deadline adjustment.
[ ] deadlineAt adjustment is capped at exam.closeAt.
```

## 24. Regression Risks

- Risk 1: Adjusted deadlineAt may exceed exam closeAt if not capped.
- Risk 2: Restore may be called on already in_progress attempt.

## 25. Rollback / Compatibility

- Rollback strategy: revert deadlineAt adjustment.
- Backward compatibility: Same API contract.

## 26. PR Boundaries

Limited to restoreAttempt time preservation only.

## 27. Review Guardrails

Must not weaken state-machine checks.

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
1. Modified files: attemptCommands.ts, tests
2. Behavior changed: restoreAttempt now preserves remaining time
3. Behavior explicitly not changed: heartbeat, disrupted detection, frontend
4. API / contract changes: none (shape unchanged)
5. State-machine changes: disrupted -> in_progress now adjusts deadlineAt
6. DB / migration changes: none
7. Tests added/updated: restore time preservation tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: none
```
