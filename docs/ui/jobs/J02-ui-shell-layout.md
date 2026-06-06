# Job ID: J02
# Branch: feat/ui-shell-layout
# Status: todo
# Owner:
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

- [ ] Sidebar active state is visually distinct (primary bg + text)
- [ ] Sidebar has grouped navigation with labels
- [ ] Topbar does not repeat brand name
- [ ] Topbar shows page title
- [ ] Layout dimensions match spec (w-56, h-14, p-6)
- [ ] ExamLayout has minimal header
- [ ] ConfirmDialog exists (if was missing)
- [ ] All existing tests pass
- [ ] `pnpm verify` passes

## Verification Commands

```bash
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Risks

- Sidebar refactor may break navigation tests
- Layout changes affect all pages — verify no overflow or spacing issues

## Notes

This job establishes the visual frame. J03-J05 then fill in the page content with consistent styling. Get the shell right first.
