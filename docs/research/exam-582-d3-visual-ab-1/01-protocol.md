# 01 — Protocol

Controlled A/B for D3 (primary control family radius): the interactive form/control family — `Input`, `SelectTrigger`, `Textarea` and standalone `Button` — renders at a computed `border-radius` of **6px vs 8px**. The question under adjudication (issue #582): **when the primary control family is treated as ONE family (a family convergence decision, not a per-selector decision), which radius gives the more coherent Chinese LMS/admin interface — without changing control height, padding, border, background, font, icon, focus treatment, disabled treatment, error treatment, spacing or layout?**

D3 is explicitly a **family convergence** decision: today the runtime is split (inputs/selects/textarea at 6px via `control/recipes.css` `0.375rem`; buttons at 8px via `rounded-lg` in `buttonVariants`), so the decision converges the family onto a single candidate. The judge never sees numbers, the split, or direction language — only rendered X/Y.

## Experiment law

Only the computed `border-radius` on the D3 family changes between the arms. Everything else — build, seed, routes, form data, user, browser, viewport, DPR, zoom, font family/loading, width, height, min-height, padding, gap, border width/color, background, text color, shadow, focus ring, invalid ring, disabled treatment, icon size/position, layout — is the identical product. Radius cannot change layout, so every bounding box must be pairwise identical (Δ = 0 within float tolerance; any larger delta is investigated before packaging).

### As-built split (§2, verified before the arms)

On the clean product (no injection) at 1440×900, browser computed styles must confirm:

```text
standalone Input         = 6px   (control/recipes.css 0.375rem)
standalone SelectTrigger = 6px   (control/recipes.css 0.375rem)
standalone Textarea      = 6px   (control/recipes.css 0.375rem)
standalone Button        = 8px   (components/ui/button.tsx rounded-lg)
```

Any mismatch stops the run (`AUTHORITY_MISMATCH`) before any arm evidence is produced. The full per-route inventory (route / component / selector / context / computed radius / source owner / D3_INCLUDED / D3_EXCLUDED / reason) is `validity/as-built-radius-inventory.json`.

### Family boundary (§1/§3/§5)

Included (D3_INCLUDED): standalone `[data-slot="input"]`, `[data-slot="select-trigger"]`, `[data-slot="textarea"]`, `[data-slot="button"]` in real form, dialog, wizard, footer, header-action and toolbar contexts. Buttons are classified primary (default), outline/secondary and destructive where the product renders them; ghost/icon buttons render inside the surfaces as secondary consistency evidence; link-style buttons are not visually radius-expressing and carry no dedicated evidence.

Excluded (D3_EXCLUDED, must not move in either arm): StatusBadge and TagBadge (frozen D5/D6 geometry), generic Badge/role pills/chips, pagination pills, Dialog and AlertDialog container surfaces (D7 scope), SelectContent/SelectItem overlays, Sheet (no instance on the evidence surfaces), tables/cards/shells, checkbox/radio/switch (none on the surfaces), toast/tooltip.

Two as-built DOM facts shape the selector set (§9 runtime validation, not blind copying):

1. **Composite internal seam is dead CSS.** The quiet-toolbar joined-filter geometry (`[data-slot="toolbar-filters"]` direct children forced to `border-radius: 0`) has no renderer — no component emits that slot; `control/recipes.css` carries the rules but they match nothing at runtime. The seam-preservation rule is kept in BOTH arms as a guard (`0 !important` at higher specificity than the family rule), the oracle proves the selectors match nothing in both arms, and quiet-toolbar controls (search input, filter selects) are probed as the standalone family members they now are. A production implementation of a D3 convergence must decide this dead block's fate separately (recorded follow-up, not exercised here).
2. **Three confirm-dialog buttons do not carry `data-slot="button"`.** Radix Slot prop precedence keeps the primitive slot names under asChild composition: the unpublish confirmation renders `data-slot="alert-dialog-trigger"` (the outline trigger in the page header), `data-slot="alert-dialog-cancel"` (secondary/cancel) and `data-slot="alert-dialog-action"` (primary/destructive), all styled by `buttonVariants` (radius source `rounded-lg`, as-built 8px). They are standalone family buttons (§14 C5), so the family selector names these as-built slots explicitly.

### Common frozen baseline (both arms): upstream D2 = 15px, upstream D6 = 500

D2 and D6 are not implemented in production yet, so the byte-identical convergence-up blocks proven in the D2/D4/D5/D6 campaign are injected in **both** arms:

```css
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
[data-slot="tag-badge"],
[data-slot="tag-badge"][data-tag-variant="compact-table"] { font-weight: 500 !important; }
```

The frozen D4 decision (13px/20px/500 governed table header) and the frozen D5 decision (22px StatusBadge) are production as-built and re-verified per capture. Guard failures invalidate the run (`EXPERIMENT_INVALID_UPSTREAM_BASELINE`).

### D3 variable (the only cross-arm difference)

```css
[data-slot="input"],
[data-slot="select-trigger"],
[data-slot="textarea"],
[data-slot="button"],
[data-slot="alert-dialog-trigger"],
[data-slot="alert-dialog-cancel"],
[data-slot="alert-dialog-action"] {
  border-radius: <candidate> !important;
}
```

Plus two invariant exception rules, byte-identical in both arms: the seam guard (composite internal seams stay 0) and the pagination guard (pagination buttons pinned to the as-built 8px). Which letter (X/Y) carries which radius is sealed in `validity/variant-map.json` only (independent `crypto.randomBytes` coin flip; no forward assumption from the D2/D4/D5/D6 assignments).

## Evidence surfaces (real product states, no invented galleries)

| Surface | Route | Semantic class (§12) | Family content |
| --- | --- | --- | --- |
| exam-create | /admin/exams/new | A — dense admin form | title Input, course + profile SelectTriggers, description Input, outline-cancel + primary-next footer, product-disabled future stepper buttons |
| course (+dialog) | /admin/courses | B — Textarea form + quiet toolbar | create-course dialog: name/code Inputs, description Textarea, outline-cancel + primary-save footer; quiet toolbar with a standalone search input |
| users (+dialog) | /admin/users | C — dialog workflow | create-user dialog: username/password/name Inputs, role SelectTrigger, footer buttons; role Badge + StatusBadge guards |
| exam-detail (+confirm) | /admin/exams/:id | D — destructive confirmation | published exam: StatusBadge guard, unpublish trigger, ConfirmDialog with destructive + cancel footer |
| question-list-probe | /admin/questions | validity-only (§13) | TagBadge frozen-D6 guard, D2/D4 absolutes, second quiet-toolbar sample; no screenshots, never judged |

The Question Management toolbar (grouped/composite geometry in the task's §13 sense) is used only as a non-contamination context; as-built the joined group does not render, which is itself recorded. 1023×800 is not used: below `lg` the workbenches switch card representations (`RESPONSIVE_REPRESENTATION_CHANGE` territory), and the dialog/form evidence has no need for the boundary viewport.

## Gates per capture

1. **Injection gate**: the variant `<style>` must exist inside `<head>` with an `!important` border-radius rule — else `EXPERIMENT_INVALID`.
2. **Font gate** (§16): `document.fonts.ready`, computed body stack contains `HarmonyOS Sans SC`, `fonts.check` true for 400 AND 500 (both weights are used by the frozen tiers) — else `EXPERIMENT_INVALID_FONT_STACK`.
3. **Presence gate**: every required per-surface target must render — else `EXPERIMENT_INVALID`.
4. **Convergence gate** (§17): every found standalone family control computes exactly the arm candidate on that surface — else `EXPERIMENT_INVALID`.
5. **Seam gate** (§18): the composite-seam selectors match nothing in both arms (as-built absence) or read 0px in both arms — else `CROSS_CONTEXT_CONTAMINATION`.
6. **D2 baseline proof**: sidebar/table-cell targets compute 15px in both arms.
7. **D4 frozen proof**: table headers compute 13px/20px/500 in both arms.
8. **D5 frozen proof**: StatusBadge computes 22px height and is identical across arms.
9. **D6 frozen proof**: TagBadge computes weight 500 in both arms (injected baseline) with as-built radius unchanged.
10. **Dialog-surface non-contamination**: `dialog-content` / `alert-dialog-content` radius and shadow identical across arms (D7 owns them).
11. **Overlay non-contamination**: SelectContent/SelectItem identical across arms (probed open in the users dialog).
12. **Badge/pagination exclusions**: role Badge identical across arms; pagination pinned (no surface renders it — fixtures stay under the page size).
13. **State oracle** (§16): focus / invalid / disabled probes on real controls — the product state treatment must be present in BOTH arms (focus ring visible via keyboard `:focus-visible`, aria-invalid ring/border expressed, disabled palette expressed) and identical across arms except `border-radius`.
14. **Geometry gate** (§20): all pairwise bounding-box deltas ≤ 0.5px.
15. **Cross-variable contamination guard**: no non-family target may move in any computed property between arms.

## State evidence (§15)

- **focus** — keyboard-driven `:focus-visible` on the wizard title Input, the course-dialog name Input and the users-dialog role SelectTrigger (visual crops + state oracle).
- **disabled** — the natural product-disabled future stepper buttons on the wizard step 1 (visual crop + state oracle, compared against the enabled current-step sibling), plus the dialog save Button as a mechanical probe.
- **invalid** — the product `aria-invalid` treatment on the course-dialog name Input (visual crop + state oracle, expressed against the resting record captured moments earlier).

## Viewports

| Viewport | Role |
| --- | --- |
| 1440 × 900 | primary adjudication |
| 1100 × 800 | density-sensitive repeat |

## Micro evidence plan (§22)

Native-pixel crops are authoritative (1:1 framebuffer, DPR=1); crop edges snap to element boundaries or whitespace so no control is sliced:

- **M1/C1** — Input + Button: course-dialog fields band (name + code) and textarea-above-footer band; wizard form band
- **M2/C2** — SelectTrigger + Button: users-dialog select + footer band
- **M3/C3** — Textarea + Input/Select: course-dialog textarea band; wizard band (Input + SelectTriggers)
- **M4/C6** — dialog form controls: whole course dialog and whole users dialog (dialog surface visible for context, itself frozen)
- **M5** — focused states: wizard Input, dialog Input, dialog SelectTrigger crops
- **M6/C4/C5** — mixed button rows: wizard footer (outline + primary), course/users dialog footers, confirm footer (destructive + cancel)

Macro pairs (full viewport per surface per arm per viewport) evaluate family cohesion, page rhythm, softness/mechanicalness, and relationships to cards/dialogs/tables — orientation, not corner judgement.

## Blinding (permanent rule after D4)

The judge renders X/Y only; the numerical direction is revealed mechanically afterward. Judge-facing files carry letters only — no candidate values, no "6px/8px", no "current/candidate/rounder" language. Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning.

## Tie rule (D3-specific, §25)

The current runtime is a split (6px inputs/selects/textarea vs 8px buttons), so "current value wins ties" cannot mean one scalar. If and only if the blind verdict is `NO_CLEAR_WIN`, the outcome is:

```text
D3 = NO_CLEAR_WIN
CURRENT SPLIT PRESERVED
no convergence authorized
```

Neither 6 nor 8 may be chosen mechanically. The judge is never told this rule's direction — it sees only rendered X/Y.
