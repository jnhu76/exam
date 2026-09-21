# EXAM #582 — Implementation Contract

Frozen mechanical implementation authority for the campaign's unified production PR. This file contains **no new design choices** — every value below was adjudicated and frozen in the D2–D7 records ([FINAL-DECISIONS.md](FINAL-DECISIONS.md), [d2-freeze.md](d2-freeze.md) … [d7-freeze.md](d7-freeze.md)). The implementation PR should need no other design input than this file.

Campaign law: the D2/D3/D6/D7 changes land together as **one unified implementation PR**; D4/D5 require no production change and must remain byte-identical; #590 stays out of scope and is sequenced after this implementation.

## D2 — body / control text tier: 14 → 15

```text
authorized owners/selectors:
  body typography recipes (.type-body / .type-secondary / .type-page-description /
  .type-long-response) and governed table cells converge UP to the existing
  15px text-sm control tier
change: body/table-cell 14 → 15
the control tier is NOT lowered
```

## D3 — primary control family radius: 8 → 6 (converge down)

```text
input/select/textarea keep 6                    (control/recipes.css 0.375rem — unchanged)
button semantic family 8 → 6                    (button.tsx rounded-lg moves to 6px)
include AlertDialog Slot consumers:
  the change must own the whole family boundary — the seven D3_INCLUDED slots
  (input, select-trigger, textarea, button, alert-dialog-trigger,
  alert-dialog-cancel, alert-dialog-action); data-slot="button" targeting alone
  is insufficient because Radix Slot renders the alert-dialog slot names
destructive-variant members inherit the same 6px; no radius-by-variant exceptions
exist as-built and none are authorized
the quiet-toolbar composite-seam rules in control/recipes.css are dead CSS as-built;
their removal is an independent cleanup decision and must not ride along
```

## D4 — no production change

```text
as-built governed header rule already matches the frozen decision:
  [data-slot="table-head"] in apps/web/src/table/recipes.css
  (font-size 0.8125rem = 13px, line-height 1.25rem = 20px, weight 500)
verify it remains unchanged; do not touch
```

## D5 — no production change

```text
as-built authority already matches the frozen decision:
  [data-slot="status-badge"] height 1.375rem = 22px, border-radius 0.375rem
verify it remains unchanged; do not touch
```

## D6 — TagBadge font-weight: 400 → 500

```text
both TagBadge owner blocks 400 → 500 only:
  [data-slot="tag-badge"]                    font-weight 400 → 500
  [data-slot="tag-badge"][data-tag-variant="compact-table"]
                                             font-weight 400 → 500
no other TagBadge property moves (height 22px, size 12px, line-height 16px/18px,
padding 6px, radius 4px/3px, colors held absolutely by the experiment)
the +N tag-overflow chip keeps its product styling (was verified non-contaminated)
caveat carried: DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP — real product evidence was
compact-table; reconfirm the default variant if it becomes a real surface
```

## D7 — modal/panel overlay background: var(--bg) → var(--surface)

```text
modal + panel background var(--bg) → var(--surface):
  .surface-overlay[data-overlay-variant="modal"]  background: var(--bg) → var(--surface)
  .surface-overlay[data-overlay-variant="panel"]  background: var(--bg) → var(--surface)
modal and panel move TOGETHER (one semantic family, adjudicated jointly)
small overlays unchanged: the .surface-overlay base tier keeps var(--surface);
  after D7 the overlay family becomes single-tier on background, with the
  modal/panel-vs-base distinction carried by radius/shadow/edge recipes
radius/shadow/border/dimmer/panel edge unchanged — only the two background
  declarations move (the single-variable law the evidence was generated under)
the mobile-nav Sheet's layered bg-sidebar utility stays inert (already loses to
  the unlayered panel recipe as-built); deciding its cleanup is out of scope
```

## Verification duties of the implementation PR

```text
- D4/D5 selectors byte-identical before/after (negative diffs)
- every frozen constant above lands exactly as written; no rider changes
- #590 untouched (sequenced after this PR)
- final visual baseline captured after implementation, before #590 work
```
