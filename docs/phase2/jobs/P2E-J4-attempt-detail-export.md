# P2E-J4 — Attempt Detail Export

## 1. Summary

Add backend API and frontend UI to export answers and results for a single attempt.

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

- Current behavior: AttemptDetailPage is view-only. No export per attempt.
- Impact: Admin cannot export individual attempt data.
- Discovery source: 01-frontend-inventory.md
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
Admin opens attempt detail page
  -> clicks "Export Attempt"
  -> GET /api/admin/attempts/:id/export
  -> receives JSON/CSV with attempt answers and results
```

## 6. Current Behavior

No attempt export API or UI.

## 7. Target Behavior

- `GET /api/admin/attempts/:id/export` returns attempt details including answers and question results.
- Format: JSON (default) or CSV via query param.
- Admin-only access.
- Audit event `attempt.exported`.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
packages/contracts/src/attempt.ts
apps/web/src/pages/AttemptDetailPage.tsx
```

## 9. Non-Scope

This job must not modify:

```txt
Bulk attempt export
PDF export
```

## 10. Dependencies

```txt
Depends on: P2D-J6
Blocks: —
Can run in parallel with: P2E-J1, P2E-J2, P2E-J3, P2E-J5, P2E-J6
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | attempt.ts | Export response schema |
| api routes | attempts.ts | New admin route |
| frontend | AttemptDetailPage.tsx | Export button |
| e2e | attempt-export.spec.ts | Export test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /admin/attempts/:id/export |
| Request Schema | query: `{ format?: json|csv }` |
| Response Schema | attempt export data |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A (read-only) |
| Repository | attemptRepo.findById |
| DB Tables | exam_attempts |
| Transaction | No |
| Locking | No |
| Audit | attempt.exported |
| Tests | Route tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /admin/attempts/:id/export | query format | export data | NOT_FOUND, FORBIDDEN | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error toast |
| not admin | 403 | FORBIDDEN | permission denied |

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

N/A.

## 19. Frontend UX States

N/A.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[x] audit event recorded (attempt.exported)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Export route test |
| e2e | Admin exports attempt detail |

## 23. Acceptance Criteria

```txt
[x] Admin can export attempt detail as JSON.
[x] Admin can export attempt detail as CSV.
[x] Export includes answers and question results.
[x] Audit log records export.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Export may expose sensitive data.

## 25. Rollback / Compatibility

- Rollback strategy: remove route and button.

## 26. PR Boundaries

Limited to attempt detail export only.

## 27. Review Guardrails

Must not expose data beyond admin scope.

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
1. Modified files: attempts.ts, contracts, AttemptDetailPage.tsx, tests
2. Behavior changed: admin can export attempt detail
3. API / contract changes: GET /admin/attempts/:id/export
4. Tests added/updated: export tests
5. Verification commands and results: pnpm verify passed
```
