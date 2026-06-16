# P2-PLAN-J1 — Phase 2 Plan Finalization

## 1. Summary

Align `docs/phase2/phase2.plan.md` with discovery findings and mark it as the authoritative execution plan; no code changes.

## 2. Job Classification

```txt
[x] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: `phase2.plan.md` exists but may have minor naming inconsistencies or missing cross-references after discovery.
- Impact: Implementation teams may reference stale or incomplete plan sections.
- Discovery source: `phase2.plan.md` self-review against `01`-`06` discovery docs.
- Why this must be fixed now: All downstream jobs depend on an authoritative plan.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

This job does not directly close a Runtime Decision Gate. It is a planning prerequisite.

## 5. User Flow Closed

No user flow is directly touched. This job produces the authoritative plan that subsequent jobs execute against.

## 6. Current Behavior

`phase2.plan.md` is written and contains phases, jobs, and acceptance criteria. Discovery docs `01`-`06` provide fact tables. Minor alignment gaps may exist between the plan and the latest discovery state.

## 7. Target Behavior

- `phase2.plan.md` is fully aligned with discovery docs.
- Job IDs, names, and dependencies are consistent with `phase2_job_index.md`.
- Any ambiguity is documented as follow-up items, not hidden.

## 8. Scope

This job may modify:

```txt
docs/phase2/phase2.plan.md
docs/phase2/jobs/phase2_job_index.md
docs/phase2/jobs/*.md
```

## 9. Non-Scope

This job must not modify:

```txt
apps/
packages/
README.md
tests/
seed/
migrations/
```

## 10. Dependencies

```txt
Depends on: discovery docs 01-06 being stable
Blocks: P2.0-J1, P2A-J1
Can run in parallel with: nothing (first job)
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | — | — |
| domain / engine | — | — |
| api routes | — | — |
| db / repository | — | — |
| frontend | — | — |
| e2e | — | — |
| docs | `docs/phase2/phase2.plan.md`, `docs/phase2/jobs/*` | alignment, follow-ups |

## 12. Backend Contract Trace

N/A — no backend API change.

## 13. API / Contract Changes

N/A — no API change.

## 14. Error Contract

N/A — no API change.

## 15. State Machine Contract

N/A — no state machine change.

## 16. Command / Repository Boundary

N/A — no backend command/repository change.

## 17. DB / Transaction / Locking Plan

```txt
[ ] migration needed? no
[ ] new table needed? no
[ ] new column needed? no
[ ] enum change needed? no
[ ] transaction needed? no
[ ] row lock needed? no
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

## 18. Concurrency / Idempotency / Race Cases

N/A — no runtime change.

## 19. Frontend UX States

N/A — no frontend change.

## 20. Audit / Security / RBAC

N/A — no runtime change.

## 21. Seed Impact

```txt
[x] no seed change
[ ] demo seed update
[ ] e2e seed update
[ ] test factory only
```

## 22. Tests

| Type | Required Test |
|---|---|
| unit | N/A |
| integration | N/A |
| repository / transaction | N/A |
| api route | N/A |
| contract / OpenAPI | N/A |
| frontend component | N/A |
| e2e | N/A |
| regression | N/A |

## 23. Acceptance Criteria

```txt
[x] phase2.plan.md references all discovery docs 01-06 correctly
[x] Job IDs in plan match phase2_job_index.md
[x] Dependencies and blocks are acyclic and logical
[x] No production code changed
[x] pnpm verify passes (no doc-only verification needed beyond format)
```

## 24. Regression Risks

- Risk 1: Plan updates may accidentally suggest code changes that are out of scope. Must keep changes doc-only.

## 25. Rollback / Compatibility

- Rollback strategy: git revert docs changes.
- Backward compatibility: N/A.
- Data compatibility: N/A.
- API compatibility: N/A.

## 26. PR Boundaries

This PR must be limited to:

```txt
Documentation alignment for Phase 2 plan and job index only.
```

This PR must not combine:

```txt
[x] OpenAPI baseline + business behavior change
[x] state-machine change + unrelated UI redesign
[x] DB migration + large frontend redesign
[x] new API + new infrastructure dependency
[x] E2E seed rewrite + business logic change
```

## 27. Review Guardrails

This PR must not:

```txt
[x] weaken backend state-machine checks
[x] change E2E expectations to hide a real bug
[x] move backend authority to frontend-only checks
[x] introduce Redis/MQ/WebSocket/Electron without ADR
[x] broaden roles or permissions accidentally
[x] bypass organization boundary / candidate ownership
[x] change seed data to make tests pass without fixing logic
[x] mix unrelated UI redesign with runtime correctness changes
```

Reviewer must verify:

```txt
[x] modified files match the declared scope
[x] no unrelated route/contract/state-machine changes
[x] no expectation drift in tests
[x] no business behavior change in docs-only or OpenAPI-only jobs
```

## 28. Verification Commands

```bash
pnpm format:check
```

## 29. Final Report Requirements

The implementation report must include:

```txt
1. Modified files: docs/phase2/phase2.plan.md, docs/phase2/jobs/phase2_job_index.md
2. Behavior changed: none
3. Behavior explicitly not changed: all production code
4. API / contract changes: none
5. State-machine changes: none
6. DB / migration changes: none
7. Tests added/updated: none
8. Verification commands and results: pnpm format:check passed
9. Remaining risks or follow-ups: none
```
