# P2C-J2 — Force Submit

## 1. Summary

Add an admin API and UI to force-submit a candidate's attempt, with state transition validation and audit logging.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[x] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: submitAttempt works on disrupted attempts, but no admin-initiated endpoint exists.
- Impact: Admin cannot force-submit a candidate who has abandoned the exam.
- Discovery source: 06-phase2-gap-analysis.md P1-2, 04-state-machine-audit.md
- Why this must be fixed now: Required for proctor runtime intervention.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[x] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin views proctor dashboard
  -> sees disrupted/abandoned attempt
  -> clicks "Force Submit"
  -> POST /admin/attempts/:id/force-submit
  -> submitAttempt() + gradeAttempt() called
  -> attempt becomes graded
  -> audit log records force-submit
  -> admin sees updated status
```

## 6. Current Behavior

No force-submit API. Admin cannot intervene.

## 7. Target Behavior

- Admin POST endpoint force-submits an in_progress or disrupted attempt.
- Calls existing submitAttempt + gradeAttempt (idempotent).
- Records audit event `attempt.forceSubmit` with admin identity.
- Returns graded result.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts (new admin route)
packages/contracts/src/attempt.ts (new schemas)
apps/web/src/pages/ (proctor dashboard action)
```

## 9. Non-Scope

This job must not modify:

```txt
Candidate-facing pages
Heartbeat scanner
```

## 10. Dependencies

```txt
Depends on: P2C-J1
Blocks: P2C-J8
Can run in parallel with: P2C-J3, P2C-J4
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | attempt.ts | Force submit request/response schemas |
| domain / engine | attemptCommands.ts | Reuse submitAttempt + gradeAttempt |
| api routes | attempts.ts | New admin route |
| frontend | proctor dashboard | Force submit button |
| e2e | proctor-runtime.spec.ts | Force submit test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /admin/attempts/:attemptId/force-submit |
| Request Schema | `{ attemptId: string, reason?: string }` |
| Response Schema | `LoadAttemptResponse` (graded) |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | submitAttempt + gradeAttempt |
| Repository | attemptRepo.update |
| DB Tables | exam_attempts, exam_enrollments, audit_logs |
| Transaction | YES |
| Locking | YES (findByIdForUpdate) |
| Audit | attempt.forceSubmit |
| Tests | Route and integration tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| POST /admin/attempts/:id/force-submit | `{ reason? }` | `LoadAttemptResponse` | NOT_FOUND, FORBIDDEN, INVALID_STATE | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error toast |
| not admin | 403 | FORBIDDEN | permission denied |
| in_progress / disrupted → force-submit | 200 | — | graded result returned |
| submitted / grading / graded → force-submit | 200 | — | idempotent: return current result |
| voided → force-submit | 409 | INVALID_STATE | info message |

### Rationale

Force-submit is idempotent for terminal submitted/graded states — return the current result (200) instead of a conflict error. Only voided attempts are truly invalid for force-submit. This matches the review recommendation (P2-PLAN-J1).

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
```

### Target Transition

```txt
in_progress/disrupted -> submit -> grade -> graded (force-submit)
submitted/grading/graded -> idempotent skip (return current result)
voided -> rejected (409 INVALID_STATE)
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: submitAttempt + gradeAttempt (existing)
Input: attemptId, now
Output: graded ExamAttempt
Allowed states: in_progress, disrupted -> force-submit -> graded (200)
Idempotent states: submitted, grading, graded -> return current result (200)
Rejected states: voided -> 409 INVALID_STATE
```

## 17. DB / Transaction / Locking Plan

```txt
[ ] migration needed? no
[x] transaction needed? yes
[x] row lock needed? yes
[ ] idempotency needed? yes
```

## 18. Concurrency / Idempotency / Race Cases

- Force submit while candidate is actively saving: transaction serializes.
- Force submit twice: idempotent (graded skip).

## 19. Frontend UX States

loading, error, disabled, confirmation dialog.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[x] audit event recorded (attempt.forceSubmit with admin id and reason)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| unit | Force submit command logic |
| integration | Route test with admin auth |
| e2e | Admin force-submits abandoned attempt |

## 23. Acceptance Criteria

```txt
[x] Admin can force-submit an in_progress attempt.
[x] Admin can force-submit a disrupted attempt.
[x] Force-submit is idempotent for already-graded attempts.
[x] Audit log records admin identity and reason.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Force submit may race with candidate submit.

## 25. Rollback / Compatibility

- Rollback strategy: remove admin route.

## 26. PR Boundaries

Limited to force-submit API and UI action only.

## 27. Review Guardrails

Must not allow candidate to call force-submit. Must not skip state machine checks.

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
2. Behavior changed: admin can force-submit attempts
3. API / contract changes: POST /admin/attempts/:id/force-submit
4. State-machine changes: in_progress/disrupted -> graded via admin
5. Tests added/updated: force-submit tests
6. Verification commands and results: pnpm verify passed
```
