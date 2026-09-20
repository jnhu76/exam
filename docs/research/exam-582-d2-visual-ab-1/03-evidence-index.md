# 03 — Evidence Index

All paths relative to `docs/research/exam-582-d2-visual-ab-1/`. 16 macro captures (PNG, full viewport, DPR=1) + 10 micro crops (native pixels, unscaled) + 2 contact sheets + machine records.

## Judge-facing (safe for the multimodal adjudicator)

| Artifact | Content |
| --- | --- |
| `artifacts/D2/macro-contact-sheet.png` | Blind overview: every surface pair X\|Y at 1440×900 (+1100×800 section), scaled for layout. **Scaled — do not judge glyph detail from it.** |
| `artifacts/D2/micro-contact-sheet.png` | Blind native-pixel pairs (M1–M4), unscaled 1:1 from the framebuffer. **Authoritative for glyph-level judgement.** |
| `artifacts/D2/macro/*.png` | 16 raw full-viewport captures: `<surface>-<X\|Y>-<viewport>.png` |
| `artifacts/D2/micro/*.png` | 10 raw native crops: `m1-table`, `m2-form`, `m3-sidebar`, `m3-heading`, `m4-runtime` × X/Y |

Both sheets label pairs only as **Variant X / Variant Y**. The X↔px assignment exists solely in `artifacts/variant-map.json`; the adjudicator must not be shown that file, `D2/style-proof.json`, or `progress.log`.

## Validity-only (for the audit trail, mapping-revealing or geometry-only)

| Artifact | Content |
| --- | --- |
| `artifacts/variant-map.json` | The blind assignment (crypto coin-flip provenance). |
| `artifacts/D2/style-proof.json` | Per-capture computed styles, 36 cross-arm pair diffs, tier/D4/controlled/font-gate verdicts. Records px per letter. |
| `artifacts/D2/structural.json` | Document/table overflow state, row heights, last-cell reachability, known-pill overflow deltas. |
| `artifacts/font-gate.json` | 24 per-capture font gates (HarmonyOS stack + 400/500 faces). |
| `artifacts/run-manifest.json` | Run id, surfaces, viewports, injection method (no px values). |
| `artifacts/progress.log` | Harness progress lines (letters only). |

## Capture matrix (24 contexts)

| Surface | 1440×900 | 1100×800 | Micro (1440) |
| --- | --- | --- | --- |
| dashboard | X, Y | — | m3-sidebar, m3-heading |
| exam-list | X, Y | X, Y | — |
| questions | X, Y | X, Y | m1-table |
| settings | X, Y | — | m2-form |
| dialog | X, Y | — | — |
| take | X, Y | — | m4-runtime |
| pill probe (users, audit-logs) | measurement only | measurement only | — |

Raw run directory: `.tmp/ui-patrol/d2-ab/d2-1789870791254/`.
