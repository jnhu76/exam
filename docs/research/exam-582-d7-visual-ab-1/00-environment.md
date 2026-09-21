# 00 — Environment

EXAM-582-D7-VISUAL-AB-1 · blind A/B evidence generation for D7 (Dialog / Sheet modal-surface background tier), Stage B of the #582 campaign. Evidence only — no D7 value is chosen here, no production visual file changes, D2–D6 are treated as frozen upstream authorities, #582's decision table is not updated, #590 is not touched.

## SHA authorities

| Field | Value |
| --- | --- |
| D7_BASE_SHA (product under test) | `e6d683cc8731030fea10632a407df270673d1c83` — exact remote tip of `research/582-d3-visual-ab-1` at task handoff (PR #592 NOT yet merged; per the base-selection contract the branch was cut from the D3 freeze tip, not from older master, so D3/D6 freeze authority is preserved). Every `apps/web`, `apps/api`, `packages/**` production file is byte-identical to that tip; the branch adds evidence + harness files only |
| UPSTREAM FREEZE AUTHORITY | D2 = 15px (PR #589 campaign freeze) · D4 = 13px/20px/500 (as-built) · D5 = 22px (PR #591 freeze) · D6 = 500 · D3 = 6px (PR #592 evidence, unmerged at handoff) |
| D7_BRANCH | `research/582-d7-visual-ab-1` (temporary evidence branch; not a production authority) |

## Component / recipe authority (verified on the base SHA)

- Recipe: `apps/web/src/surface/recipes.css` — `.surface-overlay` base = `background: var(--surface)`; `[data-overlay-variant="modal"]` = `background: var(--bg)` + `border-radius: var(--radius)` + lg elevation; `[data-overlay-variant="panel"]` = `background: var(--bg)` + zero radius/border + one border edge per `data-overlay-panel-edge`. The canvas tier is therefore the CURRENT value; the content tier is the candidate. D7 candidates are semantic tokens (`--bg` = rgb(245, 247, 250) canvas, `--surface` = rgb(255, 255, 255) content) — no literal hex anywhere.
- Consumers: `dialog.tsx` (`data-slot="dialog-content"` + `data-overlay-variant="modal"`), `alert-dialog.tsx` (`data-slot="alert-dialog-content"` + modal), `sheet.tsx` (`data-slot="sheet-content"` + panel). All verified at runtime by the as-built inventory.
- Sheet panel edge (as-built, §21): a `side="left"` drawer meets the page on its RIGHT edge — `sheet.tsx` maps side → the border-bearing meeting edge, so `data-overlay-panel-edge="right"`.
- Cascade fact: `recipes.css` is unlayered (imported directly by `main.tsx`), so the panel recipe beats the layered `bg-sidebar` utility on the mobile-nav drawer. The drawer's computed background is the recipe's token in both arms; the consumer utility loses by construction (as-built fact, recorded in the inventory, not repaired here).
- Dimmer: `bg-black/50` on `[data-slot="dialog-overlay"]` / `[data-slot="sheet-overlay"]` — not adjudicated by D7, proved invariant per pair.

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d7-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real product APIs: a course + tagged question + PUBLISHED exam (the unpublish confirm only exists on a published exam — D3 pattern), and a candidate field (gives `/admin/candidate-fields` a real row whose RowActions kebab opens the DropdownMenuContent control probe). The import wizard's CSV preview is driven by typing the same CSV into the real textarea in both arms; the rows are never confirmed, so no candidate is created.
- Server kept after run: API dev server :3001 serving the built SPA.
- **Invalidated runs (never packaged)**:
  1. Run 1 (bring-up): tests 1–2 green; the sheet capture threw `EXPERIMENT_INVALID: sheet panel edge is right, expected left`. Root cause: the harness's own constant was wrong — `sheet.tsx` maps `side="left"` to the page-meeting RIGHT edge, so the as-built attribute is `right`. The product was correct; the constant was fixed and the run discarded.
  2. Run 2 (canonical): tests 1–3 green; the validity-only questions probe failed with `no d7-tier overlay rendered on questions-d6` — `verifyFrozenBaselines` unconditionally required a modal/panel target on a PAGE probe that carries no overlay. Fixed with an explicit `expectOverlay` parameter; run discarded.
  3. Run 3: all four tests green, but post-run inspection of the validity artifacts exposed an ANALYTICS defect: as-built inventory captures (phase `asbuilt`, stamped variant `X` for record typing) were picked by the unfiltered capture finders, so pair diffs compared the CLEAN PRODUCT (8px button radius, 14px table cells, canvas-tier default) against arm Y — 11 phantom "contamination" violations. The per-capture gates had correctly proven every arm capture applied its baselines; the pairwise builders alone were poisoned. Fixed with a phase filter in both pair/geometry pickers (plus a corrected guard: the small-overlay token absolute applies to overlay CONTAINERS only — select/dropdown items carry the product's own subtle item fill, whose cross-arm identity is their contract); run discarded.
  4. Run 4: failed before any capture — the static-DOM reconciliation did not reach two quiet scanner periods within 4 cycles on a noisy freshly reseeded server (the escalating disruption scanner re-alerts the demo seed's live attempts for ~45s+ each). The loop bound was raised to 8 cycles with the same strict two-consecutive-quiet-periods requirement; run discarded.
  5. Run 5: the packaged evidence — all four tests green, every validity guard green (see `02-validity-summary.md`).
  - All earlier runs' outputs stayed in `.tmp/`.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 |
| Viewports | 1440×900 (primary), 1100×800 (density repeat) for dialogs; 1023×800 for the Sheet only (below-lg, where the mobile nav drawer is the real active panel — §22) |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` |
| Font | Production HarmonyOS Sans SC self-hosted path (cn-font-split subsets); per-capture font gate: `document.fonts.ready` + `fonts.load`/`fonts.check` 400/500 + computed stack contains `HarmonyOS Sans SC` — 29/29 gates PASS (see `validity/style-proof.json` guards) |
| User | Same admin account for all surfaces |
| Capture scale | 18 judged macro captures (9 surface×viewport pairs × 2 arms: 4 dialogs × 2 viewports + Sheet × 1) + 34 native-pixel micro crops (17 pairs) + validity-only probes (select/dropdown/popover contents, TagBadge) |

## Variant assignment (sealed)

- Two arms: modal/panel `background` at the canvas tier (`var(--bg)`, current recipe value) and at the content tier (`var(--surface)`, candidate), judged against the frozen upstream baselines established/verified per capture in BOTH arms.
- Which letter (X/Y) carries which tier is persisted ONLY in `validity/variant-map.json` (independent crypto coin flip at pack creation; no forward assumption from the D2–D6 assignments).
- Capture order interleaves per surface (X then Y back-to-back in fresh contexts) so temporal drift inside a pair is seconds; both variants see the same build, seed, routes, dialog content (the import CSV is typed identically), user, browser, viewport, DPR, zoom and font path.
- **Blinding discipline**: judge-facing files live under `judge/` (plus the mapping-neutral `04-judge-handoff.md`) and carry letters only — no tier names, no "current/candidate" language, no color-direction hints (permanent rule after the D4 interpretation-direction incident). Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning. The pack author performed no visual inspection of X/Y pairs before handoff; sheet integrity was verified mechanically (image dimensions, pair counts, non-empty renders).
