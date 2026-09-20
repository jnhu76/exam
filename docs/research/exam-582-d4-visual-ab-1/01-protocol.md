# 01 — Protocol

Controlled A/B for D4 (table-header typography): header `font-size` 13px vs 14px. The question under adjudication (issue #582): **with the frozen D2 body/control typography (15px), which header size produces the better hierarchy, Chinese legibility and scanning behavior in dense tables without becoming visually dominant.** D4 is judged relative to the 15px body baseline, never relative to the current mixed production typography.

## Experiment law

Only `[data-slot="table-head"]`'s `font-size` changes between the arms. Everything else — build, seed, routes, DOM state, user, browser, viewport, DPR, zoom, font family/loading, colors, weights, radii, paddings, borders, column widths, row heights, table layout — is the identical product.

### Common frozen baseline (both arms): upstream D2 = 15px

Production has **not** implemented D2 yet: body typography recipes (`.type-body` / `.type-secondary` / `.type-page-description` / `.type-long-response`) and governed table cells (`[data-slot="table-cell"]` in `apps/web/src/table/recipes.css`) still render 0.875rem = 14px, while the `text-sm` control tier (Button, Input, sidebar nav items, admin shell root) renders 0.9375rem = 15px. Per the frozen D2 decision the tier converges **UP** onto the 15px control tier, so the following byte-identical baseline block is injected in **both** arms:

```css
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
```

The style proof re-verifies the absolute baseline per capture: table cells and representative sidebar/control targets must compute **15px in both arms** — otherwise `EXPERIMENT_INVALID_D2_BASELINE` and no evidence is packaged. Comparing a 13px header against a 14px body in one arm and a 15px body in the other would invalidate causal attribution; both arms share this baseline by construction and by proof.

### D4 variable (the only cross-arm difference)

```css
[data-slot="table-head"] { font-size: <candidate rem> !important; }
```

13px = 0.8125rem, 14px = 0.875rem. Which letter (X/Y) carries which value is sealed in `validity/variant-map.json` only.

### Frozen header constants (product values, never injected)

- `line-height: 1.25rem` = **20px** (product `table-head` recipe) — fixed for both candidates.
- `font-weight: 500` (product `table-head` recipe) — fixed for both candidates.
- Header color, tinted background fill, grid/shell borders, paddings, the `data-column-overflow` vocabulary, column widths (`table-layout: fixed` + `<col>` allocation), and row heights are the product's.

### Header geometry is evidence, not a defect to repair

No th height, padding, column width, white-space, overflow or alignment value is compensated anywhere in the harness. Natural glyph-geometry consequences of the size change (wrapping, clipping, column pressure, header-band growth) are recorded by the structural sweep and reported in 03-structural-effects.md.

## Blinding (hardened after D2)

- `validity/variant-map.json` is written by an independent `crypto.randomInt(2)` coin flip (fresh for D4; the D2 assignment carries no forward assumption) and is the **only** place the X↔px assignment exists.
- The judge bundle (`judge/`) and the validity bundle (`validity/`) are **physically separated directories**. Judge-facing files (README, contact sheets, raw captures, 04-judge-handoff.md) carry letters only and contain no candidate values; `validity/style-proof.json` records computed px per letter and opens with an explicit `VALIDITY ONLY — MAPPING REVEALING` warning.
- This closes the D2 evidence-discipline defect where the adjudicator environment could access mapping-revealing validity artifacts.

## Gates per capture

1. **Injection gate**: the variant `<style>` must exist inside `<head>` with an `!important` font-size rule — otherwise `EXPERIMENT_INVALID`.
2. **Font gate**: `document.fonts.ready`, computed body stack contains `HarmonyOS Sans SC`, `fonts.check` true for 400 and 500 — else `EXPERIMENT_INVALID` stop.
3. **Representation gate**: the governed table must actually render (header row laid out). At the primary viewports a non-rendering governed table is `EXPERIMENT_INVALID`; at the 1023 boundary it is recorded as `RESPONSIVE_REPRESENTATION_CHANGE` and excluded from the evidence set.
4. **D2 baseline proof**: `table-cell` and representative sidebar/control targets must compute 15px in both arms — else `EXPERIMENT_INVALID_D2_BASELINE`.
5. **D4 style proof**: `table-head` must move in font-size between arms and hold 20px line-height / 500 weight in both; family, color, letter-spacing, padding, background and border must be identical across arms.
6. **Cross-variable contamination guard**: no non-`table-head` target may move in any computed property between arms.
7. **Structural sweep**: document overflow, table scroll state, header/body column alignment, header row height, per-header wrapped/clipped/ellipsis state, first-row heights, last-cell and action-column reachability. Recorded, never repaired.

## Surfaces

| Surface | Route | Archetype | Rationale |
| --- | --- | --- | --- |
| Exam list | /admin/exams | management-list | status badges, duration/count short fields, long CJK names |
| Question management | /admin/questions | workbench grid | long CJK stems, type tags, tag cells |
| Audit logs | /admin/audit-logs | log-diagnostic | dense timestamp/action/detail columns, horizontally scrolled at the boundary |
| Users | /admin/users | management-list | role badge pills + row actions column |

All four are high-information dense tables; no low-information table was added.

## Viewports

| Viewport | Role |
| --- | --- |
| 1440 × 900 | primary adjudication |
| 1100 × 800 | density-sensitive repeat |
| 1023 × 800 | boundary condition (1px below the `lg` breakpoint; admin sidebar leaves the flow) |

### 1023 boundary finding (recorded, not repaired)

Below `lg`, the `management-list` shells switch to a pure-CSS mobile card representation (DataTableShell `mobile` slot): on exam list, questions and users the desktop table subtree is `display:none` at 1023, so those surface/viewport combinations are recorded as `RESPONSIVE_REPRESENTATION_CHANGE` and are **not** used as D4 table evidence. The `log-diagnostic` archetype (audit logs) keeps the governed table with horizontal scroll below `lg`, so audit-logs at 1023 remains valid — and maximally density-stressed — D4 evidence.

## Pairwise discipline

Each surface×variant is a fresh context with identical login/navigation code paths; pairs are captured back-to-back so temporal drift inside a pair is seconds. Both arms see the same build, seed, routes, default sorting/filters/pagination (no interaction), no dialogs, no row selection, same scroll anchoring, same viewport, DPR, zoom and font path.
