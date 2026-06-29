# Job ID: J04
# Branch: feat/ui-core-admin-pages
# Status: done
# Owner: agent
# Last Updated: 2026-06-07

## Goal

Apply the visual patterns from J03 to all remaining admin pages. Each page gets PageHeader, proper table/form styling, and correct state handling.

## Scope

Pages to refactor (in order):

1. Exam Management (`/admin/exams`)
2. Exam Create/Edit (`/admin/exams/new`, `/admin/exams/:id/edit`)
3. Exam Detail (`/admin/exams/:id`)
4. Question Management (`/admin/questions`)
5. Question Create/Edit (`/admin/questions/new`, `/admin/questions/:id/edit`)
6. Question Import (`/admin/questions/import`)
7. Score Management (`/admin/exams/:id/scores`)
8. User Management (`/admin/users`)
9. Organization Management (`/admin/organizations`)
10. Platform Settings (`/admin/settings`)
11. Candidate Fields (`/admin/candidate-fields`)
12. System Health (`/admin/system`)

For each page:
- PageHeader with title + actions
- Tables: consistent header, row hover, cell padding (following J03 pattern)
- Forms: proper label + input spacing, error message styling
- Status badges: pass/fail/pending/active/inactive
- Loading/empty/error states
- No hardcoded scenario-specific text

## Non-goals

- Do not modify candidate-facing pages (that's J05)
- Do not modify layout components (done in J02)
- Do not change API contracts or business logic
- Do not add new pages or routes

## Files to Read First

- `docs/ui/04-layout-navigation.md`
- `docs/ui/02-design-tokens.md`
- J03 job file (for established patterns)
- Each page component before modifying

## Files Allowed to Modify

- `apps/web/src/pages/admin/ExamPage.tsx` (or equivalent)
- `apps/web/src/pages/admin/ExamCreatePage.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.tsx`
- `apps/web/src/pages/admin/QuestionPage.tsx` (or equivalent)
- `apps/web/src/pages/admin/SettingsPage.tsx`
- `apps/web/src/pages/admin/CandidateFieldsPage.tsx`
- `apps/web/src/pages/admin/CoursePage.tsx`
- `apps/web/src/pages/admin/OrganizationsPage.tsx`
- `apps/web/src/pages/admin/UsersPage.tsx`
- `apps/web/src/pages/admin/SystemPage.tsx`
- `apps/web/src/components/question/*`
- `apps/web/src/components/exam/ExamConfigForm.tsx`
- `apps/web/src/components/settings/*`
- Any shared component used by these pages

## Files Forbidden to Modify

- `apps/web/src/components/layout/*`
- `apps/web/src/components/ui/*`
- Candidate-facing pages
- `apps/api/*`
- `packages/*`

## Implementation Steps

1. Read J03 patterns (PageHeader, table, badge, state handling)
2. Refactor pages in order listed above
3. For each page:
   - Apply PageHeader
   - Style tables/forms
   - Add status badges
   - Verify all three states
   - Verify no hardcoded strings
4. After all pages: run full test suite
5. Run `pnpm verify`

## Acceptance Criteria

- [x] All 12 admin page groups refactored
- [x] Every page has PageHeader with title + actions
- [x] Tables follow J03 pattern
- [x] Forms have consistent spacing and error display
- [x] Status badges use semantic colors
- [x] All three states handled on list pages
- [x] No hardcoded scenario-specific text
- [x] All existing tests pass
- [x] `pnpm verify` passes

## Changes Applied

| Page | Changes |
|------|---------|
| SystemHealthPage | `text-green-600`/`text-yellow-600`/`text-red-600` → `text-success`/`text-warning`/`text-destructive`; removed icon-based status display; `shadow-sm` on MetricCard |
| QuestionImportPage | `text-green-500`/`text-yellow-500`/`text-red-500` → `text-success`/`text-warning`/`text-destructive` for status icons |
| ScoreListPage | Pass/fail badges use `bg-success/10 text-success` / `bg-destructive/10 text-destructive`; `shadow-sm` on all Cards |
| ExamDetailPage | `shadow-sm` on all Cards (stat cards, config card, stats grid, enrollments card) |

Pages with no changes needed (already followed patterns): ExamPage, ExamCreatePage, QuestionPage, QuestionEditPage, UsersPage, OrganizationsPage, SettingsPage, CandidateFieldsPage, CoursePage

## Verification Commands

```bash
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Risks

- Largest scope job — may need to split into sub-branches if too large
- Form pages (exam create, question create) are complex with many fields
- Some pages may have limited test coverage

## Notes

If this job is too large for a single branch, split by page group:
- J04a: Exam pages (management, create, detail)
- J04b: Question pages (management, create, import)
- J04c: Settings & admin pages (score, user, org, settings, fields, system)
