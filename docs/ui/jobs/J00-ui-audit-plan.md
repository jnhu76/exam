# Job ID: J00
# Branch: chore/ui-audit-plan
# Status: todo
# Owner:
# Last Updated: 2026-06-07

## Goal

Audit the current UI implementation, verify the documentation in `docs/ui/01-current-ui-audit.md` against the actual codebase, and produce a detailed action plan for J01-J06.

## Scope

- Review all pages in `apps/web/src/pages/`
- Review all components in `apps/web/src/components/`
- Review `apps/web/src/index.css` theme tokens
- Take screenshots or describe current visual state of each page
- Identify gaps between current UI and `docs/ui/00-ui-principles.md`
- Update `docs/ui/01-current-ui-audit.md` with findings
- Update `docs/ui/05-component-inventory.md` with accurate exists/needs-refactor status
- Update `docs/ui/06-page-migration-plan.md` with accurate page status

## Non-goals

- Do not modify any UI code
- Do not modify any CSS or tokens
- Do not add or remove dependencies

## Files to Read First

- `docs/ui/00-ui-principles.md`
- `docs/ui/01-current-ui-audit.md`
- `docs/ui/05-component-inventory.md`
- `apps/web/src/index.css`

## Files Allowed to Modify

- `docs/ui/01-current-ui-audit.md`
- `docs/ui/05-component-inventory.md`
- `docs/ui/06-page-migration-plan.md`
- Any `docs/ui/jobs/*.md` file (status/notes updates only)

## Files Forbidden to Modify

- Any file in `apps/`, `packages/`, `scripts/`
- Any file not in `docs/ui/`

## Implementation Steps

1. Start dev server (`pnpm dev`)
2. Visit every admin page and every candidate page
3. For each page: record current visual state, component usage, UI problems
4. Verify each component in `05-component-inventory.md` — does it exist? what needs work?
5. Update audit doc with detailed findings
6. Update component inventory with accurate status
7. Update page migration plan with accurate current status
8. Write summary of top 10 UI problems ranked by severity

## Acceptance Criteria

- [ ] Every page has been visually reviewed and documented
- [ ] Component inventory has accurate exists/refactor status
- [ ] Page migration plan has accurate current status
- [ ] Top 10 UI problems are documented with severity
- [ ] No business code was modified

## Verification Commands

```bash
pnpm verify
git diff --stat  # Should show only docs/ui/ changes
```

## Risks

- Audit may be subjective — focus on measurable issues (contrast, spacing, consistency)

## Notes

This job can be done without running the dev server if the reviewer is comfortable reading component code. However, visual review is preferred.
