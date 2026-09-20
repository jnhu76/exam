# EXAM-582 · D5 blind A/B — judge bundle

You are the blind multimodal adjudicator for **D5** (issue #582). Everything you
need is in this `judge/` directory. Do **not** open `../validity/` before
deciding — it holds the experiment's answer key.

```text
DECISION UNDER TEST:
  StatusBadge physical height ONLY

FROZEN (identical in both arms):
  body/control text baseline = 15px
    (the frozen upstream D2 decision, established experimentally and
     verified per capture — judge the badge RELATIVE TO THIS 15px BODY)
  table-header typography = 13px / 20px / 500
    (the frozen upstream D4 decision, as-built and re-verified per capture)
  badge typography  = 12px / 500 weight / 16px line-height
  badge padding / gap / radius / border / colors / icon policy =
    the product's own values, unchanged
  font              = HarmonyOS Sans SC (production loading path)
  same build, seed, routes, DOM state, user, browser, DPR=1, zoom 100%,
  light theme; column widths, cell padding, row CSS and table layout are
  the product's, unchanged
```

## Product

Chinese-language exam/LMS/admin UI; dense enterprise tables.

## Surfaces (each as a blind X | Y pair)

| Surface | Route |
| --- | --- |
| Exam list (dense table, lifecycle statuses) | /admin/exams |
| Grading queue (dense table, grading statuses) | /admin/grading-queue |
| Recovery queue (dense diagnostic table, icon-bearing + text-only statuses) | /admin/recovery |
| Users (dense table, account statuses) | /admin/users |
| Scores (dense table, pass/fail statuses) | /admin/exams/:id/scores |

The recovery queue is the surface where badges render an icon by default
(urgency semantics) next to text-only badges in the same rows; judge icon/text
balance there. All other surfaces render text-only badges.

## Viewports

- 1440 × 900 — primary adjudication
- 1100 × 800 — density-sensitive repeat
- 1023 × 800 — boundary condition:
  - recovery-queue retains the governed table (diagnostic archetype,
    horizontal scroll) and is included as D5 evidence
  - the other surfaces switch to responsive card representation at this
    width and are excluded from D5 adjudication here

## Evidence

- `macro-contact-sheet.png` — scaled overview of full-viewport pairs
  (orientation only)
- `micro-contact-sheet.png` — **native-pixel** crops: header band + 3 body
  rows, then tight "body text | status badge | adjacent column" bands;
  **authoritative** for glyph breathing-room and centering judgement
- `micro/<surface>-pair.png` — per-surface native-pixel sheets (same crops,
  split for readability — use these if the combined sheet is too small to
  inspect comfortably)
- `macro/<surface>-<X|Y>-<viewport>.png` — raw full-viewport captures
- `micro/<surface>[-tight]-<X|Y>-<viewport>.png` — raw native crops

## Evaluate

- Chinese glyph breathing room inside the badge
- vertical centering of text (and icon/text balance where icons render)
- alignment with adjacent body text and neighbouring cells
- row rhythm and table density (does either variant crowd or loosen rows?)
- semantic-state visibility/salience of the badge against the row
- cross-surface consistency
- structural artifacts (clipping, collision with cell/border/action edges)

## Return

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY:
  breathing room:
  vertical alignment:
  row rhythm:
  density:
  consistency:
  structural effects:
RISKS:
PAGES WHERE DIFFERENCE MATTERED:
```

"Framework defaults" and "looks cleaner" are not arguments. The two variants
of each pair differ in exactly one property; anything else you notice is
identical by construction.
