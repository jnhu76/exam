# P2A-J6 — Candidate Runtime E2E Matrix

## 1. Summary

Create end-to-end tests covering abnormal candidate runtime paths: refresh, disconnect, double-click start, deadline crash, and save/submit race conditions.

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

- Current behavior: E2E covers happy path, resume, and submit-flush only. No E2E for concurrent start, deadline crash, or save/submit race.
- Impact: Production runtime correctness is not proven under abnormal conditions.
- Discovery source: 05-user-flow-trace-map.md E, 06-phase2-gap-analysis.md
- Why this must be fixed now: Without abnormal path E2E, P0 correctness cannot be verified.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

Multiple abnormal flows:
- Double-click start -> only one attempt created
- Browser refresh during exam -> answers preserved
- Disconnect -> disrupted -> restore -> time preserved
- Deadline crash -> auto-submit -> graded result visible
- Save/submit race -> deterministic outcome

## 6. Current Behavior

E2E exists for happy path, resume, and submit-flush. No abnormal path coverage.

## 7. Target Behavior

E2E matrix covers:
- Refresh during exam: answers restored
- Double-click start button: no duplicate attempts
- Disconnect and restore: disrupted -> in_progress, time preserved
- Deadline with browser crash: server auto-submits, result visible on reconnect
- Save while submitting: save rejected or queued deterministically

## 8. Scope

This job may modify:

```txt
apps/e2e/e2e/*.spec.ts
apps/e2e/e2e/helpers.ts (if needed)
```

## 9. Non-Scope

This job must not modify:

```txt
apps/
packages/
(except test helpers)
```

## 10. Dependencies

```txt
Depends on: P2A-J1, P2A-J2, P2A-J3, P2A-J4, P2A-J5
Blocks: P2B-J1, P2C-J8
Can run in parallel with: nothing (needs all P2A jobs)
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| e2e | apps/e2e/e2e/* | New spec files for abnormal paths |

## 12. Backend Contract Trace

N/A - no backend API change.

## 13. API / Contract Changes

No API changes.

## 14. Error Contract

No new errors.

## 15. State Machine Contract

N/A - no state machine change.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

E2E must verify:
- Double-click start: only one attempt
- Deadline crash: auto-submit grades attempt
- Save/submit race: no data loss

## 19. Frontend UX States

loading, error, disabled, deadline passed, submitted, grading, graded.

## 20. Audit / Security / RBAC

N/A.

## 21. Seed Impact

```txt
[ ] no seed change
[x] demo seed update (need disrupted / near-deadline attempts)
[x] e2e seed update
[ ] test factory only
```

## 22. Tests

| Type | Required Test |
|---|---|
| e2e | refresh-during-exam.spec.ts |
| e2e | double-click-start.spec.ts |
| e2e | disconnect-restore.spec.ts |
| e2e | deadline-crash.spec.ts |
| e2e | save-submit-race.spec.ts |

## 23. Acceptance Criteria

```txt
[x] E2E covers refresh during exam with answer persistence.
[x] E2E covers double-click start (no duplicate attempts).
[x] E2E covers disconnect -> disrupted -> restore with time preserved.
[x] E2E covers deadline browser crash -> auto-submit -> graded.
[x] E2E covers save/submit race condition.
[x] All E2E tests pass against PostgreSQL.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: E2E may be flaky if timing-dependent. Use deterministic waits.
- Risk 2: Seed data may mask logic bugs.

## 25. Rollback / Compatibility

- Rollback strategy: remove new E2E specs.

## 26. PR Boundaries

Limited to E2E tests only. No production code change.

## 27. Review Guardrails

Must not change E2E expectations to hide a real bug. Must not change production code to make tests pass.

## 28. Verification Commands

```bash
pnpm e2e
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: apps/e2e/e2e/*.spec.ts
2. Behavior changed: none (E2E only)
3. Behavior explicitly not changed: all production code
4. API / contract changes: none
5. State-machine changes: none
6. DB / migration changes: none
7. Tests added/updated: 5 new E2E specs
8. Verification commands and results: pnpm e2e passed
9. Remaining risks or follow-ups: monitor E2E flakiness in CI
```
