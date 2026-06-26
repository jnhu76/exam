# P2E-J1 — Audit Log Viewer

## 1. Summary

Build the frontend UI for viewing, searching, and filtering audit logs using the existing `GET /api/admin/audit-logs` API.

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

- Current behavior: `GET /api/admin/audit-logs` API exists but no frontend page.
- Impact: Admin cannot browse audit trail in UI.
- Discovery source: 06-phase2-gap-analysis.md P1-5, 01-frontend-inventory.md
- Why this must be fixed now: Required for operational evidence.

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
Admin navigates to /admin/audit-logs
  -> GET /api/admin/audit-logs?action=&targetType=&page=
  -> sees paginated audit log table
  -> filters by action, target type, date range
  -> clicks row to see metadata
```

## 6. Current Behavior

No audit log page. API returns paginated logs.

## 7. Target Behavior

- AuditLogPage with table showing: timestamp, actor, action, target, metadata preview.
- Filters: action dropdown, target type dropdown, date range.
- Pagination.
- Metadata expansion on row click.

## 8. Scope

This job may modify:

```txt
apps/web/src/pages/AuditLogPage.tsx (new)
apps/web/src/App.tsx (new route)
```

## 9. Non-Scope

This job must not modify:

```txt
Backend API
Audit log schema
```

## 10. Dependencies

```txt
Depends on: P2D-J6
Blocks: —
Can run in parallel with: P2E-J2, P2E-J3, P2E-J4, P2E-J5, P2E-J6
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| frontend | AuditLogPage.tsx | Audit log UI |
| e2e | audit-log.spec.ts | Audit log viewer test |

## 12. Backend Contract Trace

N/A - frontend only.

## 13. API / Contract Changes

No API changes.

## 14. Error Contract

Handles existing API errors.

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

N/A.

## 19. Frontend UX States

loading, error, empty, paginated list, filter active.

### Component Reuse

DataTablePagination, SearchInput, Badge, ErrorState, LoadingState.

## 20. Audit / Security / RBAC

N/A - frontend only.

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| frontend component | Audit log page rendering |
| e2e | Admin views and filters audit logs |

## 23. Acceptance Criteria

```txt
[x] Admin can view paginated audit logs.
[x] Admin can filter by action and target type.
[x] Admin can expand metadata for a log entry.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Large audit logs may cause performance issues.

## 25. Rollback / Compatibility

- Rollback strategy: remove page and route.

## 26. PR Boundaries

Limited to audit log viewer UI only.

## 27. Review Guardrails

Must not modify backend audit API.

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
1. Modified files: AuditLogPage.tsx, App.tsx, tests
2. Behavior changed: admin can view audit logs in UI
3. Tests added/updated: audit log viewer tests
4. Verification commands and results: pnpm verify passed
```
