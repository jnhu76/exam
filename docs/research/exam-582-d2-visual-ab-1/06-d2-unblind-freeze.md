# 06 — D2 Unblind & Freeze

Adjudication record for D2 (body / control text size). The verdicts below were delivered by the human/multimodal reviewer against the blind pack at branch tip `41a745b06ba0f746739c66ef73fcad34d2bce70b`; Flash's role was evidence generation only.

## PASS-1 — multimodal verdict (blind)

```text
DECISION: X
CONFIDENCE: HIGH
```

Why (reviewer's summary):

- **Legibility** — X reads better across all four decision surfaces: M1 dense table (long CJK strings in 题目内容/所属课程), M2 form (better proportion inside fixed 36px controls), M3a sidebar (balanced in 40px nav rows), M4 candidate runtime (lower reading load for candidates — weighted above admin compactness).
- **Density** — Y's compactness bought no real capacity: row heights stayed 48px in both arms, no new horizontal overflow at 1440/1100, known pill deltas 0.0px. So `Y = same rows with smaller text; X = same rows with more readable text`.
- **Hierarchy** — X's stronger table body narrows the gap to the 13px D4 header, but M1 still scans cleanly (header keeps its tinted fill, 500 weight, fixed band). Recorded as **D4's problem to resolve**, not a reason to shrink D2.
- **Consistency** — no split verdicts across dense table / form / sidebar / candidate runtime; 1100×800 dense tables stable under X.

Why Y loses: paid legibility without gaining rows, smaller row height, better narrow-fit, or fewer overflows — compactness was optical, not structural.

## PASS-2 — adversarial review (blind)

```text
VERDICT: UPHOLD X
CONFIDENCE: HIGH
```

Counter-arguments considered: "enterprise admin should be compact" (not evidence; no capacity advantage shown); "body/header gap too wide" (valid risk → deferred to D4, cannot pre-empt it); "X looks oversized" (not observed on any macro surface at either viewport); "line-height coupling pollutes judgement" (unitless-1.5 couplings moved with the variable, but row heights, control heights and page geometry did not — insufficient to overturn).

```text
FINAL BLIND DECISION: D2 = X
```

Pages that mattered most (reviewer's ranking): M4 candidate runtime > M1 dense table > M3a sidebar > M2 form controls > M3b dashboard secondary copy; macro served as the anti-evidence (not oversized, density intact).

## Unblinding

`artifacts/variant-map.json` (generated `crypto.randomInt(2)` at 2026-09-20T01:23:53.751Z):

```text
X = 15px
Y = 14px
```

## D2 FINAL

```text
D2 FINAL = 15px body / control text tier

Implementation meaning (for the future production task, NOT done here):
body recipes (.type-body / .type-secondary / .type-page-description /
.type-long-response) and governed table cells converge UP to the existing
15px text-sm control tier. The control tier is NOT lowered.
```

## Blinding-discipline note

The reviewer's execution environment received `D2/style-proof.json` (a validity artifact carrying px per letter), so the strict cryptographic blind was compromised there. The verdict was nonetheless formed from the screenshots themselves, is consistent across independent surfaces, and is non-marginal — no re-run was required. Harness improvement carried as a bounded follow-up: judge-facing sessions must not receive validity artifacts (keep `style-proof.json` out of shared tool context).

## State after freeze

```text
D2 = FROZEN at 15px (decision recorded; production implementation is a
     separate authorized task — this evidence branch changes no production file)
D4 = next (table header 13px vs 14px, 13px/20/500 baseline)
D5–D7 = untouched
```
