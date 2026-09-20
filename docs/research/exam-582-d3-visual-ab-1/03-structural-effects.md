# 03 — Structural effects

Mapping-neutral X/Y facts. Expected outcome — **no geometry change of any kind** — is confirmed: `border-radius` is paint-only, and the pairwise bounding-box oracle proves it stayed that way.

## Control dimensions and layout position

95 pairwise bounding-box comparisons across every oracle target (family controls, dialog surfaces, table cells, badges, overlays) in both arms at both viewports:

```text
Δ x = 0      Δ y = 0      Δ width = 0      Δ height = 0     in all 95 pairs
```

No control moved, no control resized, no adjacent-control gap changed, no form row height changed. The convergence onto a single family radius altered nothing but painted corners.

## Dialog dimensions

`dialog-content` (course + users dialogs) and `alert-dialog-content` (unpublish confirm) bounding boxes are pairwise identical across arms — the D7-owned surfaces are untouched, and the controls inside them sit at identical positions.

## Focus ring presence

The keyboard focus ring (`:focus-visible`, 3px ring at 25% opacity over the ring color) is present in BOTH arms on all three focus probes (wizard title input, course-dialog name input, users-dialog role select trigger). The invalid ring (product `aria-invalid` border/ring) and the disabled palette are likewise present and identical in both arms. Focus/invalid/disabled treatment is structurally unaffected by the radius candidate.

## Document / layout health

No horizontal document overflow, no wrapped rows, no reflow artifacts in either arm at either viewport; the arm-capture DOM sequences (dialog open/focus/invalid/disabled, select open/close, confirm open/close) behaved identically.

## As-built structural notes recorded for the campaign (not repaired here)

- The quiet-toolbar **joined-filter geometry is dead CSS**: no renderer exists for `[data-slot="toolbar-filters"]`; the 0px seam rules in `control/recipes.css` match nothing at runtime. A D3 production implementation must decide that block's fate (delete or re-wire) independently of the D3 value.
- Three confirm-dialog buttons carry `alert-dialog-trigger` / `alert-dialog-cancel` / `alert-dialog-action` slot names instead of `data-slot="button"` (Radix Slot precedence) while drawing their radius from `buttonVariants` — a production D3 convergence that only touches `[data-slot="button"]` would silently miss them.
- The destructive confirm action renders with the **default-variant palette** despite `data-variant="destructive"` (Slot class precedence) — recorded as an as-built observation for a follow-up, outside this experiment's scope.
