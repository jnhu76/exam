# P2C-J3 — Extend Time

## 1. Summary

Add an admin API and UI to extend a candidate's attempt deadline, with candidate sync via the existing polling contract.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[x] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: deadlineAt is immutable after attempt creation. No mechanism to extend.
- Impact: Admin cannot grant extra time for special circumstances.
- Discovery source: 06-phase2-gap-analysis.md P1-3
- Why this must be fixed now: Required for proctor runtime intervention.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[x] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin views proctor dashboard
  -> sees active attempt
  -> clicks "Extend Time"
  -> POST /api/admin/attempts/:id/extend-time
  -> deadlineAt updated in DB
  -> audit log recorded
  -> candidate UI sees updated deadline on next heartbeat/poll
```

## 6. Current Behavior

No extend-time API or UI.

## 7. Target Behavior

- Admin POST endpoint extends deadlineAt by N minutes.
- Only allowed for in_progress or disrupted attempts.
- Records audit event `attempt.extendTime` with admin identity and extension duration.
- Candidate UI reflects updated deadline via existing heartbeat/attempt polling.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
packages/contracts/src/attempt.ts
packages/exam-engine/src/attemptCommands.ts
packages/db/src/repository/attemptRepo.ts
apps/web/src/pages/ (proctor dashboard)
```

## 9. Non-Scope

This job must not modify:

```txt
WebSocket/SSE push
Heartbeat interval
```

## 10. Dependencies

```txt
Depends on: P2C-J1
Blocks: P2C-J8
Can run in parallel with: P2C-J2, P2C-J4
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | attempt.ts | ExtendTime request schema |
| domain / engine | attemptCommands.ts | New `extendAttemptTime` domain command |
| api routes | attempts.ts | New admin route |
| db / repository | attemptRepo.ts | Update deadlineAt |
| frontend | proctor dashboard | Extend time button + form |
| e2e | proctor-runtime.spec.ts | Extend time test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /api/admin/attempts/:attemptId/extend-time |
| Request Schema | `{ additionalMinutes: number }` |
| Response Schema | `LoadAttemptResponse` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | `extendAttemptTime` (new domain command, in `packages/exam-engine/src/attemptCommands.ts`) |
| Repository | attemptRepo.findByIdForUpdate, attemptRepo.update |
| DB Tables | exam_attempts |
| Transaction | YES |
| Locking | YES (findByIdForUpdate) |
| Audit | attempt.extendTime |
| Tests | Route and integration tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| POST /api/admin/attempts/:id/extend-time | `{ additionalMinutes }` | `LoadAttemptResponse` | NOT_FOUND, FORBIDDEN, INVALID_STATE | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error toast |
| not admin | 403 | FORBIDDEN | permission denied |
| not in_progress/disrupted | 409 | INVALID_STATE | info message |
| new deadline exceeds exam.closeAt | 409 | DEADLINE_EXCEEDS_EXAM_CLOSE | info message |

## 15. State Machine Contract

N/A - no state transition. Only deadlineAt field update.

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: extendAttemptTime
Input: examRepo, attemptRepo, attemptId, additionalMinutes, now
Output: updated ExamAttempt
Allowed states: in_progress, disrupted
Rejected states: submitted, graded, voided
Side effects: updates deadlineAt
Validation: if newDeadlineAt > exam.closeAt, reject with DEADLINE_EXCEEDS_EXAM_CLOSE
Transaction: YES (executeInTransaction)
Lock: YES (attemptRepo.findByIdForUpdate)
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

`extendAttemptTime` must run inside `executeInTransaction` with `findByIdForUpdate` on the attempt row to prevent concurrent extend-time and candidate save from racing. If the new `deadlineAt > exam.closeAt`, reject with `409 DEADLINE_EXCEEDS_EXAM_CLOSE` rather than silently clamping.

## 18. Concurrency / Idempotency / Race Cases

```txt
[x] extend-time while candidate saves: transaction + FOR UPDATE serializes
[x] extend-time while deadline scanner runs: scanner checks deadlineAt at runtime, so extension is effective immediately
[x] extend-time while force-submit: transaction serializes
[x] new deadline exceeds exam.closeAt: rejected with 409 DEADLINE_EXCEEDS_EXAM_CLOSE
```

## 19. Frontend UX States

loading, error, disabled, form input.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[x] audit event recorded (attempt.extendTime with duration and admin id)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Route test for extend time |
| e2e | Admin extends time, candidate sees updated deadline |

## 23. Acceptance Criteria

```txt
[x] Admin can extend time for in_progress attempts.
[x] Admin can extend time for disrupted attempts.
[x] Candidate UI reflects updated deadline within polling interval.
[x] Audit log records extension.
[x] extendAttemptTime runs inside executeInTransaction with findByIdForUpdate.
[x] Extension beyond exam.closeAt is rejected with 409 DEADLINE_EXCEEDS_EXAM_CLOSE.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Extended deadline may exceed exam.closeAt.

## 25. Rollback / Compatibility

- Rollback strategy: remove admin route.

## 26. PR Boundaries

Limited to extend-time API and UI action only.

## 27. Review Guardrails

Must not allow candidate to extend own time.

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
1. Modified files: attempts.ts, contracts, frontend, tests
2. Behavior changed: admin can extend attempt deadline
3. API / contract changes: POST /api/admin/attempts/:id/extend-time
4. Tests added/updated: extend-time tests
5. Verification commands and results: pnpm verify passed
```
