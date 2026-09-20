# 03 — Structural effects

Letters only, mapping-neutral. Everything below is a legitimate consequence of the candidate TagBadge rendering (the experiment directly changes ONLY CSS `font-weight`); none of it is contamination, and none of it was compensated. Source data: `validity/geometry.json`, `validity/structural.json`.

## Badge and text geometry (18 governed badges per arm, per viewport)

| Measure | questions@1440×900 | questions@1100×800 |
| --- | --- | --- |
| Badges with identical bounding width | 16/18 | 16/18 |
| Width deltas | idx8 +2px, idx11 +1px (Y vs X) | idx8 +2px, idx11 +1px (Y vs X) |
| Which badges move | the two Latin-tag instances (`safety`, `equipment`) | same instances, same deltas |
| CJK badge widths | identical X/Y | identical X/Y |
| Text-rect width deltas | idx8 33→35, idx11 59→60 (X→Y) | same |

Interpretation: the weight affects Latin glyph advance widths by 1–2px on the affected tags; CJK glyph advances are metrically identical at the two weights, so Chinese tag widths do not move. The deltas are byte-stable across viewports (deterministic rendering, no reflow feedback).

## Cluster, row and table structure

| Measure | X | Y |
| --- | --- | --- |
| Cluster line count | 1440: all single-line (22px); 1100: 22px single-line + 48px two-line on the same wrapped rows | identical |
| Row heights | 1440: 48px uniform; 1100: 48px + 49px (two-line clusters) | identical |
| Header row height | identical X/Y | identical |
| Wrapped / clipped headers | 0 / 0 | 0 / 0 |
| Document horizontal overflow | none | none |
| Table scroll state (`data-overflowing`) | identical X/Y | identical |
| Action column reachable | yes, unchanged | yes, unchanged |
| Visible rows / rendered badges / chips | 8 / 18 / 3 | 8 / 18 / 3 |

No extra cluster wrap, no row growth, no column-pressure change is attributable to either arm: the ≤2px badge-width movement is absorbed inside the fixed-layout tag cells without reflow consequences at either viewport. The 1100 wrapped clusters and 49px rows occur on the same rows in both arms (dense 3-badge clusters at the narrower cell width) and are baseline table behavior, not a D6 effect.

## `+N` overflow chip (NOT a TagBadge — untouched)

| Measure | X | Y |
| --- | --- | --- |
| Chip texts | `+1`, `+2`, `+3` | `+1`, `+2`, `+3` |
| Chip widths | identical X/Y (delta 0) | identical X/Y (delta 0) |
| Adjacent-badge gap shifts | — | ≤1px (causal geometry from the wider Latin neighbours) |
| Computed typography | 12px / 400 / 18px line-height / 6px padding / 3px radius / product color — held absolutely in both arms | same |

The ≤1px chip position shift is caused by the neighbouring Latin badge width change and is recorded as causal geometry; the chip itself never moved in any computed property.

## Responsive representation (1023 × 800)

`RESPONSIVE_REPRESENTATION_CHANGE`, `TAGBADGE_CONTINUES = NO`: below `lg` the page switches to the MobileRecordList card representation, and the card field mapping drops the tags column entirely (role `tag-list` resolves to priority `low`). No governed TagBadge renders there, so 1023 is excluded from D6 evidence (recorded per arm in `validity/structural.json` and `validity/geometry.json`).
