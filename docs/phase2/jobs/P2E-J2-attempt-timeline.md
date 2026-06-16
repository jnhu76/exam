# P2E-J2 — Attempt Timeline

## 1. Summary

Build backend API and frontend UI to display a chronological timeline of attempt lifecycle events: start, save, heartbeat, disrupt, restore, submit, grade.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: Audit trail exists but is not structured as a visual timeline per attempt.
- Impact: Admin/proctor cannot quickly diagnose attempt issues.
- Discovery source: 05-user-flow-trace-map.md D
- Why this must be fixed now: Required for operational evidence and proctor diagnosis.

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
Admin opens attempt detail page
  -> GET /api/admin/attempts/:id/timeline
  -> sees chronological events: start, save, heartbeat, disrupt, restore, submit, grade
  -> clicks event to see metadata
```

## 6. Current Behavior

No attempt timeline API or UI.

## 7. Target Behavior

- `GET /api/admin/attempts/:id/timeline` returns ordered events from audit_logs filtered by attemptId.
- Events mapped to human-readable labels.
- Visual timeline component on AttemptDetailPage.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
packages/contracts/src/audit.ts
apps/web/src/pages/AttemptDetailPage.tsx
```

## 9. Non-Scope

This job must not modify:

```txt
Audit log schema
Attempt state machine
```

## 10. Dependencies

```txt
Depends on: P2D-J6
Blocks: —
Can run in parallel with: P2E-J1, P2E-J3, P2E-J4, P2E-J5, P2E-J6
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | audit.ts | Timeline event schema |
| api routes | attempts.ts | GET /api/admin/attempts/:id/timeline |
| frontend | AttemptDetailPage.tsx | Timeline component |
| e2e | attempt-timeline.spec.ts | Timeline test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/admin/attempts/:id/timeline |
| Request Schema | none |
| Response Schema | `{ events: [{ timestamp, action, actor, metadata }] }` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A (query only) |
| Repository | auditLogRepo.listByTarget |
| DB Tables | audit_logs |
| Transaction | No |
| Locking | No |
| Audit | N/A (read-only) |
| Tests | Route tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/admin/attempts/:id/timeline | - | timeline events | NOT_FOUND, FORBIDDEN | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error state |

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

N/A.

## 19. Frontend UX States

loading, error, empty, timeline display.

### Component Reuse

ErrorState, LoadingState, Badge.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Timeline API returns correct events |
| frontend component | Timeline rendering |
| e2e | Admin views attempt timeline |

## 23. Acceptance Criteria

```txt
[x] Timeline shows all key attempt events in order.
[x] Events have human-readable labels.
[x] Metadata is expandable per event.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Audit log query may be slow for high-volume attempts.

## 25. Rollback / Compatibility

- Rollback strategy: remove route and UI component.

## 26. PR Boundaries

Limited to attempt timeline API and UI only.

## 27. Review Guardrails

Must not modify audit log insertion logic.

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
1. Modified files: attempts.ts, audit.ts, AttemptDetailPage.tsx, tests
2. Behavior changed: admin can view attempt timeline
3. API / contract changes: GET /api/admin/attempts/:id/timeline
4. Tests added/updated: timeline tests
5. Verification commands and results: pnpm verify passed
```
