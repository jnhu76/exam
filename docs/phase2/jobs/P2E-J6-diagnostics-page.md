# P2E-J6 — Diagnostics Page

## 1. Summary

Build an admin diagnostics page showing runtime config, DB status, heartbeat scanner status, and version info.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: SystemHealthPage exists but is basic. No runtime config or heartbeat scanner visibility.
- Impact: Admin cannot diagnose system health during live exams.
- Discovery source: 01-frontend-inventory.md
- Why this must be fixed now: Required for operational monitoring.

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
Admin navigates to /admin/diagnostics
  -> sees: DB latency, heartbeat scanner status, runtime config, version
  -> can verify system health before live exam
```

## 6. Current Behavior

SystemHealthPage shows CPU, memory, DB ping. No heartbeat or config visibility.

## 7. Target Behavior

- DiagnosticsPage shows:
  - Server version and uptime
  - DB connection status and latency
  - Heartbeat scanner: interval, timeout, last scan time, disrupted count
  - Deadline scanner: interval, last scan time, auto-submit count
  - Runtime config values (non-sensitive)
- Data from `GET /api/system/diagnostics` (new endpoint).

### Scanner Metrics Source

Heartbeat and deadline scanner metrics are collected from in-memory counters maintained by the scanner plugins (`heartbeat.ts`, `deadlineScanner.ts`). These counters are reset on server restart.

Limitations:
- Metrics are single-instance only (no cross-instance aggregation).
- Metrics do not expose secrets, DB URLs, or internal IPs.
- If the system moves to multi-instance deployment (ADR-dependent), scanner metrics must be moved to a shared store (Redis or DB).

## 8. Scope

This job may modify:

```txt
apps/api/src/routes/system.ts
apps/web/src/pages/DiagnosticsPage.tsx (new)
apps/web/src/App.tsx
```

## 9. Non-Scope

This job must not modify:

```txt
System health API (keep existing)
Config secrets exposure
```

## 10. Dependencies

```txt
Depends on: P2B-J2
Blocks: —
Can run in parallel with: P2E-J1, P2E-J2, P2E-J3, P2E-J4, P2E-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| api routes | system.ts | GET /api/system/diagnostics |
| frontend | DiagnosticsPage.tsx | Diagnostics UI |
| e2e | diagnostics.spec.ts | Diagnostics page test |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/system/diagnostics |
| Request Schema | none |
| Response Schema | `{ version, uptime, dbLatency, heartbeatStatus: { interval, timeout, lastScanAt, disruptedCount }, deadlineScannerStatus: { interval, lastScanAt, autoSubmitCount }, config: { examDefaultDuration, heartbeatInterval, deadlineScanInterval } }` |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | N/A |
| Repository | N/A (reads from memory/metrics) |
| DB Tables | N/A |
| Transaction | No |
| Locking | No |
| Audit | N/A |
| Tests | Route tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/system/diagnostics | - | diagnostics data | - | Admin |

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

loading, error, data display.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (Admin only)
[x] sensitive metadata excluded (no secrets)
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Diagnostics API returns correct data |
| frontend component | Diagnostics page rendering |
| e2e | Admin views diagnostics |

## 23. Acceptance Criteria

```txt
[x] Diagnostics page shows version, uptime, DB latency.
[x] Heartbeat scanner status is visible.
[x] Deadline scanner status is visible.
[x] No sensitive config is exposed.
[x] Scanner metrics source is documented (in-memory counters, single-instance limitation).
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Scanner status may leak internal state.

## 25. Rollback / Compatibility

- Rollback strategy: remove route and page.

## 26. PR Boundaries

Limited to diagnostics page only.

## 27. Review Guardrails

Must not expose JWT secrets, DB URLs, or other sensitive config.

## 28. Verification Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: system.ts, DiagnosticsPage.tsx, App.tsx, tests
2. Behavior changed: admin can view system diagnostics
3. API / contract changes: GET /api/system/diagnostics
4. Tests added/updated: diagnostics tests
5. Verification commands and results: pnpm verify passed
```
