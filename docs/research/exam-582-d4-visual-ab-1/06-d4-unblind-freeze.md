# 06 — D4 Unblind & Freeze

Adjudication record for D4 (table-header size). The verdicts below were delivered by the human/multimodal reviewer against the blind pack at branch tip `084529a96dccd6afb3ced7e42fef38fdcb2858a8`; Flash's role was evidence generation only. D4 was judged relative to the frozen D2 baseline (15px body/control tier) injected identically in both arms, never relative to the mixed production typography.

## PASS-1 — multimodal verdict (blind)

```text
DECISION: Y
CONFIDENCE: HIGH
```

Why (reviewer's summary):

- **Header / body hierarchy** — against the 15px body baseline, Y reads as a distinct structure layer (page title → table header → body rows) while remaining secondary through color and weight; X's headers read as auxiliary metadata, so the eye lands on the first body row and column boundaries take extra effort to re-establish. Most visible on Question management, Audit logs and Exam list.
- **Chinese header legibility** — Y's short CJK headers (考试名称 / 时间窗口 / 题目内容 / 所属课程 / 操作 / 用户名 / 角色 / 状态) are more stable to recognize; strongest at 1100×800 and on the wide audit-log table.
- **Horizontal scanning** — Y forms a continuous navigation band across dense multi-column tables (题型 / 题目内容 / 所属课程 / 分值 / 难度 / 标签 / 操作); X's hierarchy leans on color, position and header fill instead of the type size itself.
- **Density** — no capacity cost: header band height unchanged, body rows unchanged, no wrapping, no clipping, no column squeeze, and no top-heavy tables on macro.
- **Visual dominance** — the risk that Y over-dominates did not materialize: page title, blue actions and status badges still outweigh the header band.

Pages ranked by evidence value (reviewer): Question management > Audit logs (including the 1023 boundary) > Exam list > Users.

## PASS-2 — adversarial review (blind)

```text
VERDICT: UPHOLD Y
CONFIDENCE: HIGH
```

Counter-arguments considered: "the smaller variant better fits dense enterprise tables" (rejected — its compactness is optical: header height, row count and column capacity are all unchanged); "headers must be visibly smaller than the 15px body" (rejected — hierarchy is also carried by weight, color, fill and position, and Y still reads as header); "Y is too heavy on Question management" (strongest objection, rejected — page title, action buttons and body content remain the visual anchors); "1px is too small to call NO_CLEAR_WIN" (rejected — Question management, Audit logs and the 1023 audit boundary agree in direction).

```text
FINAL BLIND DECISION: D4 = Y
```

## Unblinding

`validity/variant-map.json` (generated `node:crypto randomInt(2)` at 2026-09-20T06:14:59.542Z, independent of the D2 assignment):

```text
X = 14px
Y = 13px
```

## D4 FINAL

```text
D4 FINAL = 13px table header
```

Implementation meaning (for the record, NOT a production task done here): **no production change is required.** The as-built governed header rule — `[data-slot="table-head"]` in `apps/web/src/table/recipes.css` (`font-size: 0.8125rem` = 13px, `line-height: 1.25rem` = 20px, weight 500) — already matches the frozen decision. Under the D2-frozen 15px body/control baseline, the alternative of raising table headers to 14px was rejected by blind adjudication.

## Letter-direction note (recorded, not adjudicated)

The reviewer's prose describes Y as the larger / more prominent variant ("X 的表头偏弱…尺寸再小一点之后笔画略紧略弱"), while the verified mapping is the opposite (Y = 13px, X = 14px). After unblinding and before recording the freeze, the artifact chain was re-verified: all 18 style-proof d4-tier records compute X = 14px / Y = 13px matching the sealed map, and the contact-sheet builder labels panels directly from capture filenames (`<surface>-<letter>-<viewport>.png` → "Variant X" / "Variant Y"), so the sheets shown to the reviewer are pixel-for-pixel the mapped arms. The blind decision is therefore recorded as delivered: the judge picked the variant that read better, and that variant is 13px. At a 1px delta, perceived relative size is not a reliable cue; the prose direction is noted for interpretation only and does not alter the decision. Flash outputs no aesthetic conclusion of its own (issue #582 discipline).

## Chain-of-custody verification (post-unblind)

```text
validity/style-proof.json  d4-tier records: 18/18 — X: {14px}, Y: {13px} (matches map)
validity/variant-map.json  X = "14", Y = "13" (sealed 2026-09-20T06:14:59.542Z)
sheet builder              panel labels derived directly from capture filenames
CHAIN OK = true
```

## State after freeze

```text
D2 = FROZEN at 15px (body / control text tier — converged UP)
D4 = FROZEN at 13px (table header — as-built retained; no production change)
D5–D7 = untouched (not started, per task boundary)
```
