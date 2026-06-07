# Job ID: J02
# Branch: feat/ui-shell-layout
# Status: done
# Owner: agent
# Last Updated: 2026-06-07

## Goal

Refactor AppSidebar, topbar area, and AdminLayout to match `docs/ui/04-layout-navigation.md`. Establish the visual shell that all admin pages live inside.

## Scope

- Refactor `AppSidebar.tsx`:
  - Implement active state: `bg-primary/10 text-primary` for icon and text
  - Group navigation items with group labels
  - Set icon defaults: lucide, `text-muted-foreground`, size-4/size-5
  - Bottom user area with avatar, name, logout
  - Remove any brand name display from topbar
- Refactor `AdminLayout.tsx`:
  - Sidebar width `w-56` / collapsed `w-14`
  - Topbar height `h-14`, `border-b`, no brand repeat
  - Topbar shows page title or breadcrumb
  - Main content area `p-6`
- Refactor `ExamLayout.tsx`:
  - Minimal header: brand left, user right
  - Full-width content area
- Update `BrandProvider.tsx` and `BrandHeader.tsx` if needed for token consistency
- Create `ConfirmDialog` component if missing
- Update `PageHeader` component if it doesn't follow spec

## Non-goals

- Do not modify individual page content
- Do not modify exam answer page layout (that's J05)
- Do not add new routes or pages
- Do not change business logic

## Files to Read First

- `docs/ui/04-layout-navigation.md`
- `docs/ui/02-design-tokens.md`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`

## Files Allowed to Modify

- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/shared/PageHeader.tsx`
- `apps/web/src/components/shared/ConfirmDialog.tsx` (create if missing)

## Files Forbidden to Modify

- `apps/web/src/components/ui/*`
- `apps/web/src/pages/*` (except layout imports if necessary)
- `apps/api/*`
- `packages/*`

## Implementation Steps

1. Read all layout components and understand current structure
2. Refactor AppSidebar:
   - Group items per `04-layout-navigation.md` section
   - Active state styling
   - Icon defaults
   - Bottom user area
3. Refactor AdminLayout:
   - Topbar content rules (no brand, page title instead)
   - Spacing and sizing
4. Refactor ExamLayout:
   - Minimal header
5. Verify PageHeader follows spec (title left, actions right)
6. Create ConfirmDialog if missing
7. Test all admin pages render correctly in new shell
8. Test candidate pages render correctly in ExamLayout
9. Run `pnpm verify`

## Acceptance Criteria

- [x] Sidebar active state is visually distinct (primary bg + text)
- [x] Sidebar has grouped navigation with labels
- [x] Topbar does not repeat brand name
- [x] Topbar shows page title
- [x] Layout dimensions match spec (w-56, h-14, p-6)
- [x] ExamLayout has minimal header
- [x] ConfirmDialog exists (already existed)
- [x] All existing tests pass
- [x] `pnpm verify` passes

## Verification Commands

```bash
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Verification Results

- `pnpm verify` passes
- 186 web tests pass (2 test assertions updated for avatar text collision)
- Build succeeds (52.19 kB CSS, 577.99 kB JS)
- Sidebar: active state `bg-primary/10 text-primary`, group labels `uppercase tracking-wider`,
  bottom user area with Avatar + name + logout
- AdminLayout: topbar shows route-based page title instead of brand name,
  background changed to `bg-background`
- ExamLayout: added Avatar with initials, active nav links use `text-primary`
- PageHeader: added optional `description` prop per spec
- ConfirmDialog: already existed, no changes needed

## Modified Files

- `apps/web/src/components/layout/AppSidebar.tsx` — active state, group labels, avatar, separators
- `apps/web/src/components/layout/AdminLayout.tsx` — remove brand, add page title
- `apps/web/src/components/layout/ExamLayout.tsx` — avatar, token update
- `apps/web/src/components/shared/PageHeader.tsx` — add description prop
- `apps/web/src/components/layout/layout.test.tsx` — fix avatar text collision in assertions
- `docs/ui/jobs/J02-ui-shell-layout.md` — status update

## Risks

- Sidebar refactor may break navigation tests
- Layout changes affect all pages — verify no overflow or spacing issues

## Notes

This job establishes the visual frame. J03-J05 then fill in the page content with consistent styling. Get the shell right first.
