# Job 10: UI Polish + Visual Consistency Pass

## Goal

Final visual polish and consistency pass across all Phase 1 pages. This job does not introduce new business features or change API contracts. It ensures all pages look and feel production-quality.

## Scope

- Visual consistency: spacing, typography, color usage across all pages
- Form polish: label alignment, input widths, validation message placement
- Empty/loading/error state cleanup across all pages
- Accessibility pass: focus management, ARIA labels, keyboard navigation, color + icon dual indicators
- Copy consistency: verify all user-facing strings are zh-CN and free of scenario-specific defaults
- Responsive baseline: pages usable at 1280px+ width
- Dark mode support verification (if Tailwind tokens support it)
- Animation polish: page transitions, loading skeletons, feedback animations
- Icon consistency: ensure icon usage is uniform across pages
- Button style consistency: primary/secondary/destructive variants used correctly
- Table style consistency: header alignment, row hover, pagination alignment
- Dialog style consistency: header/body/footer layout consistency

## Out of Scope

- No new business features
- No new API endpoints
- No new database schema changes
- No new pages (all pages must exist from J4-J9)
- No mobile-first redesign (responsive baseline only)
- No performance optimization (separate concern)
- No new shared UI components (should be in J3.5 or the job that needs them)

## Dependencies

J4, J5A, J5B, J6, J7, J8, J9 (all business jobs must be code-complete)

## Files to Modify

No new files. Only visual adjustments to existing pages and components:

- `apps/web/src/pages/**/*.tsx` — all page components
- `apps/web/src/components/**/*.tsx` — all shared components
- `apps/web/src/components/ui/**/*.tsx` — shadcn/ui overrides if needed
- `apps/web/src/index.css` — Tailwind token adjustments if needed

## Acceptance Criteria

1. All pages have consistent spacing (p-6 container, gap-4 between sections)
2. All forms have consistent label alignment and validation message placement
3. All tables have consistent header alignment, row hover, and pagination
4. All dialogs have consistent header/body/footer layout
5. All empty states use EmptyState component consistently
6. All loading states use LoadingState/Skeleton consistently
7. All error states use ErrorState component consistently
8. All status indicators use color + icon dual indicators (not color-only)
9. All user-facing strings verified as zh-CN with no scenario-specific defaults
10. Focus management works on all forms and dialogs
11. Keyboard navigation works on all interactive elements
12. Pages are usable at 1280px+ width without horizontal scroll
13. `pnpm lint:copy` passes (no deployment-specific copy)
14. `pnpm typecheck` passes
15. `pnpm verify` passes

## Review Checklist

- [ ] No new business logic introduced
- [ ] No new API endpoints added
- [ ] No new pages created
- [ ] Visual consistency across all admin pages
- [ ] Visual consistency across all candidate pages
- [ ] Accessibility: focus management, ARIA, keyboard nav
- [ ] All status indicators use color + icon
- [ ] No hardcoded deployment-specific product copy
- [ ] No `any` / `as any`
- [ ] `pnpm verify` passes
- [ ] No unnecessary new dependencies
