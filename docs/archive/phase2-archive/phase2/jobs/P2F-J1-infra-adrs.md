# P2F-J1 — Infra ADRs

## 1. Summary

Produce Architecture Decision Records for optional infrastructure upgrades: Redis, Job Queue, WebSocket/SSE, and Desktop/Electron. No implementation.

## 2. Job Classification

```txt
[x] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[x] infra ADR job
```

## 3. Problem / Gap

- Current behavior: No documented decision records for optional infrastructure.
- Impact: Future teams may introduce premature complexity without understanding trade-offs.
- Discovery source: 06-phase2-gap-analysis.md Redis/MQ assessment
- Why this must be fixed now: Establishes clear boundaries for Phase 3+.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[x] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

No user flow. This job produces documentation only.

## 6. Current Behavior

No ADRs for Redis, Job Queue, WebSocket/SSE, or Desktop.

## 7. Target Behavior

- ADR-001: Redis introduction (if multi-instance needed)
- ADR-002: WebSocket/SSE introduction (if real-time proctor required)
- ADR-003: Job queue introduction (if async jobs needed)
- ADR-004: Desktop/Electron shell (if lockdown browser needed)

Each ADR answers:
- What concrete pain point triggers this?
- Why PG + HTTP is insufficient?
- What is the minimal viable adoption?
- What new operational burden appears?
- What failure modes are introduced?
- What is the rollback path?

## 8. Scope

This job may modify:

```txt
docs/adr/ADR-001-redis.md
docs/adr/ADR-002-websocket-sse.md
docs/adr/ADR-003-job-queue.md
docs/adr/ADR-004-desktop-electron.md
```

## 9. Non-Scope

This job must not modify:

```txt
apps/
packages/
Any production code
```

## 10. Dependencies

```txt
Depends on: —
Blocks: —
Can run in parallel with: all Phase 2 jobs
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| docs | docs/adr/*.md | ADR documents |

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

No tests required (docs only).

## 23. Acceptance Criteria

```txt
[x] ADR-001 documents Redis adoption criteria and trade-offs.
[x] ADR-002 documents WebSocket/SSE adoption criteria and trade-offs.
[x] ADR-003 documents job queue adoption criteria and trade-offs.
[x] ADR-004 documents Desktop/Electron adoption criteria and trade-offs.
[x] Each ADR includes pain point, minimal adoption, operational burden, failure modes, rollback path.
[x] No production code changed.
```

## 24. Regression Risks

N/A.

## 25. Rollback / Compatibility

N/A.

## 26. PR Boundaries

Documentation only.

## 27. Review Guardrails

Must not introduce implementation or dependencies.

## 28. Verification Commands

```bash
pnpm format:check
```

## 29. Final Report Requirements

```txt
1. Modified files: docs/adr/*.md
2. Behavior changed: none
3. Tests added/updated: none
4. Verification commands and results: format check passed
```
