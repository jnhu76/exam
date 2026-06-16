# P2D-J5 — Result Publishing Policy

## 1. Summary

Implement result publication policy modes: immediate, after-grading, and manual publish, controlling when candidates can see their results.

## 2. Job Classification

```txt
[ ] docs-only planning job
[x] OpenAPI / contract job
[x] backend state-machine job
[ ] backend API / route job
[x] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: showResultImmediate is a boolean per exam. No after-grading or manual publish modes.
- Impact: Admin cannot control result visibility timing.
- Discovery source: 04-state-machine-audit.md
- Why this must be fixed now: Required for result control and admin workflow.

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
Admin sets resultPublicationMode on exam
  -> candidate submits exam
  -> if mode=immediate: result visible immediately
  -> if mode=after_grading: result visible when fully graded
  -> if mode=manual: admin must click "publish results"
  -> candidate sees result based on mode
```

## 6. Current Behavior

showResultImmediate boolean controls visibility. No manual publish.

## 7. Target Behavior

- Replace `showResultImmediate` with `resultPublicationMode` enum: `immediate`, `after_grading`, `manual`.
- `GET /api/scores/attempts/:id` checks mode and attempt status before returning full result.
- Admin can publish results manually via `POST /api/admin/exams/:id/publish-results`.
- Backward compatibility: existing exams default to `immediate`.

## 8. Scope

This job may modify:

```txt
packages/contracts/src/exam.ts
packages/domain/src/types.ts
packages/db/src/schema/pg.ts
apps/api/src/routes/scores.ts
apps/api/src/routes/exam.ts
apps/web/src/pages/ResultPage.tsx
apps/web/src/pages/ExamCreatePage.tsx
```

## 9. Non-Scope

This job must not modify:

```txt
Grading engine
Proctor dashboard
```

## 10. Dependencies

```txt
Depends on: P2D-J1
Blocks: P2D-J6
Can run in parallel with: P2D-J2, P2D-J3, P2D-J4
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| contracts | exam.ts | resultPublicationMode enum |
| domain / engine | types.ts | ResultPublicationMode |
| db / repository | schema/pg.ts | Migration for mode field |
| api routes | scores.ts, exam.ts | Visibility check, publish endpoint |
| frontend | ResultPage.tsx, ExamCreatePage.tsx | Mode display and selection |
| e2e | result-visibility.spec.ts | Mode tests |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | GET /api/scores/attempts/:id, POST /api/admin/exams/:id/publish-results |
| Request Schema | none for GET, empty body for POST |
| Response Schema | AttemptResultResponse (conditional on mode) |
| OpenAPI | Document in P2.0-J1 baseline |
| Domain Command | publishResults (new) |
| Repository | examRepo.update, attemptRepo.find |
| DB Tables | exams, exam_attempts |
| Transaction | No |
| Locking | No |
| Audit | exam.publish_results |
| Tests | Route and integration tests |

## 13. API / Contract Changes

| API | Request | Response | Error Shape | RBAC |
|---|---|---|---|---|
| GET /api/scores/attempts/:id | - | conditional result | NOT_FOUND, FORBIDDEN | Candidate/Admin |
| POST /api/admin/exams/:id/publish-results | - | `{ ok: true }` | NOT_FOUND, FORBIDDEN | Admin |

## 14. Error Contract

| Case | HTTP Status | Error Code | Frontend Handling |
|---|---:|---|---|
| results not yet published | 200 | status-only response | "results not yet published" message |

## 15. State Machine Contract

### State Entity

```txt
[ ] Attempt
[ ] Exam
[ ] Enrollment
[ ] Answer
[ ] Grading
[x] Result Visibility
```

### Current Transition

```txt
showResultImmediately = true  -> result visible immediately after grading
showResultImmediately = false -> result never visible (or manually toggled)
```

### Target Transition

```txt
resultPublicationMode = immediate   -> result visible immediately after grading
resultPublicationMode = after_grading -> result visible when attempt gradingStatus = fully_graded
resultPublicationMode = manual      -> result hidden until admin calls publish-results
```

### Migration Backfill

```sql
ALTER TABLE exams ADD COLUMN resultPublicationMode TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE exams ADD COLUMN resultsPublishedAt TIMESTAMPTZ;

UPDATE exams
SET resultPublicationMode = CASE WHEN "showResultImmediately" THEN 'immediate' ELSE 'manual' END;
```

Result visibility is a state (hidden → visible) governed by the publication mode and attempt grading status.

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: publishResults
Input: examRepo, examId
Output: updated Exam
Allowed states: any published+ exam
Side effects: sets resultsPublishedAt
```

## 17. DB / Transaction / Locking Plan

```txt
[x] migration needed? yes
[ ] new table needed? no
[x] new column needed? yes (resultPublicationMode, resultsPublishedAt)
[x] enum change needed? yes (resultPublicationMode: immediate | after_grading | manual)
[ ] transaction needed? no
[ ] row lock needed? no
[ ] unique constraint needed? no
[ ] idempotency needed? no
```

Migration backfill SQL:
```sql
ALTER TABLE exams ADD COLUMN resultPublicationMode TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE exams ADD COLUMN resultsPublishedAt TIMESTAMPTZ;
UPDATE exams SET resultPublicationMode = CASE WHEN "showResultImmediately" THEN 'immediate' ELSE 'manual' END;
```

## 18. Concurrency / Idempotency / Race Cases

- Publish results twice: idempotent (resultsPublishedAt already set).

## 19. Frontend UX States

loading, error, empty, status-only result, full result.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked
[x] organization boundary checked
[x] audit event recorded (exam.publish_results)
```

## 21. Seed Impact

```txt
[ ] no seed change
[x] demo seed update (add resultPublicationMode)
```

## 22. Tests

| Type | Required Test |
|---|---|
| integration | Result visibility per mode |
| e2e | Candidate sees result only after publish |

## 23. Acceptance Criteria

```txt
[x] Immediate mode shows results right after grading.
[x] After-grading mode shows results when fully graded.
[x] Manual mode hides results until admin publishes.
[x] Admin can publish results for an exam.
[x] Result visibility is modeled as a state entity (hidden → visible).
[x] Migration backfill converts showResultImmediately to resultPublicationMode correctly.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Migration must preserve existing showResultImmediate behavior.

## 25. Rollback / Compatibility

- Rollback strategy: reverse migration.

## 26. PR Boundaries

Limited to result publishing policy only.

## 27. Review Guardrails

Must not break existing showResultImmediate behavior.

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
1. Modified files: scores.ts, exam.ts, contracts, schema, frontend, tests
2. Behavior changed: result visibility now controlled by publication mode
3. API / contract changes: new publish-results endpoint, conditional result response
4. DB / migration changes: yes (resultPublicationMode, resultsPublishedAt)
5. Tests added/updated: visibility mode tests
6. Verification commands and results: pnpm verify passed
```
