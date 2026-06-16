# P2A-J3 — Client Deadline Awareness

## 1. Summary

Update TakeExamPage to disable editing and show a final state when the server-side deadline has passed, preventing confusing UX where local edits appear successful but save fails.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: Server rejects saves after deadline, but client continues showing questions and allowing edits until save fails.
- Impact: User experience confusion - edits appear to succeed locally but fail on save.
- Discovery source: 06-phase2-gap-analysis.md P0-5, 01-frontend-inventory.md
- Why this must be fixed now: Without this, the candidate runtime feels broken at deadline.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[x] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate is in TakeExamPage
  -> Client checks deadlineAt against local timer
  -> Deadline passes
  -> UI disables all inputs, shows deadline overlay
  -> Auto-flushes any pending saves
  -> Navigates to ResultPage or shows final state
```

## 6. Current Behavior

TakeExamPage has ExamTimer that calls handleSubmit on timeout, but if the browser is not actively rendering, the timeout may fire late. The page does not proactively disable editing when the deadline passes.

## 7. Target Behavior

- TakeExamPage reads deadlineAt from LoadAttemptResponse.
- A recurring check compares Date.now() with deadlineAt.
- When now >= deadlineAt:
  - Disable all question inputs.
  - Show a non-dismissible overlay.
  - Flush pending saves via useSubmitFlush.flush().
  - Automatically call handleSubmit() if not already submitted.
- Save rejection alerts for DEADLINE_EXCEEDED remain as fallback.

## 8. Scope

This job may modify:

```txt
apps/web/src/pages/TakeExamPage.tsx
apps/web/src/hooks/useSubmitFlush.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Backend behavior
Save answer protocol
Submit endpoint
Grading logic
```

## 10. Dependencies

```txt
Depends on: P2A-J2
Blocks: P2A-J6
Can run in parallel with: P2A-J4, P2A-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| frontend | TakeExamPage.tsx, useSubmitFlush.ts | Deadline check, disable inputs, auto-submit overlay |
| e2e | apps/e2e/e2e/* | Deadline awareness test (P2A-J6) |

## 12. Backend Contract Trace

N/A - no backend API change.

## 13. API / Contract Changes

No API changes. Frontend consumes existing deadlineAt from LoadAttemptResponse.

## 14. Error Contract

No new errors. Frontend handles existing DEADLINE_EXCEEDED save rejection as fallback.

## 15. State Machine Contract

N/A.

## 16. Command / Repository Boundary

N/A.

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

- stale client state: client clock may drift from server clock
- submit while save is pending: flush before submit
- deadline while save is pending: server rejects, client shows fallback

## 19. Frontend UX States

loading, disabled, deadline passed, submitted.

### Component Reuse

ConfirmDialog, SaveIndicator, ErrorState.

## 20. Audit / Security / RBAC

N/A.

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| frontend component | Unit tests for deadline overlay and disabled state |
| e2e | Deadline awareness scenario (P2A-J6) |

## 23. Acceptance Criteria

```txt
[x] TakeExamPage disables inputs when deadline passes.
[x] Pending saves are flushed before auto-submit.
[x] Overlay is shown and is non-dismissible.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Timer logic may conflict with existing ExamTimer.
- Risk 2: Auto-submit overlay may interfere with disconnect detection.

## 25. Rollback / Compatibility

- Rollback strategy: revert frontend changes.
- Backward compatibility: 100% - no API change.

## 26. PR Boundaries

Limited to TakeExamPage deadline awareness only.

## 27. Review Guardrails

Must not weaken state-machine checks or mix with unrelated UI redesign.

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
1. Modified files: TakeExamPage.tsx, useSubmitFlush.ts
2. Behavior changed: client now disables editing at deadline
3. Behavior explicitly not changed: backend, save protocol, submit endpoint
4. API / contract changes: none
5. State-machine changes: none
6. DB / migration changes: none
7. Tests added/updated: frontend unit tests, E2E
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: none
```
