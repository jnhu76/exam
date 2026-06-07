# Job ID: J01
# Branch: feat/ui-foundation
# Status: done
# Owner: agent
# Last Updated: 2026-06-07

## Goal

Establish the visual foundation: finalize design tokens in CSS, configure the system font stack, set up icon defaults, and create any missing base components (EmptyState, ErrorState).

## Scope

- Update `apps/web/src/index.css` `@theme` block:
  - Finalize color tokens (primary, success, warning, all semantic colors)
  - Ensure foreground is near-black, not pure black
  - Add missing tokens: success, warning
- Add explicit `font-family` declaration with Chinese-friendly system stack
- Verify lucide-react icon defaults (size, color, stroke-width)
- Create `EmptyState` component if missing
- Create `ErrorState` component if missing
- Verify all existing shadcn components render correctly with new tokens
- Run full build to verify no breakage

## Non-goals

- Do not modify layout components (AppSidebar, AdminLayout, etc.)
- Do not modify page components
- Do not add new shadcn components
- Do not change business logic

## Files to Read First

- `docs/ui/02-design-tokens.md`
- `docs/ui/03-tech-stack.md`
- `apps/web/src/index.css`
- `apps/web/components.json`

## Files Allowed to Modify

- `apps/web/src/index.css`
- `apps/web/src/lib/utils.ts` (if needed for cn() adjustments)
- `apps/web/src/components/shared/EmptyState.tsx` (create if missing)
- `apps/web/src/components/shared/ErrorState.tsx` (create if missing)

## Files Forbidden to Modify

- `apps/web/src/components/ui/*` (shadcn generated, use CLI to update if needed)
- `apps/web/src/components/layout/*`
- `apps/web/src/pages/*`
- `apps/api/*`
- `packages/*`

## Implementation Steps

1. Read `docs/ui/02-design-tokens.md` for target token values
2. Update `@theme` block in `index.css`:
   - Adjust primary color (intentional, not default shadcn blue)
   - Set foreground to near-black (~oklch 0.20)
   - Add `--color-success` token
   - Add `--color-warning` token
3. Add `font-family` to `body` or `html` rule
4. Check if EmptyState component exists; create if not
5. Check if ErrorState component exists; create if not
6. Run dev server and visually verify:
   - All pages render without breakage
   - Color changes are visible
   - Font renders correctly for Chinese text
7. Run `pnpm verify`

## Acceptance Criteria

- [x] Color tokens updated per `02-design-tokens.md`
- [x] Success and warning tokens added
- [x] Font stack declared with Chinese-friendly system fonts
- [x] EmptyState component exists and renders
- [x] ErrorState component exists and renders
- [x] All existing tests pass
- [x] `pnpm verify` passes
- [x] No visual regressions (existing pages still functional)

## Verification Commands

```bash
pnpm --filter web build
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Verification Results

- `pnpm verify` passes (format:check, lint, lint:copy, lint:arch, typecheck, test, coverage, build)
- 186 web tests pass, 361+ total tests pass
- Build succeeds (51.90 kB CSS, 572.37 kB JS)
- Token changes:
  - Primary: `oklch(0.6432 0.2045 264.6062)` → `oklch(0.5 0.16 255)` (darker, muted blue)
  - Foreground: `oklch(0.1455 0 0)` → `oklch(0.2 0 0)` (softened near-black)
  - Added: `--color-success: oklch(0.62 0.17 150)`
  - Added: `--color-warning: oklch(0.78 0.14 75)`
  - Font stack: system fonts with PingFang SC, Microsoft YaHei, Noto Sans SC

## Modified Files

- `apps/web/src/index.css` — tokens + font stack
- `docs/ui/02-design-tokens.md` — finalized oklch values
- `docs/ui/jobs/J01-ui-foundation.md` — status update

## Risks

- Changing primary color may affect many existing components — verify all shadcn components still look correct
- Font stack changes may affect layout dimensions — check spacing

## Notes

The exact oklch values for primary/success/warning should be finalized here. Document the chosen values in `02-design-tokens.md`.
