# 00 — Environment

EXAM-582-D3-VISUAL-AB-1 · blind A/B evidence generation for D3 (primary control family radius 6px vs 8px), Stage B of the #582 campaign. Evidence only — no D3 value is chosen here, no production visual file changes, D2/D4/D5/D6 are treated as frozen upstream authorities, D7 not touched, #590 (dense-table cell fitting) not exercised.

## SHA authorities

| Field | Value |
| --- | --- |
| D3_BASE_SHA (product under test) | `7ee7905d450e7e0232c2f69f741e172e85775373` — the D6 freeze commit. The D6 freeze (`docs(research): unblind and freeze D6 = 500`) had **not** been merged to `origin/master` at task handoff (master stood at `09bf4c46562a26f92c1f0a5fc508558d4d70e913`), so per the task law the branch starts directly from the D6 freeze commit: it contains the frozen D6 decision and changes no production visual file. Every `apps/web`, `apps/api`, `packages/**` production file on this branch is byte-identical to master. |
| D6_FREEZE_ANCESTOR | `false-but-direct-base` (see above) |
| UPSTREAM FREEZE AUTHORITY | D2 = 15px body/control (PR #589), D4 = 13px/20px/500 table header (PR #588/#589), D5 = 22px StatusBadge (PR #591) — production as-built on the base SHA; D6 = 500 TagBadge weight (7ee7905d) — injected identically in both arms |
| D3_BRANCH | `research/582-d3-visual-ab-1` (temporary evidence branch; not a production authority) |
| D3_HEAD_SHA | recorded at commit time in the final handoff |

## Component / recipe authority (verified on the base SHA, then by computed styles)

- Source split: `apps/web/src/control/recipes.css` owns `border-radius: 0.375rem` for `[data-slot="input"]`, `[data-slot="select-trigger"]`, `[data-slot="textarea"]`; `apps/web/src/components/ui/button.tsx` owns `rounded-lg` (0.5rem) on the `buttonVariants` base (every size). Browser computed style is the final authority — the §2 as-built inventory pass re-proved the 6/8 split per route with zero mismatches (`validity/as-built-radius-inventory.json`, `asBuiltSplit.verified = true`).
- **As-built DOM discovery — the composite seam is dead CSS (§4/§9):** the task brief assumed the quiet toolbar renders joined filters (`[data-slot="toolbar-filters"]` direct children at radius 0, `COMPOSITE_INTERNAL_SEAM`). No component emits that slot anywhere in `apps/web/src` — the seam rules in `control/recipes.css` (lines 72–101, inside `@media (min-width: 64rem)`) match nothing at runtime. The current `DataToolbar` renders filters as standalone `ToolbarFilter` wrappers (issue-458 evolution). The seam-preservation rule is kept in BOTH arms as a guard, the oracle proves absence per capture (`composite-seam-proof.json`: 18 selector pairs, absent in both arms everywhere), and quiet-toolbar controls are probed as the standalone family members they now are. The dead block's fate is a recorded follow-up for a D3 production implementation — NOT exercised here (production CSS untouched).
- **As-built DOM discovery — Radix Slot slot-name precedence:** three confirm-dialog buttons never carry `data-slot="button"` because Radix `asChild` Slot composition keeps the primitive's slot name: the unpublish trigger renders `data-slot="alert-dialog-trigger"`, the confirm cancel `data-slot="alert-dialog-cancel"`, the confirm action `data-slot="alert-dialog-action"` — all styled by `buttonVariants` (radius source `rounded-lg`, as-built 8px). They are standalone family buttons (§14 C5), so the experiment's family selector names these as-built slots explicitly. Related as-built observation, recorded not repaired: the destructive action renders with the **default-variant palette** (`bg-primary …`) despite `data-variant="destructive"` — the destructive intent survives only as a data attribute (Slot class precedence); a D7/D-product follow-up may want to reconcile this.
- Production D2 state: `.type-body` et al. compute 14px (`typography/recipes.css` `0.875rem`), so the frozen 15px D2 baseline is established by the proven injected common block, byte-identical in both arms. Production D6 state: TagBadge weight is 400, so the frozen 500 is established the same way. D4 (13px/20px/500 header) and D5 (22px StatusBadge) are production as-built and re-verified per capture.

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d3-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real product APIs: one course (wizard select + course workbench row), one tagged `true_false` question (score 100, tags 安全/设备维护 — validity-only TagBadge probe row), one published exam (exam-detail StatusBadge guard + the unpublish destructive confirmation). No candidates, no attempts, no enrollment — nothing mutates between the back-to-back arm captures.
- Surfaces (real product states, no invented galleries): `/admin/exams/new` wizard (dense form + product-disabled future stepper steps), `/admin/courses` (+ create-course dialog: Input + Input + Textarea + footer), `/admin/users` (+ create-user dialog: 3×Input + role SelectTrigger + footer), `/admin/exams/:id` (+ unpublish ConfirmDialog: destructive + cancel), `/admin/questions` (validity-only probe: TagBadge D6 guard + second quiet-toolbar sample; never judged per §13).
- Server kept after run: API dev server :3001 serving the built SPA.
- **Invalidated bring-up runs (never packaged):**
  1. Runs 1–2: `POST /api/exams` fixture rejected (`PASSING_SCORE_EXCEEDS_TOTAL`: passingScore 60 > totalScore 5). Fixed by adopting the proven seed shape (question score 100 / total 100 / passing 60).
  2. Run 3: dialog/overlay targets (`dialog-content`) reported not-found — the oracle's visibility filter used `offsetParent !== null`, which is always null for `position: fixed` surfaces. Fixed by judging visibility from the layout box + computed paint state.
  3. Run 4: confirm-dialog cancel not found — exposed the `alert-dialog-cancel` slot-name discovery above. Family selector extended (see §9 above).
  4. Runs 5–6: destructive action not found / unpublish trigger not converging — completed the Slot discovery (`alert-dialog-action`, `alert-dialog-trigger`); family selector extended again.
  5. Run 7: state-oracle focus pair failed on the course dialog — Radix autofocuses the first tabbable element on open and the dialog close button sits LAST in the DOM, so the course-name input opens already focused and the "resting" reference was actually focused. Fixed by blurring before the resting collection.
  6. Runs 7–8: `aria-invalid`/`disabled` expression checks raced the product's `transition-[border-color,box-shadow]` / `transition-colors` — computed values were read mid-transition. Fixed with 250ms settle waits after every state mutation. Run 8: all tier guards, contamination, geometry, seam and upstream gates green; one micro crop (`exam-create-footer-band` @1100×800) was silently dropped because the footer row sits below the fold (y=833 > 800) and the crop clamp yielded a non-positive height.
  7. Run 9: scroll-into-view before the below-fold crops — all tests green, but the visual acceptance pass flagged crop-edge slicing on the stepper/disabled-save state crops (fixed-grow windows cut a step chip and the textarea above the save button).
  8. Runs 10–11: crops re-snapped to element boundaries (whole stepper row, textarea+footer band, Field-boundary bands for the focus/invalid probes). Run 10 green; run 11 exposed the course-dialog focus pair — the earlier Radix-autofocus resting defect had been masked by the older crop path; with the blur-first resting reference the X arm's focus transition raced the oracle at 1100×800 (`transition-[border-color,box-shadow]` mid-flight). Fixed with 250ms settle waits after every focus walk.
  9. Run 12: transient WSL `net::ERR_NETWORK_CHANGED` during login navigation — environment flake, no code change, discarded.
  10. Run 13: all gates green; visual acceptance flagged the Field-band bottom edge catching the next field's label tops (fixed padBottom 0).
  11. Run 14: `table-th not visible on users` — table-query load race, fixed with explicit per-surface readiness waits (wizard title / governed table head / status badge visible before any oracle).
  12. Run 15 (final, packaged `d3-1789926694489`): **all tests and all gates pass**; judge contact sheets pass visual acceptance (no judged control sliced at any crop edge; dimmed background page content behind modal overlays is the product's overlay, not judged content). See `02-validity-summary.md`.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 |
| Viewports | 1440×900 (primary), 1100×800 (density repeat). 1023×800 excluded: below `lg` the workbenches switch card representations (`RESPONSIVE_REPRESENTATION_CHANGE` territory) and the dialog/form evidence has no need for the boundary viewport |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` |
| Font | Production HarmonyOS Sans SC self-hosted path; per-capture font gate: computed stack contains `HarmonyOS Sans SC` + `fonts.check` true for 400 AND 500 (both weights are used by the frozen tiers) — every capture passed (gate failures throw, so a completed run implies PASS; see `validity/font-gate.json` note) |
| User | Same admin account for all surfaces |
| Capture scale | 7 judged macro surfaces × 2 arms × 2 viewports = 28 macro captures + 12 validity records (as-built inventory + questions probe + select overlay); 22 native-pixel crop pairs (44 files) + contact sheets |

## Variant assignment (sealed)

- Two arms: D3 family `border-radius` 6px and 8px (D3 authority, issue #582), judged against the frozen 15px body/control baseline (upstream D2, injected identically in both arms), the frozen 500 TagBadge weight (upstream D6, injected identically in both arms), the as-built 13px/20px/500 table header (upstream D4) and the 22px StatusBadge (upstream D5), all re-verified per capture.
- Which letter (X/Y) carries which radius is persisted ONLY in `validity/variant-map.json` (independent `crypto.randomBytes` coin flip at pack creation; no forward assumption from the D2/D4/D5/D6 assignments).
- Capture order: as-built inventory first (clean product, no injection, purged from the judged record afterwards), then per viewport X then Y back-to-back in fresh contexts, so temporal drift inside a pair is seconds; both variants see the same build, seed, routes, form data, DOM state, user, browser, viewport, DPR, zoom and font path.
- **Blinding discipline**: judge-facing files live under `judge/` and carry letters only — no candidate values, no "current/candidate" language, no roundness-direction hints (permanent rule after the D4 interpretation-direction incident). Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning. The packaging step copies arm captures (X/Y files) only.
