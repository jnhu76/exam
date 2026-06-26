# P2B-J1 — Admin Operation Flow Audit

## 1. Summary

Verify the end-to-end admin operation loop from setup to export through documentation and gap identification; no code changes unless gaps require them.

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

- Current behavior: Admin CRUD exists but the full setup->assignment->publish->result->export loop has not been verified end-to-end.
- Impact: Unknown gaps may block real exam administration.
- Discovery source: 05-user-flow-trace-map.md B7-B9
- Why this must be fixed now: Must identify gaps before hardening them in P2B-J2.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin creates users/candidates/courses/questions
  -> creates exam with questions
  -> assigns candidates
  -> publishes exam
  -> exam opens automatically
  -> candidates take exam
  -> admin views scores
  -> admin exports CSV
```

## 6. Current Behavior

Individual admin flows work but full loop verification is missing.

## 7. Target Behavior

- Documented admin operation loop with verified steps.
- Identified gaps handed off to P2B-J2.
- E2E covering full loop.

## 8. Scope

This job may modify:

```txt
docs/phase2/jobs/P2B-J2-*.md (gap findings)
apps/e2e/e2e/admin-flow.spec.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Production code (unless critical gap found)
```

## 10. Dependencies

```txt
Depends on: P2A-J6
Blocks: P2B-J2
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| e2e | apps/e2e/e2e/admin-flow.spec.ts | Full admin loop E2E |
| docs | P2B-J2 job card | Gap findings |

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

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| e2e | Admin full loop E2E |

## 23. Acceptance Criteria

```txt
[x] Admin full loop E2E passes.
[x] Gaps documented for P2B-J2.
[x] No production code changed unless critical.
```

## 24. Regression Risks

N/A.

## 25. Rollback / Compatibility

N/A.

## 26. PR Boundaries

Docs and E2E audit only.

## 27. Review Guardrails

Must not change production code to make tests pass without documenting the gap.

## 28. Verification Commands

```bash
pnpm e2e
```

## 29. Final Report Requirements

```txt
1. Modified files: e2e specs, docs
2. Behavior changed: none
3. Gaps identified: documented in P2B-J2
4. Tests added/updated: admin-flow E2E
```
