# 03 — Structural Effects

Mapping-neutral structural comparison of the two D5 arms. Letters only; no candidate value is bound to a letter. Raw records: `validity/structural.json` and `validity/geometry.json` (validity bundle). Row geometry was **recorded, never repaired**: any row growth caused by the badge height is D5 evidence.

## The headline result: dense-table geometry is unchanged

Body row height is **48px in BOTH arms on every pair** (11/11 pairs, first-badge row and first-5-row arrays identical). The two-candidate height difference is entirely absorbed by the row's existing vertical slack: neither candidate makes dense-table rows taller, so neither candidate increases table density or reduces visible row count (visible row counts identical across arms on every pair). This removes the §16 density guard as a constraint on the D5 decision — it is a pure rendering-quality judgement for the multimodal reviewer.

## Per-pair badge geometry (first visible badge, native px)

| Pair | Badge width Δ | Status cell width Δ | Row height X / Y | Center offset from row center X / Y | Top/bottom gap in row X / Y |
| --- | --- | --- | --- | --- | --- |
| exam-list @1440×900 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| exam-list @1100×800 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| grading-queue @1440×900 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| grading-queue @1100×800 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| recovery-queue @1440×900 | 0.0 | 0.0 | 48 / 48 | −1.2 / −1.7 | 10.8–13.3 / 11.3–14.8 |
| recovery-queue @1100×800 | 0.0 | 0.0 | 48 / 48 | −1.2 / −1.7 | 10.8–13.3 / 11.3–14.8 |
| recovery-queue @1023×800 | 0.0 | 0.0 | 48 / 48 | −1.2 / −1.7 | 10.8–13.3 / 11.3–14.8 |
| users @1440×900 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| users @1100×800 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| scores @1440×900 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |
| scores @1100×800 | 0.0 | 0.0 | 48 / 48 | 0 / 0.5 | 12–12 / 13.5–12.5 |

Reading of the geometry (all sub-pixel quantities are renderer rounding of the row's fixed 48px box against the two candidate heights):

- **Text-only surfaces**: one arm centers exactly in the row (offset 0, symmetric 12/12 gaps); the other rounds to a 0.5px offset (13.5/12.5 gaps). Both are far below any perceptual threshold and neither clips.
- **Recovery queue (icon-bearing badges, log-diagnostic archetype)**: badges sit ~1.2–1.7px above the exact row center in both arms — a property of that archetype's taller row padding, present in BOTH arms and therefore not a D5 variable effect. The gap asymmetry flips sign between the arms by the same ~2px the height variable contributes.
- **Icon/text balance**: on every icon-bearing badge, the icon box and the label text box share the same vertical center (icon/text center delta = **0px in both arms**, all recovery pairs; the text-only middle badge records no icon). The badge's internal `items-center` layout absorbs the height change without de-coupling icon and text.

## Overflow / clipping / collision sweep

- Badge clipped by cell: **none** (0 badges, both arms, all pairs).
- Header row heights identical across arms on every pair; zero wrapped headers (Range line-box detector), zero clipped headers — the D5 variable does not touch header geometry.
- Table scroll overflow state, scroll-end reachability, action-column reachability: identical across arms on every record with a scroll region.
- Document horizontal overflow: none in either arm at any viewport.
- Last-body-cell right edge: identical across arms (Δ = 0px).

## Boundary viewport (1023×800)

Only recovery-queue was attempted at 1023 (its `log-diagnostic` archetype keeps the governed table below `lg`); it rendered in both arms with identical 5-row sets and the same clean result as the primary viewports. The four `management-list` surfaces switch to the mobile-card representation below `lg` and were not attempted at the boundary (representation behavior already evidenced by the D4 pack).

## Net structural reading

Both candidates are structurally indistinguishable on every captured surface: no row growth, no new overflow, no clipping, no width drift, no header effect, no icon/text de-centering. The D5 decision therefore carries no structural constraint from this pack — breathing room, centering perception, row rhythm and semantic salience are pure judgements for the multimodal reviewer, to be made on the native-pixel micro evidence.
