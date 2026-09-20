# 02 — Validity Summary

Mapping-free validity statement for the D5 pack. The detailed computed-px records live in `validity/style-proof.json` (validity-only; do not provide to the blind judge). Letters X/Y appear here only as arm labels; no candidate value is bound to a letter anywhere in this file.

## Verdict

```text
D2 baseline 15px in both arms:          PASS  (48/48 baseline pairs, 0 violations)
D4 frozen upstream 13px/20px/500:       PASS  (13/13 header pairs, 0 violations, absolute check)
D5 candidate reached computed style:    PASS  (11/11 status-badge pairs moved, 0 static)
badge constants invariant both arms:    PASS  (12px / 500 / 16px line-height / 8px padding /
                                              6px gap / 6px radius / 1px border in all 11 pairs)
font invariant:                         PASS  (22/22 capture gates, HarmonyOS Sans SC)
cross-variable contamination:           NONE  (0 non-status-badge targets moved)
TagBadge non-contamination (D6 guard):  PASS  (2/2 probe pairs identical at product values)
width guard:                            PASS  (11/11 pairs — badge width and status-column
                                              width identical across arms, 0.0px delta)
pairwise DOM consistency:               PASS  (row sets, row heights, header heights, badge
                                              texts and icon sets identical across arms on
                                              every pair — see reconciliation note below)
icon-bearing coverage:                  PASS  (recovery queue renders iconPolicy-"show" badges)
text-only coverage:                     PASS  (all four other surfaces)
```

## What was proved, per gate

**Static-DOM reconciliation (gate 0).** The canonical E2E demo seed leaves live candidate attempts that the environment's heartbeat disruption scanner keeps re-alerting, appending incidents to the recovery queue mid-capture (this invalidated three earlier runs — see `00-environment.md`). The final harness terminates every exposed live attempt via the real recovery force-submit command and requires two consecutive scanner periods (16s) with zero live attempts before capturing. Row sets and badge text sets are therefore identical across arms on all 11 pairs (`rowSetChanged = 0`, badge-text diffs = 0).

**Common D2 baseline (absolute).** Both arms carry the byte-identical 15px convergence block proven in the D2/D4 campaign. Every baseline target that renders on a surface — table cells, sidebar nav items, toolbar buttons, page secondary/description copy — computed **15px in both arms** (48 complete pairs; zero violations). `EXPERIMENT_INVALID_D2_BASELINE` never fired.

**Frozen D4 upstream (absolute).** D4 is production as-built and was verified, not injected: every capture asserted `table-head` computes 13px / 20px / 500 in BOTH arms (13 complete pairs; zero violations). `EXPERIMENT_INVALID_D4_FROZEN` never fired.

**Single-variable isolation (instance level).** On every judged pair (4 surfaces × 1440 + 4 × 1100 + recovery-queue × 1023 = 11 pairs), the first three visible badges recorded tone, geometry attribute, text, icon presence, computed height, bounding box, font-size, weight, line-height, padding, gap, radius and border width. The badge moved in **height only**: 11/11 pairs changed height, 0 static; every other recorded property was identical across arms in all pairs, at the product's own absolute values. The style-target diff agrees: no non-status-badge target moved in any computed property (contamination NONE).

**Width guard (§17).** Badge bounding width and status-cell width are identical across arms within 1px on all 11 pairs (recorded delta 0.0px) — a height-only change did not move any horizontal geometry.

**TagBadge non-contamination (§18).** On the questions workbench, `[data-slot="tag-badge"]` (the D6 owner, compact-table variant: 22px height / 400 weight / 3px radius as-built) was probed in both arms at both primary viewports: zero cross-arm diffs on any controlled property, at the product's own absolute values. D5 did not pre-empt D6.

**Font gate.** Before every capture: `document.fonts.ready` awaited, computed body stack contains HarmonyOS Sans SC, `fonts.check` true for 400 and 500 — 22/22 captures (the production self-hosted font path; no font experiment).

**Injection gate.** Every capture verified the variant `<style>` installed inside `<head>` with an `!important` height rule; the D2 baseline block is present in both arms, so a silent no-op injection cannot masquerade as evidence.

## Icon-policy coverage (§4)

The recovery queue renders `incidentOpen` (待处理, warning, `iconPolicy: "show"`) badges **with icons by default**, and — after the force-submit reconciliation graded one linked demo attempt — also renders a text-only success badge in the same rows. All other surfaces render text-only badges across five tone classes. Both semantic forms of the component family are therefore represented in the evidence; no DOM was manufactured for coverage.

## Known non-findings (expected absences, not gaps)

- `body` style-proof pairs are incomplete by a DOM artifact: `document.body.offsetParent` is null by spec, so the visibility filter skips it. The body stack is instead gated per capture by the font gate (22/22).
- `input` exists only on the grading-queue and recovery-queue workbenches among the judged surfaces; `page-description` only on grading-queue/recovery-queue; `page-secondary-text` absent from grading-queue/recovery-queue; `button` absent on grading-queue (no toolbar buttons). All recorded as absent rather than forced.
- `sidebar-link` is absent at 1023 (admin sidebar leaves the flow below `lg`) — recorded as absent.

## Boundary representation record

1023×800 was attempted **only for recovery-queue**, whose `log-diagnostic` archetype keeps the governed table below `lg` (horizontal scroll by design) — it rendered and was captured in both arms (5/5 rows). The four `management-list` surfaces switch to a pure-CSS mobile card representation below `lg` and were therefore not attempted at the boundary viewport (representation behavior already evidenced by the D4 pack); `RESPONSIVE_REPRESENTATION_CHANGE` count in this pack is accordingly 0.
