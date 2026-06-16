# P2D-J3 — Grading Queue API

## 1. Summary

Add backend API endpoints for the grading queue: list attempts needing manual grading, and admin endpoints to enter scores per question.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[x] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: No API for listing or grading subjective questions.
- Impact: Manual grading workflow cannot function.
- Discovery source: 06-phase2-gap-analysis.md P1-6
- Why this must be fixed now: Required for manual grading UI.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[x] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin opens grading queue
  -> GET /api/admin/grading-queue?status=pending_manual
  -> sees list of attempts/questions needing grading
  -> clicks an entry
  -> GET /api/admin/attempts/:id/grading-details
  -> enters score and comment
  -> POST /api/admin/attempts/:id/grade-question
  -> queue updates
```

## 6. Current Behavior

No grading queue API.

## 7. Target Behavior

- `GET /api/admin/grading-queue` lists attempts with pending_manual status.
- `GET /api/admin/attempts/:id/grading-details` returns attempt + questions needing manual grading.
- `POST /api/admin/attempts/:id/grade-question` saves score and comment.
- When all questions graded, attempt transitions to fully_graded.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
packages/contracts/src/score.ts
packages/exam-engine/src/grading.ts
packages/db/src/repository/attemptRepo.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend UI (P2D-J4)
Auto-grading engine
Result publishing policy (P2D-J5)
```

## 10. Dependencies

```txt
Depends on: P2D-J2
Blocks: P2D-J4, P2D-J6
Can run in parallel with: P2D-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | score.ts | Grading queue request/response schemas |
| domain / engine | grading.ts | Manual grading command |
| api routes | attempts.ts | New admin routes |
| db / repository | attemptRepo.ts | Query pending manual, save entry |
| e2e | grading.spec.ts | Grading queue API tests |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/admin/grading-queue, GET /api/admin/attempts/:id/grading-details, POST /api/admin/attempts/:id/grade-question |
| Request Schema | `{ questionId, score, comment? }` |
| Response Schema | `GradingQueueItem[]`, `GradingDetailsResponse` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | gradeQuestion, finalizeManualGrading |
| Repository | attemptRepo.listPendingManual, attemptRepo.saveManualGradingEntry |
| DB Tables | exam_attempts, manual_grading_entries |
| Transaction | YES (save entry + check if fully graded) |
| Locking | YES (row lock on attempt) |
| Audit | grading.score_entered |
| Tests | Route and integration tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/admin/grading-queue | query filters | queue items | - | Admin |
| GET /api/admin/attempts/:id/grading-details | - | details | NOT_FOUND | Admin |
| POST /api/admin/attempts/:id/grade-question | `{ questionId, score, comment? }` | updated attempt | NOT_FOUND, FORBIDDEN, VALIDATION_ERROR | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error state |
| not admin | 403 | FORBIDDEN | permission denied |
| score out of range | 400 | VALIDATION_ERROR | inline error |

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[x] Grading
```

### Target Transition

```txt
submitted -> pending_manual -> fully_graded
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: gradeQuestion
Input: attemptRepo, attemptId, questionId, score, comment, graderId
Output: updated ExamAttempt
Allowed states: pending_manual
Rejected states: auto_graded, fully_graded
Side effects: saves manual grading entry, may transition to fully_graded
```

## 17. DB / Transaction / Locking Plan

```txt
[ ] migration needed? no (done in P2D-J2)
[ ] new table needed? no
[ ] new column needed? no
[ ] enum change needed? no
[x] transaction needed? yes
[x] row lock needed? yes
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

## 18. Concurrency / Idempotency / Race Cases

- Two graders working on same attempt: row lock serializes.
- Re-grading same question: overwrite previous score.

## 19. Frontend UX States

N/A.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[x] audit event recorded (grading.score_entered)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Grading queue API tests |
| unit | gradeQuestion command tests |

## 23. Acceptance Criteria

```txt
[x] Admin can list attempts needing manual grading.
[x] Admin can view grading details for an attempt.
[x] Admin can enter score and comment per question.
[x] Attempt transitions to fully_graded when all questions are graded.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: May affect auto-graded attempts if status logic overlaps.

## 25. Rollback / Compatibility

- Rollback strategy: remove admin routes.

## 26. PR Boundaries

Limited to grading queue API only.

## 27. Review Guardrails

Must not allow candidates to access grading endpoints.

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
1. Modified files: attempts.ts, grading.ts, contracts, tests
2. Behavior changed: admin can grade subjective questions via API
3. API / contract changes: new grading queue endpoints
4. Tests added/updated: grading queue tests
5. Verification commands and results: pnpm verify passed
```
