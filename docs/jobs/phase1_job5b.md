# Job 5B: Exam Management + Manual Paper Builder

## Goal

Build exam creation with manual question selection, exam configuration (timing, control flags, retake policy), exam publish workflow, exam detail page, and exam list page.

## Scope

- Exam CRUD API + create page (组卷)
- Manual question selection from question bank
- Exam configuration: timing, control flags, retake policy, score strategy
- Exam publish workflow (draft → published → open → closed → archived)
- Exam detail page (teacher view) + exam list page
- Exam command functions: `publishExam()`, `openExam()`, `closeExam()`, `archiveExam()`

## Out of Scope

- Random question selection (Phase 2)
- Exam taking flow (J6)
- Auto-grading (J7)
- Score management (J8)
- timed_sync / deadline / untimed timing modes (Phase 2)
- daily_limit / weekly_limit retake policies (Phase 2)

## Dependencies

J5A (Question Bank — need questions to select from)

## Files to Create / Modify

- `apps/api/src/routes/exam.ts`
- `packages/exam-engine/src/examCommands.ts`
- `packages/contracts/src/exam.ts` (extend if needed)
- `apps/web/src/pages/admin/ExamCreatePage.tsx`
- `apps/web/src/components/exam/ExamConfigForm.tsx`
- `apps/web/src/pages/admin/ExamPage.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.tsx`

## Data Model Changes

None (uses existing exams/exam_enrollments tables from J1).

## API Contracts

Uses `@exam/contracts` exam schemas (defined in J0.5):

- Exam CRUD
- Exam publish / archive
- Exam detail with stats

## UI Tasks

- Exam create page with manual question selection (§3.6)
- Exam detail page (§3.11)
- Exam list page (§3.11)

## TDD Plan

- Unit: exam state machine transitions (draft → published → open → closed → archived)
- Unit: publishExam() validates required fields (questions, timing, passing score)
- Integration: exam CRUD with organizationId isolation
- Integration: publish → verify status transition
- Integration: question snapshot captured at publish time

## Subtasks

- [ ] **5B.1** Exam command functions
  - Acceptance: `publishExam(ctx, examId)` validates required fields and transitions draft → published; `openExam(ctx, examId)` transitions published → open when time window starts; `closeExam(ctx, examId)` transitions open → closed when time window ends; `archiveExam(ctx, examId)` transitions closed → archived. Invalid transitions throw errors. No direct status mutation in routes.
  - Files: `packages/exam-engine/src/examCommands.ts`
  - Verify: unit test all valid transitions; unit test invalid transitions throw; unit test publish requires questions + timing + passingScore

- [ ] **5B.2** Exam API routes
  - Acceptance: POST /api/exams creates exam (draft); PUT /api/exams/:id updates draft exam; POST /api/exams/:id/publish calls publishExam(); POST /api/exams/:id/archive calls archiveExam(); DELETE /api/exams/:id deletes draft exam only; all routes use repository pattern with RequestContext; all inputs validated with Zod schemas from `@exam/contracts`
  - Files: `apps/api/src/routes/exam.ts`
  - Verify: curl create → update → publish → archive flow; curl delete draft succeeds, delete published fails

- [ ] **5B.3** Client: exam create page (组卷)
  - Acceptance: UI sectioned form (basic info → exam settings → control settings → select questions → preview publish); control settings mode preset buttons auto-fill checkboxes, each independently editable; manual selection shows selected questions table + add from question bank dialog; random selection UI present but disabled, marked [Phase 2]; bottom fixed action bar: preview exam, save draft, publish exam; timing mode locked to timed_window in Phase 1
  - Files: `apps/web/src/pages/admin/ExamCreatePage.tsx`, `apps/web/src/components/exam/ExamConfigForm.tsx`
  - Verify: create exam via manual question selection; save draft; publish; confirm draft → published state transition

- [ ] **5B.4** Client: exam detail page + exam list page
  - Acceptance: list page shows exam table (name, status badge, time window, participant count, actions); detail page shows exam config summary + real-time stats + candidate list (identifier, name, status, score, actions); status shown as colored badges using ExamStatus enum
  - Files: `apps/web/src/pages/admin/ExamPage.tsx`, `apps/web/src/pages/admin/ExamDetailPage.tsx`
  - Verify: publish an exam from create page → appears in list with correct status badge → open detail page → see candidate list

## Acceptance Criteria

1. Exam state machine enforces valid transitions
2. publishExam() requires questions, timing config, and passingScore
3. Publishing captures immutable `QuestionSnapshot` data from the selected question IDs; J6 copies that frozen snapshot when an attempt is created
4. Manual question selection works from question bank
5. Exam configuration supports timed_window + control flags + retake policy
6. Exam list shows status badges correctly
7. Exam detail shows config + candidate list
8. All routes use repository pattern with RequestContext
9. All routes use Zod validation from `@exam/contracts`
10. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm lint:copy
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate && pnpm test:integration
pnpm --filter api dev
pnpm --filter web dev
pnpm verify
```

## Review Checklist

- [ ] Exam status enum matches SPEC.md §3.3: draft/published/open/closed/archived
- [ ] No direct status mutation in route handlers — all via command functions
- [ ] Question snapshot captured at publish time, including content, options, answer, score, grading rule, attachments, and order
- [ ] Timing mode locked to timed_window (Phase 1)
- [ ] Retake policy limited to unlimited/max_attempts/pass_then_stop (Phase 1)
- [ ] Random selection UI disabled with [Phase 2] label
- [ ] Control flags use ControlFlags type from `@exam/domain`
- [ ] Status badge colors consistent and accessible
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
- [ ] Exam state transitions use command functions, no direct status mutation
