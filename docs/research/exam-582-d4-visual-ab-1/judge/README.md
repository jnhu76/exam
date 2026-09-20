# EXAM-582 · D4 blind A/B — judge bundle

You are the blind multimodal adjudicator for **D4** (issue #582). Everything you
need is in this `judge/` directory. Do **not** open `../validity/` before
deciding — it holds the experiment's answer key.

```text
DECISION UNDER TEST:
  table-header font-size ONLY

FROZEN (identical in both arms):
  body/control text baseline = 15px
    (the frozen upstream D2 decision, established experimentally and
     verified per capture — judge the header RELATIVE TO THIS 15px BODY,
     not relative to any remembered production typography)
  header line-height = 20px
  header weight      = 500
  font               = HarmonyOS Sans SC (production loading path)
  same build, seed, routes, DOM state, user, browser, DPR=1, zoom 100%,
  light theme; header color, letter-spacing, padding, background, borders,
  column widths, row heights and table layout are the product's, unchanged
```

## Product

Chinese-language exam/LMS/admin UI; dense enterprise tables.

## Surfaces (each as a blind X | Y pair)

| Surface | Route |
| --- | --- |
| Exam list (dense table) | /admin/exams |
| Question management (dense table + tags) | /admin/questions |
| Audit logs (dense diagnostic table) | /admin/audit-logs |
| Users (dense table + role badges + actions) | /admin/users |

## Viewports

- 1440 × 900 — primary adjudication
- 1100 × 800 — density-sensitive repeat
- 1023 × 800 — boundary condition:
  - audit-logs retains the governed table and is included as D4 evidence
  - exam-list / questions / users switch to responsive card representation
    and are excluded from D4 table adjudication at this viewport

## Evidence

- `macro-contact-sheet.png` — scaled overview of full-viewport pairs
  (orientation only)
- `micro-contact-sheet.png` — **native-pixel** header+3-rows crops;
  **authoritative** for glyph-level judgement
- `macro/<surface>-<X|Y>-<viewport>.png` — raw full-viewport captures
- `micro/<surface>-<X|Y>-<viewport>.png` — raw native crops

## Evaluate

- header/body hierarchy (against the 15px body)
- Chinese header legibility
- horizontal scanning across dense columns
- visual dominance — does the header start overpowering the body or the page?
- density / compactness of the header band
- structural artifacts (wrapping, clipping, misalignment)

## Return

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY:
RISKS:
PAGES WHERE DIFFERENCE MATTERED:
```

"Framework defaults" and "looks cleaner" are not arguments. The two variants
of each pair differ in exactly one property; anything else you notice is
identical by construction.
