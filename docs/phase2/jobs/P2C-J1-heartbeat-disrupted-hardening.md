# P2C-J1 — Heartbeat and Disrupted Detection Hardening

## 1. Summary

Stabilize the heartbeat scanner by adding transaction safety, audit logging for disruptions, and ensuring deterministic disrupted detection.

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

- Current behavior: Heartbeat scanner runs without transaction. Failed markDisrupted is logged and skipped. No audit log for disruptions.
- Impact: Disrupted detection is best-effort and not auditable.
- Discovery source: 04-state-machine-audit.md
- Why this must be fixed now: Proctor runtime depends on reliable disrupted detection.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate stops sending heartbeats
  -> Scanner detects timeout
  -> markDisrupted called inside transaction
  -> Audit log records disruption
  -> Admin sees disrupted status on proctor dashboard
```

## 6. Current Behavior

Heartbeat plugin scans every 30s. Each markDisrupted is independent. No audit.

## 7. Target Behavior

- Scanner wraps each markDisrupted in a transaction.
- Audit event `attempt.disrupted` recorded with metadata.
- Scanner errors are retried on next scan.
- Scan interval and timeout are configurable via env.

## 8. Scope

This job may modify:

```txt
apps/api/src/plugins/heartbeat.ts
packages/exam-engine/src/attemptCommands.ts
packages/db/src/repository/attemptRepo.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend behavior
Deadline scanner (P2A-J2)
Force submit / extend time / misconduct
```

## 10. Dependencies

```txt
Depends on: P2A-J2, P2B-J2
Blocks: P2C-J2, P2C-J3, P2C-J4, P2C-J5
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| domain / engine | attemptCommands.ts | markDisrupted transaction safety |
| api routes | heartbeat.ts | Audit, retry, config |
| db / repository | attemptRepo.ts | Transaction support |
| e2e | heartbeat.test.ts | Updated tests |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | Internal plugin (no public API) |
| Domain Command | markDisrupted |
| Repository | attemptRepo.findByIdForUpdate, attemptRepo.update |
| DB Tables | exam_attempts, audit_logs |
| Transaction | YES |
| Locking | YES (findByIdForUpdate) |
| Audit | attempt.disrupted |
| Tests | heartbeat.test.ts |

## 13. API / Contract Changes

No public API changes.

## 14. Error Contract

N/A.

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[ ] Exam
[ ] Enrollment
[ ] Answer
[ ] Grading
[ ] Result Visibility
```

### Target Transition

```txt
in_progress -> disrupted (by scanner when heartbeat timeout)
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: markDisrupted
Input: attemptRepo, attemptId
Output: disrupted ExamAttempt
Allowed states: in_progress -> disrupted
Rejected states: submitted, graded, voided
Side effects: updates status, audit log
```

## 17. DB / Transaction / Locking Plan

```txt
[ ] migration needed? no
[ ] new table needed? no
[ ] new column needed? no
[ ] enum change needed? no
[x] transaction needed? yes
[x] row lock needed? yes
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

## 18. Concurrency / Idempotency / Race Cases

- Scanner may run while candidate saves. Transaction ensures safety.

## 19. Frontend UX States

N/A.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (system context)
[x] organization boundary checked
[x] audit event recorded (attempt.disrupted)
[x] sensitive metadata excluded
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| unit | markDisrupted transaction test |
| integration | Scanner marks disrupted and audits |

## 23. Acceptance Criteria

```txt
[x] markDisrupted runs inside a transaction.
[x] Disruption is recorded in audit log.
[x] Failed disruptions are retried on next scan.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Transaction may cause deadlock with save-answer transaction.

## 25. Rollback / Compatibility

- Rollback strategy: revert transaction wrapping.

## 26. PR Boundaries

Limited to heartbeat scanner hardening.

## 27. Review Guardrails

Must not introduce Redis or WebSocket.

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
1. Modified files: heartbeat.ts, attemptCommands.ts, tests
2. Behavior changed: disrupted detection is now transactional and audited
3. Behavior explicitly not changed: candidate runtime, deadline scanner
4. API / contract changes: none
5. State-machine changes: none
6. DB / migration changes: none
7. Tests added/updated: heartbeat transaction tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: monitor for deadlock
```
