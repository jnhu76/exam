# Job ID: J06
# Branch: chore/ui-local-build-qa
# Status: todo
# Owner:
# Last Updated: 2026-06-07

## Goal

Final QA pass: verify local-first compliance, static build correctness, font rendering, icon bundling, accessibility basics, and overall visual consistency across all pages.

## Scope

### Build Verification

- `pnpm --filter web build` succeeds without errors
- `dist/` contains no external references:
  - No `fonts.googleapis.com`
  - No CDN URLs
  - No external image references
- `vite preview` serves correctly
- Bundle size is reasonable (no unexpected large chunks)

### Font Verification

- Chinese text renders correctly with system font stack
- No fallback to generic serif/sans-serif
- Check on at least: macOS, Windows, Linux (if available)

### Icon Verification

- All icons are from lucide-react (no other icon libraries)
- Icons render at correct size
- Icons use correct default color (muted-foreground)
- No broken icon references

### Accessibility Spot Check

- Tab through every page type (admin + candidate)
- Verify focus ring visible on all interactive elements
- Verify dialog focus trap works
- Verify form labels associated with inputs
- Verify color is not the only status indicator
- Verify Chinese text readability

### Visual Consistency

- Every page uses PageHeader
- Tables have consistent styling
- Cards have consistent padding and radius
- Buttons use correct variants
- Status badges use semantic colors
- Empty/loading/error states present on all list pages

### Readability Check

- No pure black (`#000`) for body text
- No heavy shadows
- No decorative animations
- Spacing follows Tailwind scale consistently

## Non-goals

- Do not add new features
- Do not refactor code for code quality alone
- Do not change business logic

## Files to Read First

- `docs/ui/07-local-first-static-build.md`
- `docs/ui/08-accessibility-readability.md`
- `docs/ui/02-design-tokens.md`

## Files Allowed to Modify

- `docs/ui/jobs/*.md` (status updates, notes)
- Minor CSS fixes in `apps/web/src/index.css` if needed
- Minor component fixes if accessibility issues found

## Files Forbidden to Modify

- Business logic in any file
- API code
- Database schema or repositories

## Implementation Steps

1. Run build and check output
2. Grep dist/ for external references
3. Start preview server and check all pages
4. Tab through every page type
5. Check font rendering
6. Check icon rendering
7. Document all findings
8. Fix any issues found (only within allowed scope)
9. Update all job status files
10. Run final `pnpm verify`

## Acceptance Criteria

- [ ] Build succeeds, no external references in dist/
- [ ] Preview server serves all pages correctly
- [ ] Chinese text renders with system fonts
- [ ] All icons from lucide, no broken references
- [ ] Tab navigation works on all pages
- [ ] Focus rings visible
- [ ] Dialog focus trap works
- [ ] Color + icon used for status (not color alone)
- [ ] No pure black body text
- [ ] All job status files updated
- [ ] `pnpm verify` passes

## Verification Commands

```bash
pnpm --filter web build
pnpm --filter web preview  # manual check
grep -r "fonts.googleapis" apps/web/dist/  # must return nothing
grep -r "cdn" apps/web/dist/               # must return nothing
pnpm verify
```

## Risks

- Some accessibility issues may require code changes beyond CSS — escalate if found
- Font rendering differs across OS — may not catch all issues

## Notes

This is the final QA gate. All J01-J05 must be merged before starting J06. If issues are found, create fix branches and merge before finalizing.
