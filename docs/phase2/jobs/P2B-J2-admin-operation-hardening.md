# P2B-J2 — Admin Operation Hardening

> **ADR-005 Slice 1 (Close Baseline): DONE** — `POST /api/exams/:id/close` implemented
> with lock→reconcile→unresolved-guard→assert→mutate→audit (wrapped in
> `executeInTransaction`). Scores/export also reject while unresolved attempts
> remain. Admin UI close button added (ConfirmDialog). Review-fixed: tx atomicity,
> audit `activeAttemptCount`, ADR spelling aligned to `UNRESOLVED_ATTEMPTS_EXIST`.
>
> **ADR-005 Slice 2 (Unpublish / Extend / PATCH-clarify): DONE** —
> `POST /exams/:id/unpublish` (stale-guarded published→draft),
> `POST /exams/:id/extend {extendMinutes}` (stale-guarded open→open, closeAt+),
> PATCH clarified (draft=full, published=openAt/closeAt only,
> `EXAM_UPDATE_NOT_ALLOWED`). All three follow lock→reconcile→guard→mutate→audit
> in one transaction. Admin UI buttons added (unpublish ConfirmDialog, extend
> Dialog with minutes input). New error codes + audit events.
>
> **ADR-005 Slice 3 (Timing Policy): DONE** — `latestStartOffsetMinutes`
> (late-entry cutoff on NEW start only) + `minSubmitAfterStartMinutes`
> (candidate manual submit only, source-gated; deadline_scanner bypasses).
> `SubmitSource` discriminator (candidate/deadline_scanner/proctor/system).
> submitAttempt guard ordering: idempotent-already-submitted FIRST, then
> early-submit. DB migration + domain/contracts + engine guards + route wiring
> + UI form fields. New error codes ATTEMPT_LATE_ENTRY_CLOSED,
> ATTEMPT_SUBMIT_TOO_EARLY. 493 API tests pass.
>
> **Remaining**: P2B-J2d (cancel, deferred — needs voiding + cancellation
> marker decisions; amend ADR-005 first).
>
> **Tooling note**: scripts/rebuild-all.sh added — apps resolve @exam/* via
> built dist, so rebuild dist before running filtered tests.

## 1. Summary

Fix gaps in the admin operation loop: exam setup validation, assignment reliability, publish/open/close/archive semantics, and score overview navigation.

## 2. Job Classification

```txt
[ ] docs-only planning job
[ ] OpenAPI / contract job
[x] backend state-machine job
[x] backend API / route job
[ ] DB / repository / transaction job
[x] frontend UI job
[ ] E2E / regression job
[ ] infra ADR job
```

## 3. Problem / Gap

- Current behavior: Admin CRUD works but the full loop has gaps identified in P2B-J1.
- Impact: Admin may encounter validation errors, missing transitions, or dead ends.
- Discovery source: P2B-J1 findings
- Why this must be fixed now: Required for real exam administration.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[x] 3. Admin can complete setup -> assignment -> publish -> result -> export
[x] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[ ] 6. Docs / OpenAPI / code / E2E are aligned
[x] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

```txt
Admin creates exam
  -> assigns candidates
  -> publishes exam
  -> exam opens automatically (P2A-J4)
  -> candidates take exam
  -> admin views scores from exam detail
  -> admin exports CSV
```

## 6. Current Behavior

- Exam creation works but publish->open->close lifecycle has no auto-transition.
- Enrollment add/remove works but no batch validation.
- Score overview exists but navigation from exam detail may have gaps.

## 7. Target Behavior

- Exam setup validation improved (question count, score alignment).
- Assignment flow reliable with validation.
- Publish/open/close/archive transitions aligned with state machine.
- Score overview accessible from exam detail page.

## 8. Scope

This job may modify:

```txt
apps/web/src/pages/ExamCreatePage.tsx
apps/web/src/pages/ExamDetailPage.tsx
apps/web/src/pages/ScoreListPage.tsx
apps/api/src/routes/exam.ts
packages/exam-engine/src/examCommands.ts
```

## 9. Non-Scope

This job must not modify:

```txt
Candidate runtime
Heartbeat behavior
Grading logic
```

## 10. Dependencies

```txt
Depends on: P2B-J1, P2A-J4
Blocks: P2C-J1, P2C-J5
Can run in parallel with: nothing
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
|---|---|---|
| domain / engine | examCommands.ts | Validation hardening |
| api routes | exam.ts | Assignment validation, status transitions |
| frontend | ExamCreatePage, ExamDetailPage, ScoreListPage | Navigation, validation messages |
| e2e | admin-flow.spec.ts | Updated to cover hardened flow |

## 12. Backend Contract Trace

| Layer | Required Content |
|---|---|
| Route | POST /api/exams/:id/publish, POST /api/exams/:id/archive, GET /api/exams/:id/scores |
| Request Schema | existing |
| Response Schema | existing |
| OpenAPI | already in P2.0-J1 |
| Domain Command | publishExam, archiveExam (existing) |
| Repository | examRepo.update, enrollmentRepo.* |
| DB Tables | exams, exam_enrollments |
| Transaction | No (single updates) |
| Locking | No |
| Audit | exam.publish, exam.archive, enrollment.add, enrollment.remove |
| Tests | Unit and route tests |

## 13. API / Contract Changes

No shape changes. Validation behavior may become stricter.

## 14. Error Contract

Existing errors preserved. Possible new validation errors with clear messages.

## 15. State Machine Contract

### State Entity

```txt
[x] Exam
[ ] Attempt
[ ] Enrollment
[ ] Answer
[ ] Grading
[ ] Result Visibility
```

### Target Transition

Same as P2A-J4: draft -> published -> open -> closed -> archived.

## 16. Command / Repository Boundary

### Domain / Command Layer

```txt
Command name: publishExam, archiveExam (existing)
Input: examRepo, examId, questions
Output: updated Exam
Allowed states: per state machine
Rejected states: per state machine
Side effects: updates exam.status, questionSnapshot
```

## 17. DB / Transaction / Locking Plan

All no.

## 18. Concurrency / Idempotency / Race Cases

N/A for admin operations.

## 19. Frontend UX States

loading, error, empty, disabled.

### Component Reuse

PageHeader, ConfirmDialog, ErrorState, LoadingState.

## 20. Audit / Security / RBAC

```txt
[x] RBAC checked
[x] organization boundary checked
[x] audit event recorded
[x] sensitive metadata excluded
[x] permission boundary unchanged unless explicitly part of the job
```

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
|---|---|
| unit | examCommands validation tests |
| integration | exam.test.ts, enrollment.test.ts |
| e2e | Admin full loop E2E |

## 23. Acceptance Criteria

```txt
[x] Admin can complete full setup -> assignment -> publish -> score -> export flow.
[x] Exam publish/open/close/archive transitions are correct and audited.
[x] Enrollment add/remove works reliably with validation.
[x] Score overview is accessible from exam detail.
[x] pnpm verify passes.
```

## 24. Regression Risks

- Risk 1: Stricter validation may break existing demo seed data.
- Risk 2: Navigation changes may affect existing admin workflows.

## 25. Rollback / Compatibility

- Rollback strategy: revert validation and navigation changes.

## 26. PR Boundaries

Limited to admin operation loop hardening.

## 27. Review Guardrails

Must not weaken state-machine checks or broaden permissions.

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
1. Modified files: exam.ts, examCommands.ts, frontend pages, tests
2. Behavior changed: admin operation loop hardened
3. Behavior explicitly not changed: candidate runtime, grading
4. API / contract changes: none
5. State-machine changes: none (transitions already exist)
6. DB / migration changes: none
7. Tests added/updated: validation and flow tests
8. Verification commands and results: pnpm verify passed
9. Remaining risks or follow-ups: none
```
