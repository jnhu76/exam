# EXAM #582 — Final Runtime Visual Baseline

MASTER_SHA:
144d212fb5dec77d10acea5170b6362d90e7762a

CAMPAIGN:
VISUAL_ADJUDICATION_COMPLETE
IMPLEMENTATION_MERGED
FINAL_RUNTIME_BASELINE_PENDING_REVIEW

Purpose: prove `frozen research truth = merged production runtime truth` and
establish the visual baseline #590 must build on. Task
`EXAM-582-FINAL-RUNTIME-VISUAL-BASELINE-1` — no design decisions were made
here; D2–D7 are closed.

## Environment

```text
browser         Chromium 149.0.7827.55 (Playwright 1.61.0)
viewports       1440x900 primary, 1100x800 desktop band, 1023x800 Sheet
DPR             1
zoom            100%
theme           light
locale          zh-CN (single supported locale)
font            production HarmonyOS Sans SC path (/fonts/harmonyos-sans-sc/)
seed            canonical E2E seed (apps/api e2e-seed.ts, reset:true) on
                exam_e2e @ localhost:5432; APP_MODE=e2e; API dev server :3000
                serving the production build of apps/web (dist -> api/public)
```

## Runtime settlement

Machine-readable truth: [final-runtime-oracle.json](final-runtime-oracle.json).
Values below are resolved computed styles from real rendered elements.

### D2 — PASS

| Selector | fontSize | lineHeight | fontWeight |
| --- | --- | --- | --- |
| `.type-page-description` | 15px | 22px | 400 |
| `.type-body` | 15px | 22px | 400 |
| `.type-secondary` | 15px | 22px | 400 |
| `[data-slot="table-cell"]` | 15px | 22px | 400 |

`.type-long-response`: static owner
(`apps/web/src/typography/recipes.css`) is 15px (0.9375rem) as frozen. Runtime
instance GAP: the only consumer (grading detail) has no canonical-seed entry —
the grading queue is empty under the E2E seed — so no product surface rendered
the recipe in this run. Carried as a coverage gap, consistent with the
campaign's other recorded gaps.

### D3 — PASS

All primary-control semantic family members resolve to 6px:

```text
Input / SelectTrigger / Textarea   6px (control/recipes.css 0.375rem)
Button family                      6px (rounded-md; sampled default, primary,
                                   outline, secondary, ghost across login,
                                   toolbar, form, dialog, alert-dialog)
AlertDialog trigger/cancel/action  6px (Radix Slot composition; trigger keeps
                                   data-slot="button", action/cancel render
                                   their alert-dialog slot names)
```

The D3 caveat is settled: no Slot consumer silently remains at 8px.

### D4 — PASS / unchanged

```text
[data-slot="table-head"]: 13px / 20px / 500   FROZEN_AS_BUILT
owner diff vs pre-#595 (3744fd90): UNCHANGED — #595 touched only the
[data-slot="table-cell"] font-size in the same file
```

### D5 — PASS / unchanged

```text
[data-slot="status-badge"]: height 22px, radius 6px, size 12px
                            FROZEN_AS_BUILT
owner diff vs pre-#595: UNCHANGED — #595 touched only the TagBadge blocks in
badge/recipes.css
```

### D6 — PASS

```text
[data-slot="tag-badge"][data-tag-variant="compact-table"]:
  instance count 20, font-weight 500, 12px / 18px,
  rendered width 35–81px (width variation is not a failure)
DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP (carried forward; no real product
consumer of the default variant exists on master; none fabricated)
```

### D7 — PASS

```text
Dialog content       rgb(255,255,255) = resolved var(--surface), radius 8px
AlertDialog content  rgb(255,255,255) = resolved var(--surface), radius 8px
Sheet content        rgb(255,255,255) = resolved var(--surface), radius 0,
                     left panel edge owned
small overlays       DropdownMenuContent 6px / SelectContent 8px on the same
                     background — base-overlay contract retained; the family is
                     single-tier on background with radius/shadow/edge carrying
                     the distinction, exactly as the D7 contract wrote it
```

### Overlay dimmer — UNCHANGED

```text
Dialog / AlertDialog / Sheet overlay: oklab(0 0 0 / 0.5)
(black / 50% equivalent; not modified by this task or by #595)
```

### Font truth — PASS

```text
font loaded            YES
expected face(s)       400 loaded, 500 loaded
runtime fallback       NONE (body family "HarmonyOS Sans SC", …)
```

## Product surfaces captured

| Surface | Route | Viewport |
| --- | --- | --- |
| B1 dashboard | /admin/dashboard | 1440×900 |
| B2 exam dense table | /admin/exams | 1440×900, 1100×800 |
| B3 question management | /admin/questions | 1440×900, 1100×800 |
| B4 users | /admin/users | 1440×900 |
| B5 relation/datetime tables | /admin/recovery, /admin/audit-logs, /admin/courses | 1440×900 |
| B6 form page | /admin/questions/new | 1440×900 |
| B7 create dialog | /admin/users (新增用户 Dialog + Select) | 1440×900 |
| B8 destructive AlertDialog | /admin/courses row delete | 1440×900 |
| B9 candidate runtime | /exam/list → start → take (candidate2); result (candidate4) | 1440×900 |
| B10 mobile Sheet | admin nav Sheet | 1023×800 |

Additional captures: exams kebab dropdown (small overlay), users-dialog select
dropdown, candidate account-menu dropdown. SHEET_VISUAL_SIGNAL = WEAK caveat
carried (historical sensitivity note, not a failure).

## Known downstream defect (#590) — fresh post-D2 measurements

Full classified instances live in [final-runtime-oracle.json](final-runtime-oracle.json);
native-pixel visual evidence in [final-baseline-table-micro.png](final-baseline-table-micro.png).

```text
role pill (考试管理员)   /admin/users — pill crosses the 角色/状态 shared
                         border by 6.5px into the neighbor cell padding zone
                         (cell 88px, pill 78px, 16px inline padding)
                         = CROSS_CELL_BOUNDARY, reproduced
date range               /admin/exams — all 4 rows' nowrap range text spills
                         11.5px into the 时长 column padding zone, identical
                         at 1440 and 1100 = CROSS_CELL_BOUNDARY, reproduced
relation (1 条关联)      /admin/recovery — 71px cell vs 72px content
                         = CROWDED_BUT_CONTAINED
long datetime            /admin/recovery, /admin/audit-logs — fits
                         = CROWDED_BUT_CONTAINED
tag cluster              /admin/questions — 2-tag clusters contained
                         = NO_DEFECT; 3+ cluster and +N chip: no canonical-seed
                         instance (coverage gap, not fabricated)
```

Severity was re-measured under the final 15px typography, not inherited from
pre-D2 numbers. The role-pill and date-range crossings do not collide with
neighbor glyphs (both stop inside the neighbor's padding zone) but they do
cross the shared cell border. No #590 fix was applied here.

## New regressions

```text
NONE
```

Surfaces inspected for #595-introduced breakage: row-height growth, button
radius inconsistency, form alignment, TagBadge cluster wrapping, modal
hierarchy, candidate-runtime wrapping, focus rings, Sheet panel — no
regression found. One separately-known pre-existing issue recorded, not
introduced by #595 and not fixed here:

- destructive-confirm palette: the course-delete AlertDialog action renders
  `bg-primary` (blue) at runtime despite `confirm.destructive: true`
  (Button-asChild Slot variant composition in ConfirmDialog). Predates #595,
  which changed radius classes only.

## Evidence

```text
final-baseline-contact-sheet.png   10 labeled panels (B1–B10)
final-baseline-table-micro.png     native-pixel #590 cell-fitting strips
final-runtime-oracle.json          machine-readable settlement facts
```

Raw screenshots were kept out of the repository (local research apparatus
only). SHA256 of the committed PNGs:

```text
final-baseline-contact-sheet.png  ae7c038d4ca4e8a38be939f94b0b14d970099d62de207e6f2f5633c121b0f206
final-baseline-table-micro.png    4f87193152420ca7d26c3d1272a361e4cec14413242fde0700ab9eab5dbb846c
```
