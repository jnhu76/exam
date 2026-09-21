# EXAM-582 · D7 blind A/B — judge bundle

You are the blind multimodal adjudicator for **D7** (issue #582). Everything you
need is in this `judge/` directory. Do **not** open `../validity/` before
deciding — it holds the experiment's answer key.

```text
DECISION UNDER TEST:
  The background of the LARGE modal / drawer overlay ONLY
  (centered dialogs, alert dialogs, and the edge-attached navigation
  drawer — all as one family, judged together)

FROZEN (identical in both arms):
  border, border color, border width, radius, shadow
  overlay dimming (the dark veil between page and modal)
  layout, padding, gaps, width/height, scroll behavior, panel edge
  typography (15px body/control, 13px/20px/500 table header)
  controls (6px control family), badges (22px status, 500-weight tags)
  small floating panels (popovers, menus, select dropdowns)
  font = HarmonyOS Sans SC (production loading path)
  same build, seed, routes, DOM state, user, browser, DPR=1, zoom 100%,
  light theme
```

## Product

Chinese-language exam/LMS/admin UI; dense enterprise forms and tables.

## Scenarios (each as a blind X | Y pair; the page behind is always visible)

| Scenario | What it shows |
| --- | --- |
| Create-form dialog over a card-table page | dense form dialog floating over a page whose table sits in a light card |
| Create-form dialog over a card-table page (second sample) | same question on a different page/form |
| Destructive confirmation over a sectioned page | small alert dialog over a page with much open background |
| Large import-wizard dialog over an admin page | content-rich dialog with a data-preview area |
| Navigation drawer at 1023 × 800 | edge-attached drawer with the page visible beside it |

## Evidence

- `macro-contact-sheet.png` — scaled overview of full-viewport pairs
  (orientation only)
- `micro-contact-sheet.png` — **native-pixel** crops: modal/drawer edges with
  the underlying page on all sides, interior form bands, the whole destructive
  confirmation, the drawer edge, and a small-overlay control reference;
  **authoritative** for edge/boundary judgement
- `macro/<scenario>-<X|Y>-<viewport>.png` — raw full-viewport captures
- `micro/<scenario>[-crop]-<X|Y>-<viewport>.png` — raw native crops

## Evaluate

- separation of the modal/drawer from the page it floats over
- overlay clarity and visual weight of the large modal/drawer
- muddy vs crisp character of the overlay's interior
- hierarchy against light content cards on the page behind
- hierarchy against the open page background around content
- drawer/page boundary legibility at the panel edge
- cross-scenario consistency (dialogs, confirmations, drawer as one family)
- legibility of everything inside the overlay (perceptual text/contrast
  differences are legitimate consequences of the background choice — judge
  them as such)

## Return

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY:
  modal separation:
  hierarchy vs page background:
  hierarchy vs cards:
  visual weight:
  muddy/crisp character:
  drawer boundary:
  cross-surface consistency:
RISKS:
PAGES / CROPS WHERE DIFFERENCE MATTERED:
```

"Framework defaults" and "looks cleaner" are not arguments. The two variants
of each pair differ in exactly one property; anything else you notice is
identical by construction.
