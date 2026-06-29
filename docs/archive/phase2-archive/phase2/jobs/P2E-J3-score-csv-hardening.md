# P2E-J3 — Score CSV Hardening

## 1. Summary

Harden the CSV export endpoint for correctness, permission checks, and large dataset handling.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[x] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: CSV export exists but is basic. No large dataset tests.
- Impact: Export may fail or be incorrect for large exams.
- Discovery source: 01-frontend-inventory.md
- Why this must be fixed now: Required for reliable operational export.

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
Admin views score list
  -> clicks "Export CSV"
  -> GET /api/exams/:id/export/scores
  -> receives CSV file with correct data
```

## 6. Current Behavior

CSV export generated synchronously. Limited testing.

## 7. Target Behavior

- CSV includes all required columns: candidate fields, score, passed, attemptNo, submittedAt.
- Handles 1000+ records correctly.
- Permission-checked (Admin only).
- Content-Type and filename headers correct.
- Encoding is UTF-8 with BOM for Excel compatibility.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/export.ts
apps/api/src/routes/export.test.ts
packages/db/src/repository/attemptRepo.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend UI (export button already exists)
PDF export
Async job queue
```

## 10. Dependencies

```txt
Depends on: P2D-J6
Blocks: —
Can run in parallel with: P2E-J1, P2E-J2, P2E-J4, P2E-J5, P2E-J6
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| api routes | export.ts | Harden CSV generation |
| db / repository | attemptRepo.ts | Efficient large query |
| e2e | export.spec.ts | Large dataset export test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/exams/:id/export/scores |
| Request Schema | none |
| Response Schema | CSV binary |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A |
| Repository | attemptRepo.listGradedByExam (large query) |
| DB Tables | exam_attempts, candidate_profiles, users, candidate_fields |
| Transaction | No |
| Locking | No |
| Audit | export_scores (already exists) |
| Tests | Export correctness and large dataset tests |

## 13. API / Contract Changes

No shape changes. Behavior hardened.

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| exam not found | 404 | NOT_FOUND | error toast |
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
[x] audit event recorded (export_scores)
```

## 21. Seed Impact

```txt
[x] no demo seed change
[x] test factory only
```

Large export test data (1000+ records) must be generated programmatically in test setup (`beforeAll` or test factory), not added to demo seed. Demo seed should remain a realistic-but-small dataset for dev/CI startup.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Export correctness |
| integration | Large dataset (1000+ records, generated in test factory) |
| e2e | CSV download and content verification |

## 23. Acceptance Criteria

```txt
[x] CSV export contains correct columns and data.
[x] Export handles 1000+ records without error.
[x] Export is permission-checked.
[x] File is UTF-8 with BOM.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Large export may cause memory issues if not streamed.

## 25. Rollback / Compatibility

- Rollback strategy: revert export logic changes.

## 26. PR Boundaries

Limited to CSV export hardening only.

## 27. Review Guardrails

Must not introduce job queue or async processing.

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
1. Modified files: export.ts, attemptRepo.ts, tests
2. Behavior changed: CSV export hardened for large datasets
3. Tests added/updated: large dataset export tests
4. Verification commands and results: pnpm verify passed
```
