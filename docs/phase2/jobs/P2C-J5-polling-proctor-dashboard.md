# P2C-J5 — Polling Proctor Dashboard

## 1. Summary

Build an admin proctor dashboard using HTTP polling that displays candidate status cards and exposes action buttons for force-submit, extend-time, and misconduct flag.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: No proctor dashboard page exists. Admin can only see enrollment list in ExamDetailPage.
- Impact: Cannot monitor live exam or intervene in real-time.
- Discovery source: 06-phase2-gap-analysis.md P1-1, 01-frontend-inventory.md
- Why this must be fixed now: Required for proctor runtime operations.

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
Admin navigates to /admin/exams/:id/proctor
  -> Dashboard polls GET /api/admin/exams/:id/candidates/status every 5s
  -> Displays cards: active, disrupted, submitted, graded
  -> Admin clicks action on a card
  -> Action API called
  -> Dashboard refreshes on next poll
```

## 6. Current Behavior

No proctor dashboard. No candidate status polling API.

## 7. Target Behavior

- New route `/admin/exams/:id/proctor` with ProctorDashboardPage.
- Polling API `GET /api/admin/exams/:id/candidates/status` returns:
  - candidate info, attempt status, deadlineAt, lastActivityAt, misconduct flag.
- Status cards grouped by status.
- Action buttons wired to P2C-J2/J3/J4 APIs.
- Polling interval 5s (configurable).

## 8. Scope

This job may modify:

```txt
apps/web/src/pages/ProctorDashboardPage.tsx (new)
apps/web/src/App.tsx (new route)
apps/api/src/routes/exam.ts (new polling API)
apps/api/src/routes/attempts.ts
packages/contracts/src/exam.ts
```

## 9. Non-Scope

This job must not modify:

```txt
WebSocket/SSE real-time updates
Camera/screen monitoring
Auto-misconduct detection
```

## 10. Dependencies

```txt
Depends on: P2C-J1, P2B-J2, P2C-J2, P2C-J3, P2C-J4
Blocks: P2C-J8
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | exam.ts | Candidate status response schema |
| api routes | exam.ts | GET /api/admin/exams/:id/candidates/status |
| frontend | ProctorDashboardPage.tsx | Dashboard UI with cards and actions |
| e2e | proctor-runtime.spec.ts | Dashboard tests |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/admin/exams/:id/candidates/status |
| Request Schema | query: `{ page?, pageSize? }` |
| Response Schema | `{ candidates: [{ candidateId, name, status, deadlineAt, lastActivityAt, misconduct }] }` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A (read-only aggregation) |
| Repository | attemptRepo, enrollmentRepo, candidateRepo |
| DB Tables | exam_attempts, exam_enrollments, candidate_profiles, users |
| Transaction | No |
| Locking | No |
| Audit | N/A (read-only) |
| Tests | Route tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/admin/exams/:id/candidates/status | query params | candidate status array | NOT_FOUND, FORBIDDEN | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| exam not found | 404 | NOT_FOUND | error state |
| not admin | 403 | FORBIDDEN | permission denied |

## 15. State Machine Contract

N/A - read-only.

## 16. Command / Repository Boundary

N/A - read-only aggregation.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

N/A - read-only polling.

## 19. Frontend UX States

loading, error, empty, polling, disabled (actions).

### Component Reuse

DataTablePagination, ConfirmDialog, Badge, LoadingState, ErrorState.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[ ] audit event recorded (N/A - read-only)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Route test for status API |
| frontend component | Dashboard rendering tests |
| e2e | Proctor dashboard full flow |

## 23. Acceptance Criteria

```txt
[x] Admin can view proctor dashboard for an exam.
[x] Dashboard polls candidate status every 5s.
[x] Status cards show active, disrupted, submitted, graded candidates.
[x] Action buttons (force-submit, extend-time, misconduct) are visible and functional.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Polling may add load to DB.

## 25. Rollback / Compatibility

- Rollback strategy: remove route and page.

## 26. PR Boundaries

Limited to polling dashboard and status API only.

## 27. Review Guardrails

Must not introduce WebSocket/SSE. Must not implement camera monitoring.

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
1. Modified files: exam.ts, contracts, ProctorDashboardPage.tsx, tests
2. Behavior changed: admin can monitor live exam via polling dashboard
3. API / contract changes: GET /api/admin/exams/:id/candidates/status
4. Tests added/updated: dashboard tests
5. Verification commands and results: pnpm verify passed
```
