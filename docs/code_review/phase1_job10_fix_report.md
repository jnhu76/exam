# Job 10 Fix Report

**Date:** 2026-06-01
**Review:** phase1_job10_review.md
**Status:** All fixes applied, pnpm verify passes

## Issues Found

### Issue 1: Missing `aria-label` on Trash2 ConfirmDialog trigger buttons

**Severity:** Accessibility bug
**4 instances found across 4 pages**

| File                                               | Line | Button Context      |
| -------------------------------------------------- | ---- | ------------------- |
| `apps/web/src/pages/admin/CoursePage.tsx`          | 170  | Delete course       |
| `apps/web/src/pages/admin/CandidateFieldsPage.tsx` | 234  | Delete field        |
| `apps/web/src/pages/admin/OrganizationsPage.tsx`   | 141  | Delete organization |
| `apps/web/src/pages/admin/QuestionPage.tsx`        | 281  | Delete question     |

**Pattern:** All 4 are icon-only `<Button variant="ghost" size="icon">` wrapped as `<ConfirmDialog trigger={...}>`. The trigger button lacks `aria-label`, making it inaccessible to screen readers.

**Fix:** Added `aria-label` to each:

- CoursePage: `aria-label="删除课程"`
- CandidateFieldsPage: `aria-label="删除字段"`
- OrganizationsPage: `aria-label="删除机构"`
- QuestionPage: `aria-label="删除题目"`

## Verification

- `pnpm format` — all files formatted
- `pnpm verify` — 8/8 tasks successful, exit code 0
- Web tests: 104 pass
- API tests: 96 pass
- Exam engine tests: 86 pass

## Files Modified

1. `apps/web/src/pages/admin/CoursePage.tsx` — added aria-label="删除课程"
2. `apps/web/src/pages/admin/CandidateFieldsPage.tsx` — added aria-label="删除字段"
3. `apps/web/src/pages/admin/OrganizationsPage.tsx` — added aria-label="删除机构"
4. `apps/web/src/pages/admin/QuestionPage.tsx` — added aria-label="删除题目"

## Test Coverage

No new tests needed — these are attribute additions to existing buttons. The consistency.test.tsx added in the original J10 commit covers the component-level accessibility rules (EmptyState aria-hidden, ErrorState role, LoadingState role, PageHeader font).
