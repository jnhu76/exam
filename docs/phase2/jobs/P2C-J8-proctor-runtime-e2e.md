# P2C-J8 — Proctor Runtime E2E

## 1. Summary

Create E2E tests covering proctor runtime flows: disrupted detection, force submit, extend time, and misconduct flagging.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[x] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: No E2E covers proctor actions.
- Impact: Proctor runtime may regress without detection.
- Discovery source: 05-user-flow-trace-map.md C
- Why this must be fixed now: Required to verify P2C implementation.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[x] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate takes exam
  -> Admin opens proctor dashboard
  -> Admin sees candidate status
  -> Admin performs action (force-submit, extend-time, misconduct)
  -> Candidate UI reflects change
```

## 6. Current Behavior

No proctor E2E.

## 7. Target Behavior

E2E covers:
- Disrupted detection appears on dashboard.
- Force-submit transitions attempt to graded.
- Extend-time updates deadline.
- Misconduct flag appears as badge.

## 8. Scope

This job may modify:

```txt
apps/e2e/e2e/proctor-runtime.spec.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Production code
```

## 10. Dependencies

```txt
Depends on: P2C-J2, P2C-J3, P2C-J4, P2C-J5
Blocks: P2D-J1
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| e2e | proctor-runtime.spec.ts | New E2E specs |

## 12. Backend Contract Trace

N/A.

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

N/A.

## 21. Seed Impact

```txt
[ ] no seed change
[x] demo seed update (need in_progress/disrupted attempts)
[x] e2e seed update
```

## 22. Tests

| Type | Required Test |
|---|---|
| e2e | proctor-runtime.spec.ts |

## 23. Acceptance Criteria

```txt
[x] E2E covers disrupted detection on dashboard.
[x] E2E covers force-submit.
[x] E2E covers extend-time.
[x] E2E covers misconduct flag.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: E2E may be flaky due to polling timing.

## 25. Rollback / Compatibility

- Rollback strategy: remove E2E specs.

## 26. PR Boundaries

E2E tests only.

## 27. Review Guardrails

Must not change production code to make tests pass.

## 28. Verification Commands

```bash
pnpm e2e
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: apps/e2e/e2e/proctor-runtime.spec.ts
2. Behavior changed: none
3. Tests added/updated: proctor runtime E2E
4. Verification commands and results: pnpm e2e passed
```
