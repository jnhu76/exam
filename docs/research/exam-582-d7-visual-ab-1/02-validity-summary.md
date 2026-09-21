# 02 — Validity Summary

Mapping-free validity statement for the D7 pack. The detailed computed records live in `validity/style-proof.json` (validity-only; do not provide to the blind judge). Letters X/Y appear here only as arm labels; no background tier is bound to a letter anywhere in this file.

## Verdict

```text
as-built surface split verified:        PASS  (authority gate — modal/panel computed background equals
                                              the canvas token resolution; popover/dropdown/select
                                              containers equal the content token resolution, clean
                                              product, no injection; AUTHORITY_MISMATCH never fired)
D2 baseline 15px in both arms:          PASS  (15/15 baseline pairs, 0 violations, absolute check)
D3 family radius 6px in both arms:      PASS  (32/32 family pairs, 0 violations, absolute check)
D4 frozen upstream 13px/20px/500:       PASS  (5/5 header pairs, 0 violations, absolute check)
D5 frozen upstream 22px/12px/500:       PASS  (4/4 badge pairs, 0 violations, absolute check)
D6 frozen upstream weight 500:          PASS  (1/1 probe pair, 0 violations, absolute check)
D7 candidate reached computed style:    PASS  (9/9 modal/panel pairs moved, 0 static; the two arm values
                                              equal the two token resolutions as a set)
single-variable background isolation:   PASS  (9/9 pairs moved in background-color ONLY; radius, shadow,
                                              border, padding, typography, opacity, variant attributes all
                                              identical in every pair)
overlay dim invariant (§18):            PASS  (9/9 dimmer pairs identical: computed background + opacity)
shadow invariant (§19):                 PASS  (box-shadow in the controlled set of every d7 target — any
                                              movement would have failed the single-variable gate)
radius invariant (§20):                 PASS  (dialog/sheet/small-overlay radius identical across arms;
                                              D3 radius did not leak into the modal decision)
panel-edge invariant (§21):             PASS  (sheet edge attribute + border widths/colors identical;
                                              edge = the page-meeting edge, as-built "right" for a
                                              side="left" drawer)
small-overlay non-contamination (§5):   PASS  (7/7 overlay pairs identical across arms; containers at the
                                              content-token resolution in both arms)
geometry (§17):                         PASS  (99 pairwise bounding comparisons + scroll ownership — all
                                              deltas 0.0px, dialog-body scrollHeight/clientHeight identical)
interaction (§23):                      PASS  (9/9 state pairs: Escape close, close control visible, focus
                                              contained after 8 Tabs, body scroll lock active — identical
                                              in both arms)
cross-variable contamination:           NONE  (0 non-d7 targets moved in any property)
font invariant:                         PASS  (29/29 capture gates, HarmonyOS Sans SC)
Sheet coverage (§10):                   PASS  (mobile nav Sheet captured at 1023×800 in both arms: macro
                                              with page beside the drawer + native panel-edge crops)
```

## What was proved, per gate

**Static-DOM reconciliation (before any capture).** The canonical demo seed's live candidate attempts are terminated through the real recovery force-submit command and two consecutive quiet scanner periods (16s each) are required, so the page-behind DOM cannot change between arms. Invalidated run 4 documents the bound raised to 8 cycles when a noisy reseed needed longer to settle.

**Authority gate (§2, clean product).** Before any arm ran, the clean product was inventoried at every overlay family reachable in product routes: the three included modal/panel consumers, their dimmers, and the role SelectContent, RowActions DropdownMenuContent and tag-filter PopoverContent (12 recorded rows). Browser computed style is the authority: modal/panel computed background equals the canvas token resolution, small-overlay containers equal the content token resolution — else `AUTHORITY_MISMATCH` STOP. The gate passed; the as-built split matches `recipes.css` exactly.

**Common frozen baselines (absolute, both arms).** D2 (15px), D3 (6px control family) and D6 (500 TagBadge) are injected byte-identically in both arms via the blocks proven in the D2–D6 campaign; every rendered family target computed the absolute in both arms (15/15, 32/32, 1/1 pairs). D4 (13px/20px/500) and D5 (22px/12px/500) are production as-built and verified per capture (5/5, 4/4 pairs). `EXPERIMENT_INVALID_UPSTREAM_BASELINE` never fired on the packaged run.

**Single-variable background isolation.** On every judged pair (4 dialogs × 2 viewports + Sheet = 9 pairs), the modal/panel moved in `background-color` and in nothing else — 9/9 moved, 0 static, and the two arm values equal the two token resolutions as a set (both candidates reached computed style). The pairwise sweep found zero non-d7 targets moving in any property (contamination NONE): typography, badges, controls, page cards, sidebar, dimmers, chassis anchors and small overlays were byte-stable across arms.

**Dim / shadow / radius / panel-edge invariants.** The dimmer (`bg-black/50`) computed background and opacity are identical in 9/9 pairs (§18 — dimming dominates perceived hierarchy, so it must not move). Box-shadow and radius are members of the controlled property set of every d7 target; the single-variable gate proves them identical (§19/§20). The sheet's panel edge — attribute, 1px width, edge color, zeroed other edges — is identical across arms while its background moves (§21).

**Small-overlay non-contamination (§5).** SelectContent (opened INSIDE the create-user dialog), DropdownMenuContent (RowActions kebab on a real candidate-fields row) and PopoverContent (tag filter) were probed in both arms: 7/7 pairs identical in background, radius, shadow and every recorded property; the overlay containers additionally sit at the content-token resolution in both arms. D7's injection targeted only the modal/panel recipe selectors and demonstrably did not touch the base overlay tier.

**Geometry guard (§17).** 99 pairwise bounding comparisons across every oracle target (modal/panel contents, dimmers, chassis anchors, controls, page targets): Δx/Δy/Δwidth/Δheight all 0.0px. The import dialog's `dialog-body` scroll owner recorded identical scrollHeight/clientHeight in both arms; the sheet's width and edge are unchanged. Background is paint-only — confirmed.

**Interaction proof (§23).** In both arms, on every judged surface: Escape closes the modal/drawer, the close control is visible (X on dialogs, the drawer's close button on the Sheet), focus remains contained after 8 Tabs, and the body scroll lock is active. 9/9 state pairs pairwise identical — D7 cannot affect behavior by construction, and the probe confirms it empirically.

**Font gate.** Before every capture: `document.fonts.ready` awaited, `fonts.load` 400/500, computed body stack contains HarmonyOS Sans SC — 29/29 gates PASS.

**Injection gate.** Every arm capture verified the variant `<style>` installed inside `<head>` with the `background: var(--…)` `!important` rule. The common baseline blocks are present in both arms, so a silent no-op injection cannot masquerade as evidence — and the d7 single-variable gate additionally requires the arm values to equal the two token resolutions as a set.

## Known non-findings (expected absences, not gaps)

- `external` tier pair rows are 0 by construction: page-context facts (table cells, headers, badges, sidebar) are all claimed by the frozen-tier guards they belong to; nothing on these surfaces is "untouched context" in the record sense, and the body stack is gated by the font gate.
- Tooltip/Toast/ContextMenu control probes are not exercised: no reproducibly reachable product instance exists on the captured surfaces; they stay excluded by construction (`.surface-overlay` base tier) and the injection demonstrably cannot reach them (it targets the modal/panel variant selectors only).
- The 1023 boundary viewport is used ONLY for the Sheet (§22): below `lg` the admin dialogs' host pages switch to card representations and the product does not render the desktop dialogs there; forcing them would not be product truth.

## Boundary representation record

Sheet evidence at 1023×800 is labelled separately (`sheet-nav-*`) and never mixed with the desktop dialog pairs; the drawer is the real active panel representation at that width, captured with the page visible beside it (§11/§12/§13 relational cases are all covered: white-card backdrops under both create dialogs, the canvas-heavy sectioned page under the destructive confirmation, and the below-lg card page beside the drawer).
