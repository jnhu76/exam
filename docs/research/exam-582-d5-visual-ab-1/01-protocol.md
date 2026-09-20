# 01 — Protocol

Controlled A/B for D5 (StatusBadge physical height): height 22px vs 24px. The question under adjudication (issue #582): **with the frozen upstream D2 body/control typography (15px) and the frozen upstream D4 governed table header (13px/20px/500), which StatusBadge physical height gives better Chinese glyph breathing room, vertical centering, adjacent-text alignment, row rhythm and semantic-state visibility without creating unnecessary visual weight or increasing dense-table geometry.**

## Experiment law

Only `[data-slot="status-badge"]`'s `height` changes between the arms. Everything else — build, seed, routes, DOM state, user, browser, viewport, DPR, zoom, font family/loading, badge typography (12px/500/16px line-height), inline padding (8px), gap (6px), radius (6px), border (1px), colors, icon policy, cell padding, row CSS, column widths, table layout — is the identical product.

### Common frozen baseline (both arms): upstream D2 = 15px

Production has **not** implemented D2 yet, so the same convergence-up block proven in the D2/D4 campaign is injected byte-identically in **both** arms (body typography recipes and governed table cells raised onto the product's existing 15px `text-sm` control tier):

```css
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
```

The style proof re-verifies the absolute baseline per capture: table cells and representative sidebar/control targets must compute **15px in both arms** — otherwise `EXPERIMENT_INVALID_D2_BASELINE` and no evidence is packaged.

### Frozen upstream D4 baseline (both arms): 13px/20px/500 table header

D4 is production as-built, so it is **verified, not injected**: every capture asserts `table-head` computes 13px font-size / 20px line-height / 500 weight — otherwise `EXPERIMENT_INVALID_D4_FROZEN`. D5 is judged against this header, never against a reinterpreted one.

### D5 variable (the only cross-arm difference)

```css
[data-slot="status-badge"] { height: <candidate rem> !important; }
```

22px = 1.375rem (the current recipe value), 24px = 1.5rem. Which letter (X/Y) carries which value is sealed in `validity/variant-map.json` only.

### Frozen badge constants (product values, never injected)

- `font-size: 12px` / `font-weight: 500` / `line-height: 16px` (Tailwind `text-xs font-medium` on the component)
- `padding-inline: 8px` (`px-2`), `gap: 6px` (`gap-1.5`), `border-radius: 6px` (recipe; D3 radius is UNDECIDED and stays frozen-as-environment), `border: 1px`
- tone colors and background fills (badge recipes), icon policy (`statusMeta.iconPolicy`)
- D3 (radius) and D6 (TagBadge) are NOT touched: radius is identical in both arms, and TagBadge is explicitly probed for non-contamination (below).

## Badge height meets row height as evidence, not a defect to repair

No row height, cell padding, column width or table geometry value is compensated anywhere in the harness. Row growth caused by the taller candidate is legitimate D5 evidence (the §16 density guard) and is recorded by the structural sweep; badge clipping, cell/border collisions and action-column reachability are recorded, never repaired.

## Instance authority and exclusions

Only real `[data-slot="status-badge"]` elements are measured. The full render-site survey and classification live in `validity/instance-inventory.json`. Badges that only look similar are excluded by construction: TagBadge (`data-slot="tag-badge"`), the shadcn Badge role pills on the users page, the audit-log action pill, and page-local metadata chips are never measured. Icon-bearing coverage comes from the recovery queue, where `incidentOpen` (iconPolicy "show") renders by default next to text-only badges in the same rows — generated through real product APIs (attempt start + incident create), not manufactured DOM.

## Blinding (hardened after D2/D4)

- `validity/variant-map.json` is written by an independent `crypto.randomInt(2)` coin flip (fresh for D5; the D2/D4 assignments carry no forward assumption) and is the **only** place the X↔px assignment exists.
- The judge bundle (`judge/`) and the validity bundle (`validity/`) are **physically separated directories**. Judge-facing files (README, contact sheets, raw captures, 04-judge-handoff.md) carry letters only and contain no candidate values, no "current/candidate" language and no size-direction hints; `validity/style-proof.json` records computed px per letter and opens with an explicit `VALIDITY ONLY — MAPPING REVEALING` warning.
- The tie rule (**current value wins ties**) is applied ONLY after unblinding, mechanically, if the blind judge returns `NO_CLEAR_WIN`.

## Gates per capture

0. **Static-DOM reconciliation (before any capture)**: the canonical demo seed leaves live candidate attempts that the E2E heartbeat disruption scanner keeps re-alerting, appending incidents to the recovery queue mid-capture; `beforeAll` terminates every exposed live attempt via the real recovery force-submit command and requires two consecutive scanner periods (16s) with zero live attempts (`EXPERIMENT_INVALID` otherwise). The queue's existing incidents remain as static rows and cannot grow during captures.
1. **Injection gate**: the variant `<style>` must exist inside `<head>` with an `!important` height rule — otherwise `EXPERIMENT_INVALID`.
2. **Font gate**: `document.fonts.ready`, computed body stack contains `HarmonyOS Sans SC`, `fonts.check` true for 400 and 500 — else `EXPERIMENT_INVALID` stop.
3. **Representation gate**: the governed table must actually render (header row laid out). At the primary viewports a non-rendering governed table is `EXPERIMENT_INVALID`; at the 1023 boundary it is recorded as `RESPONSIVE_REPRESENTATION_CHANGE` and excluded from the evidence set.
4. **D2 baseline proof (absolute)**: `table-cell` and representative sidebar/control targets compute 15px in both arms.
5. **D4 frozen proof (absolute)**: `table-head` computes 13px/20px/500 in both arms.
6. **D5 style proof (instance-level)**: per capture, the first 3 visible badges record tone, geometry attribute, text, icon presence, computed height, bounding box, font-size, weight, line-height, padding, gap, radius, border width; across arms the height must move and every other recorded property must be identical (`CROSS_VARIABLE_CONTAMINATION` otherwise).
7. **Width guard (§17)**: badge bounding width and status-cell width must be identical across arms within 1px — a height-only change cannot legitimately move width.
8. **TagBadge non-contamination (§18)**: on the questions workbench, `[data-slot="tag-badge"]` must be identical across arms at its product values (22px height / 400 weight / 4px radius) — D5 must not pre-empt D6.
9. **Structural sweep (§16)**: document overflow, table scroll state, header/body column alignment, header row height (Range line-box wrap detector as contamination guard), per-row heights, visible row count, rendered badge count, action-column reachability. Recorded, never repaired.

## Surfaces

| Surface | Route | Archetype | Rationale |
| --- | --- | --- | --- |
| Exam list | /admin/exams | management-list | lifecycle status badges (draft/published/closed), text-only, multiple tones and label widths |
| Grading queue | /admin/grading-queue | management-list | grading-status vocabulary (pending_manual warning, auto-graded rows) |
| Recovery queue | /admin/recovery | log-diagnostic | icon-bearing incidentOpen badges next to text-only attempt badges in the same rows; maximally dense diagnostic archetype |
| Users | /admin/users | management-list | active (success) / inactive (muted) account statuses |
| Scores | /admin/exams/:id/scores | management-list | not_passed (destructive) pass/fail statuses |
| Questions (probe only) | /admin/questions | workbench grid | TagBadge non-contamination probe; no judged captures |

All five judged surfaces are high-information and carry real seeded status vocabulary across 5 of 6 tone classes plus the icon-bearing class (§12); no low-information surface was added. The per-instance classification (including every excluded render site and lookalike) is recorded in `validity/instance-inventory.json`.

## Viewports

| Viewport | Role |
| --- | --- |
| 1440 × 900 | primary adjudication |
| 1100 × 800 | density-sensitive repeat |
| 1023 × 800 | boundary condition (1px below the `lg` breakpoint; admin sidebar leaves the flow) |

### 1023 boundary expectation

The `management-list` shells (exam list, grading queue, users, scores) switch to a pure-CSS mobile card representation below `lg` (desktop table subtree `display:none`) — those surface/viewport combinations are recorded as `RESPONSIVE_REPRESENTATION_CHANGE` and are not used as D5 table evidence. The `log-diagnostic` archetype (recovery queue) keeps the governed table with horizontal scroll below `lg`, so recovery-queue at 1023 remains valid — and maximally density-stressed — D5 evidence.

## Pairwise discipline

Each surface×variant is a fresh context with identical login/navigation code paths; pairs are captured back-to-back so temporal drift inside a pair is seconds. Both arms see the same build, seed, routes, default sorting/filters/pagination (no interaction), no dialogs, no row selection, same scroll anchoring, same viewport, DPR, zoom and font path.
