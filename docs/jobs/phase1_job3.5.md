# Job 3.5: UI Foundation Backfill

## Goal

Establish the shared UI foundation after Job 3 and before business pages expand in J4-J9.

This job exists because Job 3 has already been completed. It must backfill missing UI foundation without reopening Job 3 or rewriting completed auth code.

## Scope

- Shared layout components
- Shared page shell
- Shared loading / empty / error states
- Sidebar navigation shell
- Brand header shell
- shadcn/ui baseline usage
- Tailwind token cleanup
- Route-level layout consistency
- Basic role-aware navigation structure
- Generic shared confirmation dialog
- Generic page header component

## Out of Scope

- No new business API
- No new database schema
- No auth logic changes
- No login behavior changes unless a critical SPEC violation is found
- No dashboard charts
- No exam-taking logic
- No question-bank logic
- No result/score logic
- No final visual polish
- No animation polish
- No mobile-first redesign

## Dependencies

J3

## Files to Create / Modify

- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/shared/PageHeader.tsx`
- `apps/web/src/components/shared/EmptyState.tsx`
- `apps/web/src/components/shared/ErrorState.tsx`
- `apps/web/src/components/shared/LoadingState.tsx`
- `apps/web/src/components/shared/ConfirmDialog.tsx`
- `apps/web/src/lib/cn.ts`
- `apps/web/src/lib/routes.ts`

Adjust the file list if some files already exist.

## Acceptance Criteria

1. Admin routes can use `AdminLayout`.
2. Candidate exam routes can use `ExamLayout`.
3. Sidebar navigation is role-aware but may use placeholder route items.
4. Product title comes from a branding fallback object, not hardcoded page strings.
5. Shared components use shadcn/ui + Tailwind tokens.
6. Loading, empty, and error states exist and can be reused by J4-J9.
7. No deployment-specific hardcoded copy is introduced.
8. No business logic is implemented in this job.
9. Login behavior from J3 is not changed except for non-behavioral layout integration if necessary.
10. `pnpm lint:copy` passes.
11. `pnpm typecheck` passes.
12. `pnpm verify` passes.

## Review Checklist

- [ ] No hardcoded product title except allowed fallback.
- [ ] No scenario-specific default copy in production components.
- [ ] No direct API calls in layout components.
- [ ] No duplicate route definitions scattered across pages.
- [ ] No unnecessary dependencies.
- [ ] Shared components are generic and reusable.
- [ ] J3 auth behavior remains unchanged.
- [ ] J4-J9 can build pages on top of this foundation.
