# 01 — Protocol

Controlled A/B for D2 (body / control text size): 14px vs 15px. The question under adjudication (issue #582): which gives better Chinese UI hierarchy and readability without making dense admin surfaces feel oversized.

## Experiment law

Only the body/control text tier's `font-size` changes between the arms. Everything else — build, seed, routes, DOM state, user, browser, viewport, DPR, zoom, font family/loading, colors, weights, radii, dialog surface, table layout — is the identical product.

### Baseline fact that defines the arms

The product currently **splits** the D2 tier:

- `.type-body` / `.type-secondary` / `.type-page-description` / `.type-long-response` (typography recipes) and governed table cells (`[data-slot="table-cell"]` in `apps/web/src/table/recipes.css`) render **0.875rem = 14px**.
- The `text-sm` control tier (Button, Input, Select, Textarea@md, Label, sidebar nav items, admin shell root) renders **0.9375rem = 15px** because `index.css` sets `@theme inline { --text-sm: 0.9375rem }` and the built CSS inlines the literal (`.text-sm{font-size:.9375rem;...}`).

D2 is exactly the convergence question: whole tier at 14 (arm A) or whole tier at 15 (arm B).

### Variant CSS (experiment-only, injected)

Runtime injection via Playwright `context.addInitScript` installing one `<style>` into `<head>`; **no production file is modified**. Only `font-size` declarations, with `!important` to make the override independent of stylesheet order (the built CSS inlines `text-sm` literally, so an order-dependent tie would be fragile).

Arm **14px** (control tier converges down):

```css
.text-sm { font-size: 0.875rem !important; }
@media (min-width: 48rem) { .md\:text-sm { font-size: 0.875rem !important; } }
```

Arm **15px** (body tier converges up):

```css
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
```

`md:text-sm` (4 consumers, e.g. Textarea) needs its own media-scoped rule because Tailwind emits it as a separate class. `selection/placeholder/file:text-sm` pseudo-variants were inventoried and are not present on any captured surface.

### Line-height isolation (B2 disclosure)

No `line-height` declaration is injected. Three product couplings then show up in the computed proof (02-style-proof.md), and they belong to the evidence, not to a confounder:

- `text-sm` elements carry Tailwind's unitless `1.5`, so their line-height **scales** with the font size (22.5px ↔ 21px).
- Typography recipes and table cells carry fixed rem line-heights (22px), which **stay constant** across arms.
- Labels carry `leading-none`, so their line-height equals the font size (15px ↔ 14px).

### Hard non-goals observed

`font-family`, `font-weight`, `color`, `letter-spacing`, radii, paddings, dialog surface, badge/metadata tier (12px), table-header tier (13px — D4), section/reading tiers (16/20px), and metric tiers were not addressed by any injected rule; the style proof re-measures them every capture (02).

## Blinding (B3)

- `artifacts/variant-map.json` is written by `crypto.randomInt(2)` and is the **only** place the X↔px assignment exists.
- Harness code reads the map at runtime; screenshots, crops, contact sheets, logs and this report carry letters only.
- The assignment is not reproduced in any judge-facing artifact. `D2/style-proof.json` records computed px per letter and is therefore marked validity-only, not judge-facing (03-evidence-index.md).

## Gates per capture (B6/B7)

1. **Injection gate**: the variant `<style>` must exist inside `<head>` with an `!important` font-size rule — otherwise `EXPERIMENT_INVALID` (added after a first run where a document-start install silently landed outside `<head>` and the arms degenerated to identical baselines; that run was discarded).
2. **Font gate**: `document.fonts.ready`, computed body stack contains `HarmonyOS Sans SC`, `fonts.check` true for 400 and 500 — else `EXPERIMENT_INVALID` stop. 24/24 pass.
3. **Style proof**: computed styles for tier targets (must differ) and external targets (must be identical); `table-th` is the D4 guard — any movement is `CROSS_VARIABLE_CONTAMINATION`.
4. **Structural sweep**: document horizontal overflow, governed-table overflow attrs, first-rows heights, last-cell reachability; known Phase-1 pill defects measured (not fixed).

## Surfaces (B4) and viewports (B5)

| Surface | Route | 1440×900 | 1100×800 | Micro |
| --- | --- | --- | --- | --- |
| Dashboard / overview | /admin/dashboard | macro + proof | — | M3a sidebar, M3b heading |
| Exam list (dense table) | /admin/exams | macro + proof | macro + proof | — |
| Question management (dense table + tags) | /admin/questions | macro + proof | macro + proof | M1 table body |
| Settings / admin form | /admin/settings | macro + proof | — | M2 form controls |
| Assignment dialog | /admin/users (teacher kebab → 分配课程教师) | macro + proof | — | — |
| Candidate exam runtime | /exam/:attemptId/take | macro + proof | — | M4 question card |

24 contexts total (each surface×variant is a fresh context with identical login/navigation code paths; pairs are captured back-to-back).
