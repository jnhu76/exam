# Job ID: J03
# Branch: feat/ui-dashboard-candidates
# Status: done
# Owner: agent
# Last Updated: 2026-06-07

## Goal

Refactor the Dashboard and Candidate Management pages as the visual reference for all admin pages. These two pages set the style pattern that J04 will follow.

## Scope

### Dashboard (`/admin/dashboard`)

- StatsCard components: consistent size, icon, number (`text-3xl font-bold`), label
- 4 cards in a row (grid `grid-cols-4`)
- Recent exams table: use shadcn Table, proper header style, status badges
- Loading state: Skeleton placeholders

### Candidate Management (`/admin/candidates`)

- PageHeader: title + [添加考生] [导入] buttons
- Filter bar: search input
- Table: dynamic columns from CandidateField, consistent header/footer
- Import dialog (ImportWizard): verify tokens applied
- Empty state, loading state, error state
- Pagination

### Shared patterns established here

- PageHeader layout (title + description + actions)
- Table styling (header bg, row hover, cell padding)
- StatsCard layout
- Badge styles (status colors)
- Empty/Error/Loading states

## Non-goals

- Do not modify exam, question, or score pages
- Do not change API contracts or business logic
- Do not add new features to dashboard

## Files to Read First

- `docs/ui/04-layout-navigation.md`
- `docs/ui/02-design-tokens.md`
- `apps/web/src/pages/admin/DashboardPage.tsx` (or equivalent)
- `apps/web/src/pages/admin/CandidatesPage.tsx`
- `apps/web/src/components/shared/StatsCard.tsx`
- `apps/web/src/components/shared/ImportWizard.tsx`

## Files Allowed to Modify

- `apps/web/src/pages/admin/CandidatesPage.tsx`
- Dashboard page component
- `apps/web/src/components/shared/StatsCard.tsx`
- `apps/web/src/components/shared/ImportWizard.tsx`
- `apps/web/src/components/shared/EmptyState.tsx`
- `apps/web/src/components/shared/ErrorState.tsx`
- Any shared component that both pages use

## Files Forbidden to Modify

- `apps/web/src/components/layout/*` (done in J02)
- `apps/web/src/components/ui/*` (shadcn generated)
- Other page components (exam, question, etc.)
- `apps/api/*`
- `packages/*`

## Implementation Steps

1. Refactor Dashboard page:
   - StatsCard grid with proper spacing
   - Table with status badges
   - Skeleton loading
2. Refactor Candidates page:
   - PageHeader with action buttons
   - Table with dynamic columns
   - Search filter
   - Pagination
3. Verify ImportWizard tokens are correct
4. Verify EmptyState and ErrorState render correctly
5. Establish shared patterns: document in this job file what patterns were set
6. Run `pnpm verify`

## Acceptance Criteria

- [x] Dashboard has 4 stat cards with consistent styling
- [x] Dashboard has recent exams table with proper styling
- [x] Candidates page has PageHeader + action buttons
- [x] Candidates table has consistent column styling
- [x] ImportWizard uses correct tokens
- [x] All three states (loading/empty/error) work on both pages
- [x] Shared patterns documented for J04 reference
- [x] All existing tests pass
- [x] `pnpm verify` passes

## Shared Patterns (for J04 reference)

1. **StatsCard**: Use `shadow-sm`, optional `icon` in `bg-primary/10` circle
2. **StatusBadge**: Use semantic colors via custom `className` props (`bg-success/10 text-success`, `bg-primary/10 text-primary`)
3. **Table**: Wrap in `Card` with `CardHeader`/`CardTitle` for sections, use `CardContent` for the table
4. **Filter bar**: Search input with icon prefix (`Search` icon, `pl-9` padding)
5. **ImportWizard**: Use `text-destructive`, `text-warning`, `text-success` instead of hardcoded colors
6. **EmptyState**: Use `Search` icon + descriptive message when filter returns no results
7. **PageHeader**: Already uses `text-2xl font-semibold` title + right-aligned `actions`

## Modified Files

- `apps/web/src/components/shared/StatsCard.tsx` — added optional `icon` prop, `shadow-sm`, horizontal layout
- `apps/web/src/pages/admin/DashboardPage.tsx` — icons on stats cards, StatusBadge component, table wrapped in Card
- `apps/web/src/pages/admin/CandidatesPage.tsx` — search filter, hardcoded colors → semantic tokens
- `apps/web/src/components/shared/ImportWizard.tsx` — hardcoded colors → semantic tokens
- `docs/ui/jobs/J03-dashboard-candidates.md` — status update

## Verification Commands

```bash
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Risks

- StatsCard may not have all required data from API — mock if needed
- Candidate table dynamic columns may need API support verification

## Notes

This page pair is the visual template. Before starting J04, verify these two pages look correct and consistent. J04 will follow the same patterns.
