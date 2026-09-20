# 03 — Structural Effects

Mapping-neutral structural comparison of the two D4 arms. Letters only; no candidate values. Raw records: `validity/structural.json` (validity bundle). Header geometry was **recorded, never repaired**: any wrapping, clipping or column pressure caused by the header size is evidence.

## Per-surface pairwise results

Header row height is CSS-fixed per archetype (44px management/log rows, 42px workbench rows), so equality across arms is the expected product behavior; header *text* wrapping is measured separately via Range line boxes over the header text nodes.

| Pair | Header row height X / Y | Wrapped headers X / Y | Max header text lines X / Y | Clipped headers X / Y | Column alignment max Δ X / Y | Table overflow X / Y | Doc overflow X / Y |
| --- | --- | --- | --- | --- | --- | --- | --- |
| exam-list @1440×900 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| exam-list @1100×800 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| questions @1440×900 | 42 / 42 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | n/a / n/a¹ | false / false |
| questions @1100×800 | 42 / 42 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | n/a / n/a¹ | false / false |
| audit-logs @1440×900 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| audit-logs @1100×800 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| audit-logs @1023×800 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| users @1440×900 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |
| users @1100×800 | 44 / 44 | 0 / 0 | 1 / 1 | 0 / 0 | 0px / 0px | false / false | false / false |

¹ The questions workbench grid does not expose the scroll-region overflow attribute the management/log shells carry; its scroll geometry is still recorded per arm and is identical across arms.

## Pairwise summary

- **Row sets / row heights**: identical across arms on every pair (body typography is the frozen 15px baseline in both arms; first-5-row heights match exactly).
- **Header height**: constant across arms everywhere — the header band does not grow in either arm (CSS-fixed row heights; single-line headers in both).
- **Wrapping / clipping / ellipsis**: zero wrapped headers (max 1 Range line box per header cell), zero clipped headers, in both arms at every rendered surface/viewport. Neither candidate pushes Chinese headers onto a second line or into truncation on any captured surface.
- **Column alignment**: max |th.right − td.right| = 0px on every shared column index, both arms — header/body column edges stay locked (fixed table layout + border collapse).
- **Table width / last-cell reachability**: table container width and last-body-cell right edge identical across arms (Δ = 0px); scroll-end reachable and action column reachable on every record with a scroll region.
- **Document horizontal overflow**: none in either arm at any viewport.

## Boundary viewport (1023×800)

- **audit-logs** keeps the governed table below `lg` (log-diagnostic archetype scrolls horizontally by design): captured as normal D4 evidence — same clean pairwise result as the primary viewports.
- **exam-list, questions, users** switch to the pure-CSS mobile card representation below `lg` (the desktop table subtree is `display:none`). These 6 surface/viewport/arm combinations are recorded as `RESPONSIVE_REPRESENTATION_CHANGE` in `validity/structural.json` and are excluded from the evidence set and contact sheets.

## Net structural reading

Both candidates are structurally safe on every captured surface: no new overflow, no wrapping, no clipping, no header growth, no column drift. The D4 decision therefore carries no structural constraint from this pack — it is a pure hierarchy/legibility/dominance judgement for the multimodal reviewer.
