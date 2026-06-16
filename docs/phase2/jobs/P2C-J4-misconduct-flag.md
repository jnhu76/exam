# P2C-J4 — Misconduct Flag

## 1. Summary

Add an admin API and UI to flag exam misconduct with notes, persisted on the attempt and recorded in the audit log.

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

- Current behavior: MARK_MISCONDUCT permission exists in RBAC but no API or UI.
- Impact: Cannot record or track exam misconduct incidents.
- Discovery source: 06-phase2-gap-analysis.md P1-4
- Why this must be fixed now: Required for proctor runtime evidence.

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
Admin views proctor dashboard
  -> sees suspicious activity
  -> clicks "Flag Misconduct"
  -> POST /admin/attempts/:id/misconduct
  -> misconduct flag + notes persisted on attempt
  -> audit log recorded
  -> badge shown on attempt in dashboard and detail views
```

## 6. Current Behavior

No misconduct API or persistence.

## 7. Target Behavior

- Admin POST endpoint flags misconduct on an attempt.
- Stores: flaggedAt, flaggedBy, notes, severity (warning / serious).
- Visible on proctor dashboard, attempt detail, and result views.
- Audit event `attempt.misconductFlagged`.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
packages/contracts/src/attempt.ts
packages/db/src/schema/pg.ts (misconduct columns or JSONB)
apps/web/src/pages/ (proctor dashboard, attempt detail)
```

## 9. Non-Scope

This job must not modify:

```txt
Auto-misconduct detection (no AI, no camera)
Candidate notification (Phase 3)
```

## 10. Dependencies

```txt
Depends on: P2C-J1
Blocks: P2C-J8
Can run in parallel with: P2C-J2, P2C-J3
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | attempt.ts | Misconduct flag schemas |
| api routes | attempts.ts | New admin route |
| db / repository | schema/pg.ts, attemptRepo.ts | Misconduct fields |
| frontend | proctor dashboard, attempt detail | Flag button + badge |
| e2e | proctor-runtime.spec.ts | Misconduct flag test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /admin/attempts/:attemptId/misconduct |
| Request Schema | `{ notes: string, severity: enum }` |
| Response Schema | `LoadAttemptResponse` or `{ ok: true }` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | FlagMisconduct |
| Repository | attemptRepo.update |
| DB Tables | exam_attempts |
| Transaction | No |
| Locking | No |
| Audit | attempt.misconductFlagged |
| Tests | Route tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| POST /admin/attempts/:id/misconduct | `{ notes, severity }` | `{ ok: true }` | NOT_FOUND, FORBIDDEN | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| attempt not found | 404 | NOT_FOUND | error toast |
| not admin | 403 | FORBIDDEN | permission denied |

## 15. State Machine Contract

N/A - no state transition.

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: flagMisconduct
Input: attemptRepo, attemptId, notes, severity, adminId
Output: updated ExamAttempt
Allowed states: any attempt status
Side effects: updates misconduct fields
```

## 17. DB / Transaction / Locking Plan

```txt
[x] migration needed? yes
[ ] new table needed? no
[x] new column needed? yes (misconduct JSONB or columns)
[ ] enum change needed? no
[ ] transaction needed? no
[ ] row lock needed? no
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

## 18. Concurrency / Idempotency / Race Cases

- Multiple misconduct flags on same attempt: overwrite or append. Decision: overwrite with latest.

## 19. Frontend UX States

loading, error, form input, badge display.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] organization boundary checked
[x] audit event recorded (attempt.misconductFlagged)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Route test for misconduct flag |
| e2e | Admin flags misconduct, badge appears |

## 23. Acceptance Criteria

```txt
[x] Admin can flag misconduct with notes and severity.
[x] Flag is visible on proctor dashboard and attempt detail.
[x] Audit log records flag with admin identity.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Migration adds columns to exam_attempts.

## 25. Rollback / Compatibility

- Rollback strategy: remove columns via migration.

## 26. PR Boundaries

Limited to misconduct flag API and UI only.

## 27. Review Guardrails

Must not implement auto-detection or camera monitoring.

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
1. Modified files: attempts.ts, schema, contracts, frontend, tests
2. Behavior changed: admin can flag misconduct
3. API / contract changes: POST /admin/attempts/:id/misconduct
4. DB / migration changes: yes (misconduct fields)
5. Tests added/updated: misconduct flag tests
6. Verification commands and results: pnpm verify passed
```
