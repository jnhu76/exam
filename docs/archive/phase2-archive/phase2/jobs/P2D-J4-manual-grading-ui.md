# P2D-J4 — Manual Grading UI

## 1. Summary

Build the admin UI for the grading queue: list attempts needing manual grading, score input per question with comments, and result preview.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: No UI for manual grading.
- Impact: Admin cannot grade subjective questions even with API.
- Discovery source: 01-frontend-inventory.md
- Why this must be fixed now: Required for grading workflow completion.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[x] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin navigates to /admin/grading-queue
  -> sees list of pending manual grading attempts
  -> clicks an attempt
  -> sees questions with candidate answers
  -> enters score and comment per question
  -> clicks save
  -> sees updated status
```

## 6. Current Behavior

No manual grading UI.

## 7. Target Behavior

- GradingQueuePage lists attempts with pending_manual status.
- GradingDetailPage shows attempt questions, candidate answers, score input fields.
- Score input validates maxScore range.
- Comments are optional text areas.
- Save button submits per-question scores.
- Attempt status updates to fully_graded when complete.

## 8. Scope

This job may modify:

```txt
apps/web/src/pages/GradingQueuePage.tsx (new)
apps/web/src/pages/GradingDetailPage.tsx (new)
apps/web/src/App.tsx (new routes)
```

## 9. Non-Scope

This job must not modify:

```txt
Backend grading logic
Result publishing policy
Auto-grading
```

## 10. Dependencies

```txt
Depends on: P2D-J3
Blocks: P2D-J6
Can run in parallel with: P2D-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| frontend | GradingQueuePage.tsx, GradingDetailPage.tsx | Grading UI |
| e2e | grading.spec.ts | Manual grading E2E |

## 12. Backend Contract Trace

N/A - frontend only.

## 13. API / Contract Changes

No new APIs. Consumes P2D-J3 endpoints.

## 14. Error Contract

Handles existing API errors: NOT_FOUND, VALIDATION_ERROR.

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

- Two admins grading same attempt: last save wins (backend handles with row lock).

## 19. Frontend UX States

loading, error, empty, disabled, submitted.

### Component Reuse

DataTablePagination, ConfirmDialog, Badge, ErrorState, LoadingState.

## 20. Audit / Security / RBAC

N/A - frontend only.

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| frontend component | Grading queue and detail rendering |
| e2e | Manual grading workflow |

## 23. Acceptance Criteria

```txt
[x] Admin can view grading queue.
[x] Admin can enter scores and comments per question.
[x] Score input validates against maxScore.
[x] Attempt status updates when fully graded.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: UI may not handle large numbers of questions well.

## 25. Rollback / Compatibility

- Rollback strategy: remove pages and routes.

## 26. PR Boundaries

Limited to manual grading UI only.

## 27. Review Guardrails

Must not implement auto-grading or result publishing in this PR.

## 28. Verification Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: GradingQueuePage.tsx, GradingDetailPage.tsx, App.tsx, tests
2. Behavior changed: admin can grade subjective questions via UI
3. API / contract changes: none
4. Tests added/updated: grading UI tests, E2E
5. Verification commands and results: pnpm verify passed
```
