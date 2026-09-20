# EXAM-582 · D3 blind A/B — judge bundle

You are the blind multimodal adjudicator for **D3** (issue #582). Everything you
need is in this `judge/` directory. Do **not** open `../validity/` before
deciding — it holds the experiment's answer key.

```text
DECISION UNDER TEST:
  the PRIMARY CONTROL FAMILY corner radius ONLY
  (form inputs, select triggers, textareas and standalone buttons —
   judged as ONE family; the buttons and the fields always move together)

FROZEN (identical in both arms):
  body/control text baseline = 15px (the frozen upstream D2 decision,
    established experimentally and verified per capture)
  table-header typography = 13px / 20px / 500 (frozen upstream D4, as-built)
  status badge = 22px tall (the frozen upstream D5 decision, as-built)
  tag chip weight = 500 (the frozen upstream D6 decision, established
    experimentally; tag radius/geometry unchanged)
  dialog and confirmation surface geometry (D7 owns it — untouched)
  control height, width, padding, border width/color, background, text color,
    font, icon size/position, focus treatment, disabled treatment, spacing,
    layout — identical by construction and re-proven per capture
  font = HarmonyOS Sans SC (production loading path)
  same build, seed, routes, form data, user, browser, DPR=1, zoom 100%,
    light theme
```

## Product

Chinese-language exam/LMS/admin UI. The evidence surfaces are the forms,
dialogs and a destructive confirmation that admins use daily: an exam-creation
wizard, a course form with a textarea, a user-creation form with a role
select, and an unpublish confirmation. Table workbenches appear as surrounding
context only.

## Surfaces (as blind X | Y pairs)

| Surface | What it shows |
| --- | --- |
| Exam wizard | dense admin form: text field, two select fields, description field, cancel + next footer; disabled future steps in the stepper |
| Course dialog | name + code fields, description textarea, cancel + save footer, directly above the fields |
| User dialog | username/password/name fields, role select, cancel + save footer |
| Exam detail + confirm | page context, then the destructive confirmation dialog (destructive + cancel footer) |
| Course / user workbenches | table + toolbar + badge context (orientation only) |

Interaction states are included: keyboard-focused fields and select (with the
product focus ring), an invalid field (product error ring), and disabled
controls. The quiet toolbar appears as a labelled context-only section — it is
NOT primary evidence for this decision.

## Viewports

- 1440 × 900 — primary adjudication
- 1100 × 800 — density-sensitive repeat

## Evidence

- `macro-contact-sheet.png` — scaled overview of full-viewport pairs
  (orientation only)
- `micro-contact-sheet.png` — **native-pixel** crops: form bands, dialog
  wholes, footer rows, state contexts — **authoritative** for corner-level
  judgement
- `micro/<group>-pair.png` — per-group native-pixel sheets: exam-form,
  course-form, dialog-forms, destructive, states, toolbar-context (use these
  if the combined sheet is too small to inspect comfortably)
- `macro/<surface>-<X|Y>-<viewport>.png` — raw full-viewport captures
- `micro/<surface>-<crop>-<X|Y>-<viewport>.png` — raw native crops

## Evaluate

- control-family coherence — do the fields and the buttons read as ONE family?
- button/input relationship — does the primary action belong with the fields
  it acts on?
- form readability and rhythm across stacked fields in dialogs and the wizard
- visual precision vs visual softness — do controls feel measured or mushy,
  mechanical or brittle?
- focus-state coherence — does the focus ring sit naturally with the corner
  geometry?
- dialog-form integration — controls inside the fixed dialog surface
- destructive confirmation — do the destructive and cancel buttons relate
  correctly to each other and to the dialog?
- cross-page consistency — wizard, dialogs, confirmation, workbench context
- disabled states — do disabled controls still read as family members?

## Return

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY:
  family coherence:
  form rhythm:
  visual precision:
  visual softness:
  button/control relationship:
  state consistency:
  cross-page consistency:
RISKS:
PAGES / CROPS WHERE DIFFERENCE MATTERED:
```

"Framework defaults" and "looks cleaner" are not arguments. The two variants
of each pair differ in exactly one property; anything else you notice is
identical by construction. Do not try to infer numeric values or which variant
is "rounder" — report what you see, letter by letter.
