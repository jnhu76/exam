# P2A-J2 — Server-Side Deadline Auto-Submit

## 1. Summary

Add a server-side deadline scanner that auto-submits and auto-grades `in_progress` attempts when `deadlineAt` is reached, even if the browser crashes.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[x] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: If candidate's browser crashes at deadline, attempt stays `in_progress` -> heartbeat scanner marks `disrupted` -> never submitted -> score never computed.
- Impact: Candidate loses their answers and score permanently.
- Discovery source: `06-phase2-gap-analysis.md` P0-1, `04-state-machine-audit.md` §6
- Why this must be fixed now: Without this, the exam runtime is not production-safe.

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
Candidate is taking exam in TakeExamPage
  -> Browser crashes or network fails at deadline
  -> Server deadline scanner detects now > deadlineAt
  -> submitAttempt() + gradeAttempt() automatically
  -> Attempt becomes graded
  -> Candidate refreshes / reopens browser
  -> ResultPage shows graded result
```

## 6. Current Behavior

`heartbeat.ts` scanner only calls `markDisrupted()`. It never calls `submitAttempt()` or grading. There is no deadline scanner.

## 7. Target Behavior

- A new deadline scanner runs at a configurable interval.
- For each `in_progress` attempt where `now >= deadlineAt`:
  - Call `submitAttempt()` (idempotent).
  - Call `gradeAttempt()` (idempotent if already graded).
  - Record audit event `attempt.autoSubmit`.
- Scanner is idempotent: running twice on same attempt must not double-grade.
- Failed auto-submit is logged and retried on next scan.

## 8. Scope

This job may modify:

```txt
apps/api/src/plugins/heartbeat.ts (or new plugin)
apps/api/src/plugins/deadlineScanner.ts (new file)
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/grading.ts
packages/exam-engine/src/attemptCommands.test.ts
packages/exam-engine/src/grading.test.ts
apps/api/src/routes/attempts.test.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Frontend behavior
Exam state machine (open/close)
Restore behavior
Heartbeat timeout logic (disrupted detection)
```

## 10. Dependencies

```txt
Depends on: P2A-J1 (atomic start ensures we do not auto-submit duplicates)
Blocks: P2A-J6, P2C-J2
Can run in parallel with: P2A-J4, P2A-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | — | — |
| domain / engine | `packages/exam-engine/src/grading.ts` | Ensure `gradeAttempt` is idempotent if already graded |
| api routes | `apps/api/src/plugins/*` | New deadline scanner plugin or extension to heartbeat plugin |
| db / repository | — | — |
| frontend | — | — |
| e2e | `apps/e2e/e2e/*` | Browser crash at deadline scenario (P2A-J6) |
| docs | — | — |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | No new public API; scanner is internal |
| Request Schema | N/A |
| Response Schema | N/A |
| OpenAPI | N/A |
| Domain Command | `submitAttempt` + `gradeAttempt` called by scanner |
| Repository | `attemptRepo.listInProgress` filtered by deadlineAt |
| DB Tables | exam_attempts, exam_enrollments |
| Transaction | YES — submit and grade each attempt in a transaction |
| Locking | YES — `findByIdForUpdate` during submit/grade |
| Audit | `attempt.autoSubmit` new action |
| Tests | Unit tests for scanner logic; integration tests for auto-submit + grade |

## 13. API / Contract Changes

No new API. Internal scanner behavior only.

## 14. Error Contract

No new public errors.

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[ ] Enrollment
[ ] Answer
[x] Grading
[ ] Result Visibility
```

### Current Transition

```txt
in_progress -> disrupted (by heartbeat scanner only)
```

### Target Transition

```txt
in_progress -> submitted -> graded (by deadline scanner when now >= deadlineAt)
in_progress -> disrupted (by heartbeat scanner when heartbeat timeout)
```

### Disrupted + Expired Policy (P2-PLAN-J1 Review Fix)

```txt
in_progress + expired → auto-submit + grade (scanner)
disrupted + expired → auto-submit + grade (scanner)
submitted / grading / graded + expired → idempotent skip (return current result)
voided + expired → skip (no auto-submit)
```

Rationale: disrupted attempts have already lost connectivity. If their deadline has passed, leaving them in `disrupted` indefinitely means the score is never computed. Auto-submitting disrupted+expired attempts ensures the candidate's saved answers are graded.

### Rejected Transitions

```txt
[x] Cannot auto-submit already submitted/graded attempt (idempotent skip)
[x] Cannot auto-submit voided attempt
```

### Authority

```txt
[x] enforced in backend domain / exam-engine
[x] enforced in API route (scanner plugin)
[x] enforced in DB constraint / transaction / lock
[ ] frontend only displays state, not authoritative
```

### State Persistence

```txt
[x] persisted in DB column
[ ] derived from timestamp / query
[ ] stored in JSON snapshot
[x] audit-only event (attempt.autoSubmit)
```

### State Machine Tests

```txt
[x] transition unit tests
[x] rejected transition tests
[x] route-level state tests
[x] concurrency tests if applicable
[x] E2E abnormal path if user-visible
```

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: submitAttempt + gradeAttempt (existing)
Input: attemptId, now
Output: graded ExamAttempt
Allowed states: in_progress AND disrupted (both explicitly auto-submitted by deadline scanner)
Rejected states: submitted (idempotent skip), graded (idempotent skip), voided
Side effects: updates attempt status, gradingResult, enrollment finalScore
```

### Repository Layer

```txt
Repo method: attemptRepo.listInProgressByDeadline(ctx, beforeNow)
DB tables: exam_attempts
Columns read: id, deadlineAt, status
Columns written: status, submittedAt, gradingResult, score, passed, gradedAt
Transaction: YES
Lock: YES — findByIdForUpdate inside submit/grade
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
[x] idempotency needed? yes
```

Explain: Each auto-submit/grade must be idempotent. Use status check inside transaction to skip already-graded attempts.

## 18. Concurrency / Idempotency / Race Cases

```txt
[x] duplicate request (scanner runs twice)
[ ] retry after network failure
[ ] stale client state
[ ] submit while save is pending
[x] deadline while save is pending
[ ] force-submit while candidate submits
[ ] extend-time while deadline scanner runs
[ ] grading retry
[x] scanner double-run
```

### Expected Behavior

| Race Case | Expected Result | Test Required |
|---|---|---|
| duplicate start | only one active attempt | yes (from P2A-J1) |
| save after submit | rejected | yes |
| submit twice | idempotent | yes |
| deadline scanner twice | no double grading | yes |

## 19. Frontend UX States

N/A — no frontend change.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked (system context for scanner)
[x] organization boundary checked
[x] candidate ownership checked (by attempt ownership)
[x] audit event recorded (attempt.autoSubmit)
[x] sensitive metadata excluded
[x] permission boundary unchanged unless explicitly part of the job
```

## 21. Seed Impact

```txt
[ ] no seed change
[x] demo seed update (need expired / near-expiry attempt for testing)
[ ] e2e seed update
[ ] test factory only
```

## 22. Tests

| Type | Required Test |
|---|---|
| unit | Scanner logic: selects only expired in_progress attempts |
| integration | Auto-submit + grade end-to-end |
| repository / transaction | List in progress by deadline |
| api route | N/A (no route) |
| contract / OpenAPI | N/A |
| frontend component | N/A |
| e2e | Browser crash at deadline (P2A-J6) |
| regression | Ensure existing submit/grade still works |

## 23. Acceptance Criteria

```txt
[x] Given in_progress attempt with deadlineAt < now, scanner runs, attempt becomes graded.
[x] Given submitted attempt, scanner is idempotent and does not re-grade.
[x] Given disrupted attempt past deadline, scanner behavior is deterministic (submit or leave disrupted per policy).
[x] Audit event recorded for auto-submit.
[ ] Expired disrupted attempts are auto-submitted and graded.
[ ] Submitted / graded attempts are skipped idempotently.
[ ] Voided attempts are not auto-submitted.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Scanner may compete with candidate's own submit if they submit exactly at deadline.
- Risk 2: Scanner may impact DB performance if many attempts expire simultaneously.

## 25. Rollback / Compatibility

- Rollback strategy: disable scanner plugin or revert interval.
- Backward compatibility: N/A — new behavior.
- Data compatibility: Safe for existing in_progress attempts (will be auto-submitted on first scan).

## 26. PR Boundaries

Limited to deadline scanner and auto-submit logic only.

## 27. Review Guardrails

Must not weaken backend state-machine checks, change E2E expectations to hide bugs, or introduce Redis/MQ.

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
1. Modified files: heartbeat/deadline scanner plugin, attemptCommands, grading, tests
2. Behavior changed: server now auto-submits expired attempts
3. Behavior explicitly not changed: heartbeat disrupted detection, frontend, exam state machine
4. API / contract changes: none (no new public API)
5. State-machine changes: in_progress -> submitted -> graded now possible via scanner
6. DB / migration changes: none
7. Tests added/updated: scanner unit tests, auto-submit integration tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: monitor scanner performance under load
```
