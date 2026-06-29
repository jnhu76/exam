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

J3.5 (UI Foundation — shared layout, page shell, empty/loading/error states), J7 (Auto-Grading — needs graded attempts with scores)

## J7 Baseline

J7 already provides `GET /api/scores/attempts/:attemptId` for Candidate/Admin/Teacher single-attempt result queries, including tenant isolation, role-aware result visibility, frozen question content, candidate answers, standard answers, and question-level grading results.

J8 must extend the score domain without duplicating this endpoint or its DTOs:

- Keep `GET /api/scores/attempts/:attemptId` as the canonical single-attempt detail endpoint.
- Reuse the J7 Zod schemas from `packages/contracts/src/score.ts`; extend them only when the teacher review page needs additional fields.
- Add score list, filtering, pagination, statistics, and CSV export endpoints for the management workflow.
- Build the Admin/Teacher pages that consume the existing single-attempt detail endpoint.

## Execution Nodes

Implement and verify J8 in this order:

1. **Node J8-A: contracts + score list API** — extend score contracts; add tenant-scoped paginated score list with pass/fail filtering, search, sorting, statistics, and CandidateField-driven columns.
2. **Node J8-B: attempt review API alignment** — verify the existing `GET /api/scores/attempts/:attemptId` response covers teacher review; extend the shared response schema only if required by the review UI.
3. **Node J8-C: score management UI** — implement `/admin/exams/:id/scores`, including filters, dynamic CandidateField columns, statistics, pagination, empty/loading/error states, and detail navigation.
4. **Node J8-D: attempt detail UI** — implement `/admin/attempts/:id` using the canonical J7 detail endpoint; include partial-credit explanation and return navigation.
5. **Node J8-E: CSV export** — implement dynamic headers, escaping, tenant isolation, authorization, download headers, and AuditLog recording.
6. **Node J8-F: end-to-end verification** — run migrations, integration tests, `pnpm verify`, and browser smoke checks for list → detail → return and export download.

## UI Strategy

This job must produce fully usable score management and attempt review pages. Every page listed under UI Tasks must be complete enough for a teacher to review scores and export data end-to-end. J10 will polish visual consistency; it will not build missing pages.

**Minimum UI per page:**

- Score management page with filter bar, dynamic headers from CandidateField, stats row
- Attempt detail page with score summary + answer review table
- CSV export button with download
- Empty state when no scores exist
- Loading state while fetching
- Error state on failure
- All user-facing text in zh-CN

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
  - Acceptance: GET /api/exams/:id/scores returns paginated score list with sorting, search, filtering by pass/fail status, statistics, and CandidateField-driven columns; reuse and extend the J7 canonical GET /api/scores/attempts/:attemptId endpoint for full attempt detail including all answers and grading results; all queries scoped by organizationId for multi-tenant isolation
  - Files: `apps/api/src/routes/scores.ts`, `packages/contracts/src/score.ts`
  - Verify: curl query score list with pagination; curl filter by pass/fail; curl search; curl get attempt detail with full answers; confirm cross-tenant isolation

- [ ] **8.2** Client: score management page
  - Acceptance: Export button (CSV only for Phase 1); filter bar with all/pass/fail tabs + search input; score table with headers dynamically generated from CandidateField + score + pass status + submit time + actions column; bottom stats row showing average/max/min/pass rate; click "详情" navigates to attempt detail page; all user-facing strings in zh-CN
  - Files: `apps/web/src/pages/admin/ScoreListPage.tsx`
  - Verify: browser view scores; test filter all/pass/fail; test search; test pagination; confirm dynamic headers from CandidateField; test "详情" navigation; confirm stats row calculates correctly

- [ ] **8.3** Client: attempt detail page (teacher view)
  - Acceptance: Top section shows score summary (candidate name + exam name + score + pass status + submit time); answer detail table (question number/type/candidate answer/correct answer/score); multi-select partial correct shows deduction explanation; "返回成绩列表" button; route /admin/attempts/:id; page loads from the canonical GET /api/scores/attempts/:attemptId endpoint; no PDF export button
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
