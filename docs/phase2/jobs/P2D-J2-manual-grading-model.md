# P2D-J2 — Manual Grading Model

## 1. Summary

Define the domain model, contracts, and DB schema for manual grading of subjective questions with per-question score entry.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[x] backend state-machine job
[ ] backend API / route job
[x] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: All grading is auto. No model for manual scores on subjective questions.
- Impact: Questions without standardAnswer cannot be used in exams requiring manual grading.
- Discovery source: 06-phase2-gap-analysis.md P1-6
- Why this must be fixed now: Required for grading & result phase.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Candidate submits exam with subjective questions
  -> attempt status = submitted
  -> grading state = pending_manual
  -> grader sees question in grading queue
  -> grader enters score and comment
  -> all questions graded -> attempt status = graded
```

## 6. Current Behavior

No manual grading model. gradingResult is only auto-computed.

## 7. Target Behavior

- New model: `ManualGradingEntry` per question per attempt.
- Fields: questionId, score, maxScore, comment, gradedBy, gradedAt.
- Attempt has `gradingStatus`: auto_graded | pending_manual | fully_graded.
- Subjective questions (essay, etc.) flagged during exam creation.

## 8. Scope

This job may modify:

```txt
packages/domain/src/types.ts
packages/contracts/src/score.ts
packages/db/src/schema/pg.ts
packages/db/src/repository/attemptRepo.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Grading API (P2D-J3)
Grading UI (P2D-J4)
Auto-grading engine logic
```

## 10. Dependencies

```txt
Depends on: P2D-J1
Blocks: P2D-J3, P2D-J4
Can run in parallel with: P2D-J5
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | score.ts | ManualGradingEntry schema |
| domain / engine | types.ts | ManualGradingEntry interface |
| db / repository | schema/pg.ts, attemptRepo.ts | New table/columns |

## 12. Backend Contract Trace

N/A - model/schema job only.

## 13. API / Contract Changes

New contract schemas:
- `ManualGradingEntrySchema`
- `GradingStatusEnum`

## 14. Error Contract

N/A.

## 15. State Machine Contract

### State Entity

```txt
[x] Attempt
[ ] Exam
[ ] Enrollment
[ ] Answer
[x] Grading
[ ] Result Visibility
```

### Target Transition

```txt
submitted -> pending_manual -> fully_graded
```

## 16. Command / Repository Boundary

N/A - model design only.

## 17. DB / Transaction / Locking Plan

```txt
[x] migration needed? yes
[x] new table needed? yes (manual_grading_entries)
[ ] new column needed? no
[x] enum change needed? yes (gradingStatus on attempt)
[ ] transaction needed? no
[ ] row lock needed? no
[x] unique constraint needed? yes (attemptId + questionId unique)
[ ] idempotency needed? no
```

Migration backfill: `UPDATE exam_attempts SET gradingStatus = 'auto_graded' WHERE gradingStatus IS NULL;` (all existing attempts were auto-graded).

Unique constraint: `(attemptId, questionId)` on `manual_grading_entries` prevents duplicate grading entries for the same question within an attempt.

Migration backfill: existing auto-graded attempts get `gradingStatus = 'auto_graded'` (default). Only new submissions with subjective questions trigger `pending_manual`.

`gradedBy`: In Phase 2, this is always the Admin userId. No separate Grader role product path exists. The Grader role is a Phase 3+ scoped role bundle.

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
| unit | Schema validation tests |

## 23. Acceptance Criteria

```txt
[x] ManualGradingEntry model is defined in domain and contracts.
[x] DB migration creates manual_grading_entries table.
[x] GradingStatus enum is defined.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Migration may affect existing attempts.

## 25. Rollback / Compatibility

- Rollback strategy: reverse migration.

## 26. PR Boundaries

Limited to model and schema only.

## 27. Review Guardrails

Must not implement grading logic or UI in this PR.

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
1. Modified files: types.ts, score.ts, schema/pg.ts, attemptRepo.ts
2. Behavior changed: none (model only)
3. DB / migration changes: yes (manual_grading_entries table)
4. Tests added/updated: schema validation tests
5. Verification commands and results: pnpm verify passed
```
