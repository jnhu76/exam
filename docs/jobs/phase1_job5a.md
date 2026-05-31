# Job 5A: Course + Question Bank

## Goal

Build course management and question bank with all 4 Phase 1 question types (single/multi choice, fill-blank, true/false), including question CRUD, question editor with live preview, and CSV question import.

## Scope

- Course CRUD API + management page
- Question CRUD API with type validation + management page
- Question create/edit page with live preview for all 4 types
- Question CSV import

## Out of Scope

- Exam creation / paper building (J5B)
- Random question selection (Phase 2)
- Essay / short_answer question types (Phase 2)
- Question versioning (Phase 2)

## Dependencies

J3 (Auth — middleware, routes), J4 (Organization, CandidateField — import template reuse)

## Files to Create / Modify

- `apps/api/src/routes/course.ts`
- `apps/web/src/pages/admin/CoursePage.tsx`
- `apps/api/src/routes/question.ts`
- `apps/web/src/pages/admin/QuestionPage.tsx`
- `apps/web/src/pages/admin/QuestionEditPage.tsx`
- `apps/web/src/components/question/QuestionForm.tsx`
- `apps/web/src/components/question/QuestionPreview.tsx`
- `apps/web/src/pages/admin/QuestionImportPage.tsx`
- `packages/contracts/src/question.ts` (extend if needed)

## Data Model Changes

None (uses existing courses/questions tables from J1).

## API Contracts

Uses `@exam/contracts` schemas (defined in J0.5):
- Course CRUD
- Question CRUD + import

## UI Tasks

- Course management page (§3.14)
- Question management page with filter bar (§3.3)
- Question create/edit page with 4 type forms + live preview (§3.4)
- Question import page (§3.5)

## TDD Plan

- Integration: course CRUD with organizationId isolation
- Integration: question CRUD with type-specific validation
- Integration: question import with valid/invalid/warning rows
- Unit: question type validation (single_choice must have 2+ options, etc.)

## Subtasks

- [ ] **5A.1** Course API + management page
  - Acceptance: Teacher/Admin can CRUD Course; courses isolated by organizationId; UI shows table (course name, code, question count, action buttons); delete blocked if course has questions
  - Files: `apps/api/src/routes/course.ts`, `apps/web/src/pages/admin/CoursePage.tsx`
  - Verify: curl full CRUD; browser create/edit/delete course; confirm cross-tenant isolation

- [ ] **5A.2** Question API + management page
  - Acceptance: API supports create/edit/delete/list questions; filter by courseId, tags, type, difficulty; validate question type fields; UI shows filter bar (course/type/difficulty/tags Select + search Input), table (checkbox, type badge, content truncated, tag chips, score), create/import buttons, pagination
  - Files: `apps/api/src/routes/question.ts`, `apps/web/src/pages/admin/QuestionPage.tsx`
  - Verify: curl create single_choice, multiple_choice, fill_blank, true_false questions; browser filter by type/course/difficulty; paginate results

- [ ] **5A.3** Question create/edit page (all 4 question types)
  - Acceptance: single/multi choice — inline option marking (click ○/●), no duplicate answer field at bottom; fill blank — use ____ in content, standard answer per blank with | for multiple accepted answers, match mode select; true/false — binary radio; bottom live preview area (candidate perspective); type switching dynamically replaces the options/answer area
  - Files: `apps/web/src/pages/admin/QuestionEditPage.tsx`, `apps/web/src/components/question/QuestionForm.tsx`, `apps/web/src/components/question/QuestionPreview.tsx`
  - Verify: create all 4 question types; preview area updates in real-time as form changes; switch type and confirm UI updates correctly

- [ ] **5A.4** Question import page
  - Acceptance: step 1 — drag-drop upload area + download template button; step 2 — preview table with status icons (✅ valid, ⚠️ warning, ❌ error), type, content summary, anomaly reason; bottom summary bar shows valid/warning/error counts; reuses ImportWizard component from J4
  - Files: `apps/web/src/pages/admin/QuestionImportPage.tsx`
  - Verify: download template, fill with valid + invalid rows, upload through import flow; confirm status icons and counts

## Acceptance Criteria

1. Course CRUD with tenant isolation works
2. Question CRUD for all 4 Phase 1 types works
3. Question type validation enforces correct structure
4. Question editor has live preview for candidate perspective
5. Question import handles valid/invalid/warning rows
6. All routes use repository pattern with RequestContext
7. All routes use Zod validation from `@exam/contracts`
8. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm typecheck
pnpm test
pnpm --filter api dev
pnpm --filter web dev
```

## Review Checklist

- [ ] Only Phase 1 question types: single_choice, multiple_choice, fill_blank, true_false
- [ ] Question type uses enum from `@exam/domain`
- [ ] standardAnswer is required for auto-grading
- [ ] Course delete blocked when questions exist
- [ ] Import reuses ImportWizard from J4
- [ ] All user-facing strings in zh-CN
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
