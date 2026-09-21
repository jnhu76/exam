# 01 — Protocol

Controlled A/B for D7 (Dialog / Sheet modal-surface background tier). The question under adjudication (issue #582): **with the frozen upstream baselines D2 (15px body/control), D3 (6px primary control family), D4 (13px/20px/500 governed table header), D5 (22px StatusBadge) and D6 (500 TagBadge weight), should the large modal/panel overlay surfaces render at the canvas tier (`var(--bg)`, the current recipe value) or at the content tier (`var(--surface)`)** — i.e. how does the Dialog/AlertDialog/Sheet background choice affect modal separation, hierarchy against page canvas and white content cards, perceived weight, muddy-vs-crisp character, the sheet/page boundary, and cross-surface consistency.

## Experiment law

Only `.surface-overlay[data-overlay-variant="modal"]` and `.surface-overlay[data-overlay-variant="panel"]`'s `background` changes between the arms. Everything else — build, seed, routes, DOM state, user, browser, viewport, DPR, zoom, font family/loading, border, border color/width, radius, shadow, overlay dimming (`bg-black/50`), padding, gap, layout, scroll ownership, panel edge, close controls, small-overlay surfaces, typography, controls, badges — is the identical product.

### D7 semantic family and exclusions

D7 is NOT "all overlays". The family is the modal/panel large-surface tier, verified as-built on the base SHA:

- `[data-slot="dialog-content"][data-overlay-variant="modal"]` (dialog.tsx:82/84)
- `[data-slot="alert-dialog-content"][data-overlay-variant="modal"]` (alert-dialog.tsx:66/68)
- `[data-slot="sheet-content"][data-overlay-variant="panel"]` (sheet.tsx:71/72)

Excluded (`.surface-overlay` base tier, already the content token): PopoverContent, DropdownMenuContent, DropdownMenuSubContent, SelectContent, Tooltip, Toast, ContextMenu. They form the experiment's CONTROL GROUP (§5) and are probed for non-contamination.

Authority note: `recipes.css` is unlayered (imported directly by `main.tsx`), so the panel recipe beats the layered `bg-sidebar` utility on the mobile-nav drawer — the drawer's computed background is the panel recipe's token in both arms. The consumer utility loses by construction; recorded as as-built fact in the inventory, not repaired here.

### Modal and panel move together (§4)

D7 is ONE semantic decision — the large overlay surface tier — so both variants of the recipe always receive the SAME arm token. The experiment never runs Dialog-X + Sheet-Y: that would be two variables.

### Common frozen baselines (both arms, byte-identical blocks)

D2 and D6 and D3 are NOT yet production-implemented as frozen, so the same convergence-up blocks proven in the D2–D6 campaign are injected byte-identically in BOTH arms:

```css
/* D2 = 15px body/control */
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
/* D6 = 500 TagBadge */
[data-slot="tag-badge"], [data-slot="tag-badge"][data-tag-variant="compact-table"] { font-weight: 500 !important; }
/* D3 = 6px primary control family (+ its seam/pagination guard rules, byte-identical to the D3 substrate) */
[data-slot="input"], [data-slot="select-trigger"], [data-slot="textarea"], [data-slot="button"],
[data-slot="alert-dialog-trigger"], [data-slot="alert-dialog-cancel"], [data-slot="alert-dialog-action"] { border-radius: 6px !important; }
```

The style proof re-verifies these absolutes per capture in both arms (`EXPERIMENT_INVALID_UPSTREAM_BASELINE` otherwise).

### Frozen upstream as-built baselines (verified, not injected)

- **D4**: every capture with a governed table behind the dialog asserts `table-head` computes 13px/20px/500 in BOTH arms.
- **D5**: every capture with a status badge asserts `height 22px / 12px / 500` in BOTH arms.

### D7 variable (the only cross-arm difference)

```css
.surface-overlay[data-overlay-variant="modal"],
.surface-overlay[data-overlay-variant="panel"] {
  background: var(--bg) !important;      /* canvas tier — or — */
  background: var(--surface) !important; /* content tier */
}
```

Semantic tokens only; no literal hex anywhere in the injection (§2). Which letter (X/Y) carries which tier is sealed in `validity/variant-map.json` only (independent crypto coin flip).

## Page-behind context is evidence, not decoration

Every macro capture is a full-viewport screenshot taken with the modal/sheet open — the page canvas, the white content cards, the dimmer and the overlay are in frame together (§11). Micro crops are GROWN bounding boxes (300–560 px context on the relevant sides), never the modal alone: D7's question is relational, so a crop that removes the page context would make the decision impossible (§27 discipline).

### Required relational cases

- **White-card backdrop (§12)**: the create-course and create-user dialogs open over admin pages whose governed tables sit on white cards — canvas, card, dimmer and dialog all visible.
- **Canvas-heavy backdrop (§13)**: the destructive unpublish confirmation opens over the sectioned exam-detail page, which exposes open page background around its content.
- **Sheet over below-lg page (§10)**: at 1023×800 the admin layout renders the mobile nav Sheet (side="left"); the page behind is the below-lg card representation.

## Instance authority and exclusions

Only real `[data-overlay-variant]`-carrying recipe consumers are measured. The as-built inventory (`validity/as-built-surface-inventory.json`) records every overlay family actually reachable in product routes — dialog/alert/sheet contents with their dimmers, the role SelectContent, the RowActions DropdownMenuContent, and the tag-filter PopoverContent — each with its computed background, resolved semantic token and D7_INCLUDED/EXCLUDED classification. The AUTHORITY_MISMATCH gate fails the run if any included overlay's computed background deviates from the canvas token resolution or any control-group container deviates from the content token resolution.

## Text color is not a surface proxy (§15)

The injection changes `background` only. Text, muted text, border colors and any compensating properties are never modified; a perceptual contrast shift on the content tier is a legitimate consequence of the candidate and is judged as such by the multimodal reviewer.

## Gates per capture

1. **Injection gate**: the variant `<style>` must exist inside `<head>` with the `background: var(--…)` `!important` rule — else `EXPERIMENT_INVALID`.
2. **Font gate**: `document.fonts.ready`, computed body stack contains HarmonyOS Sans SC, `fonts.check` true for 400 and 500 — else stop.
3. **Frozen baselines (absolute, both arms)**: D2 15px / D3 6px / D6 500 on every rendered family target; D4 13px/20px/500 and D5 22px/12px/500 where the underlying page renders them — else `EXPERIMENT_INVALID_UPSTREAM_BASELINE`.
4. **Overlay variant gate**: the d7-tier target must carry `data-overlay-variant="modal"` (dialogs/confirm) or `"panel"` (sheet); the sheet must additionally carry `data-overlay-panel-edge="right"` (as-built: a left-side drawer meets the page on its right edge).
5. **Style proof (pairwise)**: the d7 tier must move in `background-color` ONLY, and the two arm values must equal the two token resolutions as a set; every other recorded property of every target must be identical across arms (`CROSS_VARIABLE_CONTAMINATION` otherwise).
6. **Dim invariant (§18)**: `[data-slot="dialog-overlay"]` / `[data-slot="sheet-overlay"]` computed background and opacity identical across arms.
7. **Small-overlay non-contamination (§5)**: select/dropdown/popover contents computed identical across arms (containers additionally at the content-token resolution in both arms).
8. **Geometry guard (§17)**: pairwise bounding-box deltas (x/y/width/height) ≤ 0.5 px for every target; dialog-body scrollHeight/clientHeight identical; sheet width and panel edge unchanged.
9. **State proof (§23)**: Escape closes the modal, the close control is visible (X on dialogs, drawer button on the sheet), focus stays contained after 8 Tabs, and the body scroll lock is active — in BOTH arms, pairwise identical.
10. **Static-DOM reconciliation (before any capture)**: the canonical demo seed's live candidate attempts are terminated through the real recovery force-submit command and two quiet scanner periods are required, so the page-behind DOM cannot change between arms (proven D5 substrate).

## Surfaces

| Surface | Route | Case | Rationale |
| --- | --- | --- | --- |
| course-dialog | /admin/courses | create-course dialog (Input×2 + Textarea + footer) | dense form over a white-card governed table (§12); Textarea-bearing form |
| users-dialog | /admin/users | create-user dialog (Input×3 + SelectTrigger + footer) | second white-card sample (§12); role SelectContent doubles as the small-overlay control crop (M6); StatusBadge frozen-D5 guard on the page behind |
| exam-detail-confirm | /admin/exams/:id | unpublish AlertDialog (destructive + cancel) | destructive confirmation (§9B) over the canvas-heavy sectioned page (§13) |
| import-dialog | /admin/candidates | import wizard `DialogContent size="lg"` | large content-rich surface (§9C); CSV typed identically in both arms drives the real parse+preview pipeline (rows are never confirmed) |
| sheet-nav | /admin/courses @1023×800 | AdminLayout mobile nav Sheet | the Sheet half of the D7 family (§10); panel edge + page visible beside the drawer |
| users-dialog-select / fields-dropdown / questions-popover (probes) | — | small-overlay control group | computed non-contamination proof (§5); the select crop is judge-facing (M6) |
| questions-d6 (probe) | /admin/questions | TagBadge | frozen-D6 absolute guard |

## Viewports

| Viewport | Role |
| --- | --- |
| 1440 × 900 | primary adjudication (dialogs) |
| 1100 × 800 | density-sensitive repeat (dialogs) |
| 1023 × 800 | below-lg representation: mobile nav Sheet is the real active panel; not forced onto desktop dialogs (§22) |

## Pairwise discipline

Each surface×variant is a fresh context with identical login/navigation code paths; pairs are captured back-to-back (X then Y) so temporal drift inside a pair is seconds. Both arms see the same build, seed, routes, dialog content (the import CSV is typed identically), no other interaction, same scroll anchoring, viewport, DPR, zoom and font path. As-built inventory captures (clean product, no injection) are validity-only records and are excluded from every pairwise comparison by phase.
