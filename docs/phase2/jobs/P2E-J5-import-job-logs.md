# P2E-J5 — Import Job Logs

## 1. Summary

Persist candidate and question import summaries so admins can view import history and diagnose issues.

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

- Current behavior: Import endpoints return summaries but do not persist them. Import history is lost.
- Impact: Admin cannot diagnose past import issues.
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
Admin imports candidates/questions
  -> import API persists summary
  -> Admin navigates to import logs page
  -> sees list of imports with status, counts, errors
```

## 6. Current Behavior

Import returns response but no persistence.

## 7. Target Behavior

- New table `import_job_logs` stores: id, type, status, total, created, updated, errors, metadata, createdAt.
- `GET /api/admin/import-logs` returns paginated import history.
- Import endpoints create log entry before processing and update on completion.

## 8. Scope

This job may modify:

```txt
packages/db/src/schema/pg.ts
packages/db/src/repository/importJobLogRepo.ts (new)
apps/api/src/routes/candidate.ts
apps/api/src/routes/question.ts
apps/api/src/routes/audit.ts (new route for import logs)
apps/web/src/pages/ImportLogsPage.tsx (new)
```

## 9. Non-Scope

This job must not modify:

```txt
Import logic itself
Import validation rules
```

## 10. Dependencies

```txt
Depends on: P2B-J2
Blocks: —
Can run in parallel with: P2E-J1, P2E-J2, P2E-J3, P2E-J4, P2E-J6
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | new file | ImportJobLog schema |
| db / repository | schema/pg.ts, importJobLogRepo.ts | New table and repo |
| api routes | candidate.ts, question.ts, audit.ts | Log creation and query |
| frontend | ImportLogsPage.tsx | Import history UI |
| e2e | import-logs.spec.ts | Import log test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/admin/import-logs, POST /api/candidates/import, POST /api/questions/import |
| Request Schema | existing for imports |
| Response Schema | import summary + log id |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A |
| Repository | importJobLogRepo.create, importJobLogRepo.list |
| DB Tables | import_job_logs |
| Transaction | No |
| Locking | No |
| Audit | N/A (import logs are themselves audit-like) |
| Tests | Route and integration tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/admin/import-logs | query params | log items | - | Admin |
| POST /api/candidates/import | existing | existing + logId | - | Admin |
| POST /api/questions/import | existing | existing + logId | - | Admin |

### Backward Compatibility

- Preserve all existing import response fields.
- Add `logId` as a new optional field in the response.
- Frontend import flow must be updated in the same PR if it consumes `logId`.

## 14. Error Contract

N/A.

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

```txt
[x] migration needed? yes
[x] new table needed? yes (import_job_logs)
[ ] new column needed? no
[ ] enum change needed? no
[ ] transaction needed? no
[ ] row lock needed? no
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

## 18. Concurrency / Idempotency / Race Cases

N/A.

## 19. Frontend UX States

loading, error, empty, paginated list.

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
| integration | Import creates log entry |
| integration | Import logs list API |
| e2e | Admin views import history |

## 23. Acceptance Criteria

```txt
[x] Import operations persist summary logs.
[x] Admin can view paginated import history.
[x] Log includes status, counts, and errors.
[x] Existing import response fields are preserved.
[x] logId is added in a backward-compatible way.
[x] Frontend import flow updated in same PR if it consumes logId.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Import performance may degrade due to log writing.

## 25. Rollback / Compatibility

- Rollback strategy: reverse migration.

## 26. PR Boundaries

Limited to import job logs only.

## 27. Review Guardrails

Must not change import validation logic.

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
1. Modified files: schema, candidate.ts, question.ts, audit.ts, ImportLogsPage.tsx, tests
2. Behavior changed: import operations now persist logs
3. API / contract changes: GET /api/admin/import-logs, import responses include logId
4. DB / migration changes: yes (import_job_logs table)
5. Tests added/updated: import log tests
6. Verification commands and results: pnpm verify passed
```
