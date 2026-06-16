# P2D-J6 — Grading Audit

## 1. Summary

Ensure all score changes and grader identity are recorded in the audit log with timestamps.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: Individual grading decisions are not auditable. Only attempt.submit is logged.
- Impact: Score changes cannot be traced to a grader.
- Discovery source: 04-state-machine-audit.md
- Why this must be fixed now: Required for operational evidence.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin enters score on grading detail page
  -> POST /api/admin/attempts/:id/grade-question
  -> backend records score, comment, graderId, gradedAt
  -> audit log records grading.score_entered with metadata
  -> admin can view audit trail
```

## 6. Current Behavior

No grading-specific audit events.

## 7. Target Behavior

- Audit action `grading.score_entered` recorded on every manual score save.
- Metadata: attemptId, questionId, score, maxScore, previousScore, graderId.
- Audit action `grading.finalized` recorded when attempt becomes fully_graded.
- Audit action `result.published` recorded when admin publishes results.

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/attempts.ts
apps/api/src/routes/scores.ts
apps/api/src/routes/exam.ts
packages/db/src/repository/auditLogRepo.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Audit log UI (P2E-J1)
Grading queue API logic (P2D-J3)
```

## 10. Dependencies

```txt
Depends on: P2D-J4, P2D-J5
Blocks: P2E-J1
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| api routes | attempts.ts, scores.ts, exam.ts | Audit calls |
| db / repository | auditLogRepo.ts | Ensure audit logging |

## 12. Backend Contract Trace

N/A - audit-only.

## 13. API / Contract Changes

No API changes.

## 14. Error Contract

N/A.

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
[x] RBAC checked
[x] organization boundary checked
[x] audit event recorded (grading.score_entered, grading.finalized, result.published)
[x] sensitive metadata excluded
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Audit log contains grading events |

## 23. Acceptance Criteria

```txt
[x] Manual score entry creates grading.score_entered audit event.
[x] Fully graded attempt creates grading.finalized audit event.
[x] Result publish creates result.published audit event.
[x] Audit metadata includes grader identity and score delta.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Audit logging may slow down grading API.

## 25. Rollback / Compatibility

- Rollback strategy: remove audit calls.

## 26. PR Boundaries

Limited to grading audit events only.

## 27. Review Guardrails

Must not change grading logic. Must log all score changes.

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
1. Modified files: attempts.ts, scores.ts, exam.ts, tests
2. Behavior changed: grading actions now audited
3. Tests added/updated: audit log grading tests
4. Verification commands and results: pnpm verify passed
```
