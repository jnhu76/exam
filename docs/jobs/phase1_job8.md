# Job 8: Score Management + CSV Export

## Goal

Build score query API, admin score management page with filtering/pagination, attempt detail page for teacher review, and CSV export for score sheets.

## Scope

- Score query API with pagination, sorting, filtering
- Admin score management page with dynamic headers from CandidateField
- Attempt detail page (teacher view)
- CSV export for score sheets (headers from CandidateField)
- Export audit logging

## Out of Scope

- PDF export (Phase 2)
- Word export (Phase 2)
- Complex statistics reports (Phase 2)
- Async large file job runner (Phase 2)
- Score curve / analytics (Phase 2)

## Dependencies

J7 (Auto-Grading — needs graded attempts with scores)

## Files to Create / Modify

- `apps/api/src/routes/scores.ts` (extend)
- `apps/api/src/routes/export.ts`
- `packages/import-export/src/csv.ts` (extend for export)
- `packages/contracts/src/score.ts` (extend if needed)
- `apps/web/src/pages/admin/ScoreListPage.tsx`
- `apps/web/src/pages/admin/AttemptDetailPage.tsx`

## Data Model Changes

None (uses existing exam_attempts/exam_enrollments data from J1).

## API Contracts

Uses `@exam/contracts` schemas:

- Score list query with pagination/filtering
- Attempt detail with grading results
- Export request/response

## UI Tasks

- Score management page with filter bar + stats row (§3.19)
- Attempt detail page (teacher view) (§3.12)

## TDD Plan

- Integration: score query with pagination and pass/fail filter
- Integration: CSV export with dynamic CandidateField headers
- Unit: CSV escaping for commas, quotes, newlines
- Integration: export audit log entry created
- Integration: cross-tenant isolation in score queries

## Subtasks

- [ ] **8.1** Score query API
  - Acceptance: GET /api/exams/:id/scores returns paginated score list with sorting and filtering by pass/fail status; GET /api/attempts/:id returns full attempt detail including all answers and grading results; all queries scoped by organizationId for multi-tenant isolation
  - Files: `apps/api/src/routes/scores.ts`
  - Verify: curl query score list with pagination; curl filter by pass/fail; curl get attempt detail with full answers; confirm cross-tenant isolation

- [ ] **8.2** Client: score management page
  - Acceptance: Export button (CSV only for Phase 1); filter bar with all/pass/fail tabs + search input; score table with headers dynamically generated from CandidateField + score + pass status + submit time + actions column; bottom stats row showing average/max/min/pass rate; click "详情" navigates to attempt detail page; all user-facing strings in zh-CN
  - Files: `apps/web/src/pages/admin/ScoreListPage.tsx`
  - Verify: browser view scores; test filter all/pass/fail; test search; test pagination; confirm dynamic headers from CandidateField; test "详情" navigation; confirm stats row calculates correctly

- [ ] **8.3** Client: attempt detail page (teacher view)
  - Acceptance: Top section shows score summary (candidate name + exam name + score + pass status + submit time); answer detail table (question number/type/candidate answer/correct answer/score); multi-select partial correct shows deduction explanation; "返回成绩列表" button; route /admin/attempts/:id; no PDF export button
  - Files: `apps/web/src/pages/admin/AttemptDetailPage.tsx`
  - Verify: click "详情" from score list; view complete attempt with all answers; confirm multi-select partial scoring displayed correctly; confirm "返回成绩列表" navigation works

- [ ] **8.4** Server: CSV export (score sheet only)
  - Acceptance: GET /api/exams/:id/export/scores?format=csv exports score sheet with headers dynamically generated from CandidateField; proper CSV escaping for fields containing commas/quotes; Content-Disposition header for download; all data scoped by organizationId; export operation logged to AuditLog; only Admin/Teacher can export
  - Files: `apps/api/src/routes/export.ts`, `packages/import-export/src/csv.ts`
  - Verify: curl download CSV score sheet; confirm headers match CandidateField; confirm proper CSV escaping; confirm cross-tenant data isolation; confirm audit log entry; confirm non-admin gets 403

## Acceptance Criteria

1. CSV export produces valid CSV with CandidateField dynamic headers
2. CSV properly escapes commas, quotes, and newlines
3. Export operation creates AuditLog entry
4. Only Admin/Teacher can export (403 for others)
5. Score query supports pagination + pass/fail filter
6. Score table headers generated from CandidateField config
7. Stats row shows correct average/max/min/pass rate
8. Attempt detail shows complete answer review
9. No PDF/Word export in Phase 1
10. All routes use repository pattern with RequestContext
11. `pnpm typecheck` passes

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

- [ ] CSV headers dynamically generated from CandidateField
- [ ] CSV escaping handles edge cases (commas, quotes, newlines, UTF-8)
- [ ] Export logged to audit_logs
- [ ] Only Admin/Teacher role can export
- [ ] No PDF/Word export code in Phase 1
- [ ] Score stats calculate correctly
- [ ] Attempt detail route /admin/attempts/:id
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
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
