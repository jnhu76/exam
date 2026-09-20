# 02 — Validity Summary

Mapping-free validity statement for the D4 pack. The detailed computed-px records live in `validity/style-proof.json` (validity-only; do not provide to the blind judge). Letters X/Y appear here only as arm labels; no candidate value is bound to a letter anywhere in this file.

## Verdict

```text
D2 baseline 15px in both arms:        PASS  (37/37 baseline pairs, 0 violations)
D4 candidate reached computed style:  PASS  (9/9 table-head pairs moved, 0 static)
header line-height invariant (20px):  PASS  (9/9 pairs, both arms)
header weight invariant (500):        PASS  (9/9 pairs, both arms)
font invariant:                       PASS  (24/24 capture gates)
cross-variable contamination:         NONE  (0 non-table-head targets moved)
pairwise DOM consistency:             PASS  (row sets, row heights, header heights,
                                             column alignment identical across arms)
```

## What was proved, per gate

**Common D2 baseline (absolute).** Both arms carry the byte-identical 15px convergence block (body recipes + governed table cells onto the existing `text-sm` control tier). Every baseline target — table cells, sidebar nav items, toolbar buttons, the questions search input, page secondary copy — computed **15px in both arms** across all four surfaces and all three viewports (37 complete pairs; zero violations). `EXPERIMENT_INVALID_D2_BASELINE` never fired: D4 is judged relative to the frozen 15px body, not to production's mixed typography.

**Single-variable isolation.** On every governed-table pair (4 surfaces × 1440 + 4 × 1100 + audit-logs × 1023 = 9 pairs), `table-head` moved in `font-size` between the arms — and in nothing else: line-height stayed 20px, weight 500, and family/color/letter-spacing/padding/background/border were identical across arms in all 9 pairs.

**Cross-variable contamination.** No non-`table-head` target (body copy, headings, cells, sidebar, buttons, inputs, secondary text) moved in any computed property between the arms — the two arms differ by exactly one declaration.

**Font gate.** Before every capture: `document.fonts.ready` awaited, computed body stack contains HarmonyOS Sans SC, `fonts.check` true for 400 and 500 — 24/24 captures (the production self-hosted font path, no font experiment).

**Injection gate.** Every capture verified the variant `<style>` installed inside `<head>` with an `!important` font-size rule; the D2 baseline block is present in both arms, so a silent no-op injection cannot masquerade as evidence.

**Pairwise consistency.** Fresh context per capture with identical login/navigation code paths; pairs captured back-to-back; default sorting/filters/pagination, no dialogs, no selection. Structural pairwise checks found zero cross-arm differences in body row heights, header row heights, column alignment and table width.

## Known non-findings (expected absences, not gaps)

- `body` style-proof pairs are incomplete by a DOM artifact: `document.body.offsetParent` is null by spec, so the visibility filter skips it. The body stack is instead gated per capture by the font gate (24/24).
- `input` exists only on the questions workbench (search field) and `sidebar-link` is absent at 1023 (admin sidebar leaves the flow below `lg`) — both recorded as absent rather than forced.

## Boundary representation record

1023×800 is valid D4 table evidence **only for audit-logs**: the `management-list` shells (exam list, questions, users) switch to a pure-CSS mobile card representation below the `lg` breakpoint, hiding the desktop table. Those surface/viewport combinations are recorded as `RESPONSIVE_REPRESENTATION_CHANGE` (6 records in `validity/structural.json`) and are excluded from the evidence set and from the contact sheets.
