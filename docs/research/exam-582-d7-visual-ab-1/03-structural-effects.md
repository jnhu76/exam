# 03 — Structural effects

Mapping-neutral X/Y facts. Expected outcome — **no structural difference of any kind** — is confirmed: `background` is paint-only, and the pairwise oracle proves it stayed that way.

## Geometry deltas (§17)

99 pairwise bounding-box comparisons across every oracle target (dialog/alert/sheet contents, dimmers, close controls, titles, the dialog-body scroll owner, form controls, table cells, headers, badges, sidebar links) in both arms at all three capture viewports:

```text
Δ x = 0      Δ y = 0      Δ width = 0      Δ height = 0     in all 99 pairs
```

No modal moved or resized, no drawer changed width, no footer/header shifted, no form row reflowed, no scroll region changed size.

## Scroll ownership

The import wizard's `[data-slot="dialog-body"]` (the element that owns the dialog's vertical scroll) records identical `scrollHeight` / `clientHeight` / `overflow-y` in both arms in every pair — the background change did not alter scroll extent or ownership. Header/footer positions inside every dialog are pairwise identical.

## Overlay alpha (§18)

The dimmer (`[data-slot="dialog-overlay"]` / `[data-slot="sheet-overlay"]`, product class `bg-black/50`) computes an identical background color and opacity 1 in both arms in 9/9 pairs. The veil between the page and the large overlay is bit-identical; only the overlay's own fill differs, by design.

## Shadow equality (§19)

`box-shadow` is a controlled property of every d7-tier target: pairwise identical across arms in all 9 pairs (lg elevation on modal/panel as-built; nothing normalized, nothing moved).

## Border equality and panel edge (§21)

Border widths, colors and radii are controlled properties everywhere: identical across arms in all pairs. The sheet's visible edge is unchanged: `data-overlay-panel-edge="right"` (the page-meeting edge of a `side="left"` drawer), 1px border on that edge, 0 on the others, same edge color — in both arms.

## Interaction behavior (§23)

Identical in both arms on all 9 surface pairs: Escape dismisses, the close control is visible (dialog X / drawer close button), focus stays contained after 8 Tab presses, body scroll lock active. `validity/state-proof.json` records the per-arm facts.

## Document / layout health

No horizontal document overflow, no reflow artifacts, no animation-frame capture hazards (reduced motion enforced; captures taken at the open-stable state) in either arm. The arm-capture DOM sequences (dialog open → proofs → crops → select open/close → interaction probe → Escape) behaved identically.

## As-built structural notes recorded for the campaign (not repaired here)

- The mobile-nav Sheet carries a layered `bg-sidebar` utility on its consumer className while the unlayered panel recipe owns its background — the utility loses the cascade today. The as-built inventory records the recipe's token as the computed truth; a future cleanup that removes the dead utility would change nothing visible.
- `side="left"` maps to `data-overlay-panel-edge="right"` (the edge that meets the page carries the border). Any future panel-edge work must read the attribute, not the side.
- The destructive confirm action still renders with the default-variant palette despite `data-variant="destructive"` (Radix Slot class precedence) — already recorded by the D3 pack for a follow-up; still as-built here, out of D7 scope.
