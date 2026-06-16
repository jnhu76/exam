# P2D-J1 — Objective Grading Stabilization

## 1. Summary

Keep current auto-grading behavior stable and well-tested; add regression tests to prevent degradation during Phase 2D changes.

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

- Current behavior: Auto-grading works but lacks comprehensive regression coverage for edge cases.
- Impact: Phase 2D changes may inadvertently break objective grading.
- Discovery source: 04-state-machine-audit.md
- Why this must be fixed now: Must establish baseline before adding manual grading.

## 4. Runtime Decision Gate Closed

```txt
[x] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate submits exam
  -> submitAttempt -> gradeAttempt -> finalizeGrading
  -> ResultPage shows score and question results
```

## 6. Current Behavior

Auto-grading handles single_choice, multiple_choice, true_false, fill_blank. Grading is synchronous on submit.

## 7. Target Behavior

- Comprehensive regression tests for all question types.
- Edge cases covered: empty answers, partial multi-select, case-insensitive fill_blank.
- Score strategy verified: highest, latest, first.
- Enrollment completion logic verified.

## 8. Scope

This job may modify:

```txt
packages/exam-engine/src/gradingEngine.test.ts
packages/exam-engine/src/grading.test.ts
apps/api/src/routes/attempts.test.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Grading engine logic (unless bug found)
Manual grading
Result publishing policy
```

## 10. Dependencies

```txt
Depends on: P2A-J6, P2C-J8
Blocks: P2D-J2, P2D-J3, P2D-J4, P2D-J5, P2D-J6
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| domain / engine | gradingEngine.test.ts, grading.test.ts | New regression tests |
| e2e | candidate-happy-path.spec.ts | Ensure still passes |

## 12. Backend Contract Trace

N/A - tests only.

## 13. API / Contract Changes

No API changes.

## 14. Error Contract

N/A.

## 15. State Machine Contract

N/A - no state machine change.

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
| unit | All question type edge cases |
| unit | Score strategy interactions |
| unit | Enrollment completion logic |
| integration | Submit -> grade -> result end-to-end |
| e2e | Happy path still passes |

## 23. Acceptance Criteria

```txt
[x] All objective question types have edge-case tests.
[x] Score strategies (highest/latest/first) are verified.
[x] Enrollment completion rules are tested.
[x] Existing E2E happy path passes.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: New tests may find existing bugs that require fixes.

## 25. Rollback / Compatibility

N/A - test-only job.

## 26. PR Boundaries

Tests and documentation only.

## 27. Review Guardrails

Must not change grading logic unless fixing a verified bug.

## 28. Verification Commands

```bash
pnpm test
pnpm verify
```

## 29. Final Report Requirements

```txt
1. Modified files: gradingEngine.test.ts, grading.test.ts, attempts.test.ts
2. Behavior changed: none
3. Tests added/updated: regression tests for objective grading
4. Verification commands and results: pnpm verify passed
```
