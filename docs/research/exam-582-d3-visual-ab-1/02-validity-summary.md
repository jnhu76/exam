# 02 — Validity summary

Mapping-neutral. No X/Y numeric mapping appears in this file. EXAM-582-D3-VISUAL-AB-1, final valid run `d3-1789926694489`; all gates green; judge contact sheets pass visual acceptance.

## D3 semantic family

```text
included (D3_INCLUDED):
  standalone [data-slot="input"]
  standalone [data-slot="select-trigger"]
  standalone [data-slot="textarea"]
  standalone [data-slot="button"]
  [data-slot="alert-dialog-trigger"]   (unpublish trigger — buttonVariants consumer)
  [data-slot="alert-dialog-cancel"]    (confirm secondary — buttonVariants consumer)
  [data-slot="alert-dialog-action"]    (confirm primary/destructive — buttonVariants consumer)

excluded (D3_EXCLUDED, guarded):
  StatusBadge (frozen D5) · TagBadge (frozen D6) · generic Badge / role pill
  pagination pills · Dialog container · AlertDialog container
  SelectContent / SelectItem overlays · tables/shells · Sheet (no instance)
  checkbox/radio/switch (no instance) · toast/tooltip (no instance)

contextual radius exceptions (invariant in both arms):
  COMPOSITE_INTERNAL_SEAM (quiet-toolbar joined filters → 0px):
    as-built ABSENT — no component renders [data-slot="toolbar-filters"];
    the seam rules in control/recipes.css are dead CSS. Preservation rule
    kept in both arms; oracle proves absence per capture.
  PAGINATION exclusion (→ as-built 8px pinned in both arms):
    absent from all evidence surfaces (fixtures below the page size).
```

## As-built split verified (§2)

Clean product, no injection, 1440×900, browser computed styles:

```text
Input:         6px   ✓   (control/recipes.css 0.375rem)
SelectTrigger: 6px   ✓   (control/recipes.css 0.375rem)
Textarea:      6px   ✓   (control/recipes.css 0.375rem)
Button:        8px   ✓   (button.tsx rounded-lg)
```

Zero mismatches across 61 inventory rows (26 D3_INCLUDED) on all five routes — no `AUTHORITY_MISMATCH`. Full inventory: `validity/as-built-radius-inventory.json`.

## Upstream frozen baselines

```text
D2 baseline:           PASS — 15px body/control in BOTH arms (injected common block, byte-identical; sidebar + table-cell absolutes re-verified per capture)
D4 baseline:           PASS — 13px/20px/500 table header in BOTH arms (as-built, re-verified per capture)
D5 non-contamination:  PASS — StatusBadge 22px identical across arms (users table + exam detail)
D6 non-contamination:  PASS — TagBadge weight 500 in BOTH arms (injected common block), as-built TagBadge radius unchanged across arms
```

## Single-variable radius convergence (§17)

```text
Input:         converged — every found instance equals its arm's candidate (both arms)
SelectTrigger: converged — every found instance equals its arm's candidate (both arms)
Textarea:      converged — every found instance equals its arm's candidate (both arms)
Button:        converged — every found instance equals its arm's candidate, incl. the three alert-dialog slot-named buttons (both arms)
```

50 pairwise family diffs: `border-radius` is the ONLY controlled property that moves between arms; every arm's radius equals its own candidate. 20 distinct family targets covered across wizard, dialogs, confirm, footers, header actions, stepper and quiet-toolbar samples. Style guards: `d3SingleVariablePass = true`.

## Quiet-toolbar seam (§18)

```text
X: selectors match nothing (0 rendered elements)
Y: selectors match nothing (0 rendered elements)
```

First-class gate `PASS`: 18 seam selector pairs, absent in both arms everywhere; the invariant preservation rule (0px) was active in both arms had anything matched. Joined appearance/border geometry: not applicable (no joined group exists as-built). The quiet-toolbar standalone samples (search input, filter select) converged as ordinary family members. `composite-seam-proof.json`.

## State invariants (§16)

12/12 state pairs pass — the product state treatment is present and identical in both arms; only `border-radius` differs:

```text
focus-state invariants:    PASS — keyboard :focus-visible + product focus ring present on wizard title Input, course-dialog name Input, users-dialog role SelectTrigger (both arms, both viewports)
disabled-state invariants: PASS — natural product-disabled future stepper buttons (vs enabled sibling) and mechanically disabled dialog save Button: disabled palette expressed identically in both arms
invalid-state invariants:  PASS — product aria-invalid border/ring expressed on the course-dialog name Input against the resting reference (both arms, both viewports)
```

## Non-contamination guards (§19)

```text
badge non-contamination:   PASS — generic role Badge identical across arms
overlay non-contamination: PASS — SelectContent + SelectItem identical across arms (probed open in the users dialog)
dialog non-contamination:  PASS — dialog-content / alert-dialog-content radius and shadow identical across arms (D7 owns them)
pagination exclusion:      PASS — pinned in both arms; absent from all surfaces
cross-variable contamination: NONE — zero non-family computed-property movement across 117 pairwise diffs
```

## Geometry (§20)

```text
geometry: PASS — 95 pairwise bounding-box pairs, Δx = Δy = Δwidth = Δheight = 0 in every pair (radius cannot change layout, and did not)
```

## Bring-up discipline (§27)

Eight invalidated bring-up runs are recorded with root causes in `00-environment.md` (fixture validation, fixed-element oracle visibility, two Slot slot-name discoveries, autofocus resting-reference defect, transition-timing race, below-fold crop clamp). None was packaged; the final valid run is the sole evidence source.
