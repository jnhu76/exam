# EXAM-582 · D6 blind A/B — judge bundle

You are the blind multimodal adjudicator for **D6** (issue #582). Everything you
need is in this `judge/` directory. Do **not** open `../validity/` before
deciding — it holds the experiment's answer key.

```text
DECISION UNDER TEST:
  TagBadge font weight ONLY
  (the 12px metadata tag chips in the Question Management table)

FROZEN (identical in both arms):
  body/control text baseline = 15px
    (the frozen upstream D2 decision, established experimentally and
     verified per capture — judge the tags RELATIVE TO THIS 15px BODY)
  table-header typography = 13px / 20px / 500
    (the frozen upstream D4 decision, as-built and re-verified per capture)
  status badge = 22px tall (the frozen upstream D5 decision, as-built)
  tag geometry = 22px height / 12px size / 6px inline padding /
    3px radius in this table / fixed colors — unchanged
  the "+N" overflow chip after the tags — unchanged (it is NOT a tag chip)
  font = HarmonyOS Sans SC (production loading path)
  same build, seed, filtered row set, tag arrays, tag order, user, browser,
  DPR=1, zoom 100%, light theme; column widths, cell padding, row CSS and
  table layout are the product's, unchanged
```

## Product

Chinese-language exam/LMS/admin UI; Question Management is a dense workbench
table where each question row shows metadata tags as small chip elements.

## Surface (as a blind X | Y pair)

| Surface | Route | Evidence |
| --- | --- | --- |
| Question Management, dense table | /admin/questions | primary |

The table is filtered to a deterministic 8-row evidence set with a
representative tag vocabulary: short Chinese tags (安全, 设备, 电气, 应急,
基础), medium Chinese tags (消防安全, 设备维护, 安全培训, 应急处置), and
Latin tags (safety, equipment, PPE). Rows carry 1, 2, 3, 4, 5 and 6 tags, so
the "+N" overflow chip appears on the densest rows.

Below the `lg` breakpoint this surface switches to a card representation that
does not render the tag column at all; that boundary was therefore excluded
from this decision and appears nowhere in the bundle.

## Viewports

- 1440 × 900 — primary adjudication
- 1100 × 800 — density-sensitive repeat

## Evidence

- `macro-contact-sheet.png` — scaled overview of full-viewport pairs
  (orientation only)
- `micro-contact-sheet.png` — **native-pixel** band crops: header band +
  evidence rows (so every crop keeps the 13px header / 15px body / 12px tag
  hierarchy), then tight "body text | tag cluster | adjacent column" bands;
  **authoritative** for glyph-edge judgement
- `micro/<pair>-pair.png` — per-pair native-pixel sheets: short-cjk,
  medium-cjk, cluster-3, cluster-overflow, dense-rows (use these if the
  combined sheet is too small to inspect comfortably)
- `macro/questions-<X|Y>-<viewport>.png` — raw full-viewport captures
- `micro/questions-[-tight-]<pair>-<X|Y>-<viewport>.png` — raw native crops

## Evaluate

- Chinese glyph edge clarity at 12px inside the tags
- small-text legibility of the tag chips
- tag/body hierarchy (do the chips sit correctly under the 15px body and
  13px header, or do they compete with / dissolve into them?)
- tag cluster density and rhythm inside a row
- visual noise across rows (repeated tags over 8 dense rows — do the chips
  start dominating the question content?)
- cross-row consistency
- structural effects (extra cluster wrapping, +N chip position shifts,
  row-height changes — any of these may legitimately differ and are evidence,
  not defects)

## Return

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY:
  glyph clarity:
  legibility:
  hierarchy:
  density:
  visual noise:
  cross-row consistency:
  structural effects:
RISKS:
PAGES / CROPS WHERE DIFFERENCE MATTERED:
```

"Framework defaults" and "looks cleaner" are not arguments. The two variants
of each pair differ in exactly one property; anything else you notice is
identical by construction. Do not try to infer numeric values or which
variant is "heavier" — report what you see, letter by letter.
