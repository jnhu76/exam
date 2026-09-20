# 06 — D4 Unblind & Freeze

Adjudication record for D4 (table-header size). The blind letter verdicts below were delivered by the human/multimodal reviewer against the blind pack at branch tip `084529a96dccd6afb3ced7e42fef38fdcb2858a8`; Flash's role was evidence generation only. D4 was judged relative to the frozen D2 baseline (15px body/control tier) injected identically in both arms, never relative to the mixed production typography.

## PASS-1 — multimodal verdict (blind, historical record)

```text
DECISION: Y
CONFIDENCE: HIGH
```

The contemporaneous blind rationale argued that Y gave the stronger table-header/body relationship and was upheld across Question management, Audit logs, Exam list and Users. That rationale is retained below as the historical record of the blind adjudication, but its **relative-size interpretation was later found to be directionally inverted after unblinding**; see **Adjudication integrity correction** below.

Historical rationale summary:

- **Header / body hierarchy** — the reviewer preferred Y as the table structural layer against the frozen 15px body.
- **Chinese header legibility** — the reviewer preferred Y across short CJK headers and dense tables.
- **Horizontal scanning** — the reviewer preferred Y as the stronger continuous navigation band across multi-column tables.
- **Density** — neither arm incurred a structural capacity cost: header band height, body rows, wrapping, clipping and column geometry stayed unchanged.
- **Visual dominance** — neither arm displaced the page title, primary actions or body content as the dominant visual anchors.

Pages ranked by evidence value in the blind review: Question management > Audit logs (including the 1023 boundary) > Exam list > Users.

## PASS-2 — adversarial review (blind, historical record)

```text
VERDICT: UPHOLD Y
CONFIDENCE: HIGH
```

The blind second pass attempted to overturn Y on density, hierarchy and the small 1px delta, but upheld the same letter. This historical `HIGH` confidence is **not** the final engineering confidence after the post-unblind integrity correction.

```text
FINAL BLIND DECISION: D4 = Y
```

## Unblinding

`validity/variant-map.json` (generated with `node:crypto randomInt(2)` at 2026-09-20T06:14:59.542Z, independent of the D2 assignment):

```text
X = 14px
Y = 13px
```

## Chain-of-custody verification

The mapping was independently re-verified after unblinding:

```text
validity/style-proof.json  d4-tier records: 18/18 — X: {14px}, Y: {13px} (matches map)
validity/variant-map.json  X = "14", Y = "13" (sealed 2026-09-20T06:14:59.542Z)
sheet builder              panel labels derived directly from capture filenames
CHAIN OK = true
```

Therefore the blind reviewer genuinely selected the rendered **13px** arm; there is no evidence of label inversion, remapping, or contact-sheet corruption.

## Adjudication integrity correction

After unblinding, the reviewer's prose was found to contain a directional interpretation error: it described Y as if Y were the visually larger / more prominent arm, while the verified mapping is the opposite (`X = 14px`, `Y = 13px`). The blind **letter choice** remains valid as a record of which rendered result was preferred, but the parts of the original rationale that depend on the assumed numeric direction are not valid evidence.

A post-unblind forensic re-review of the same native-pixel evidence still supports the selected arm, for the corrected reason:

- with body/control typography frozen at **15px**, **13px** preserves a clearer secondary table-header tier;
- the existing **500** weight, muted color, fixed header band and 20px line-height remain sufficient for Chinese header legibility and scanning;
- **14px** reduces the size distinction from the 15px body and makes the header/body hierarchy flatter on the dense Question management and Exam list surfaces;
- the 1023 audit-log boundary is the strongest case against 13px, but 13px remains legible and produces no wrapping, clipping, overflow, or alignment failure;
- neither candidate changes row count, row height, column capacity, or other structural density metrics.

Accordingly:

```text
BLIND LETTER DECISION          = Y        (preserved)
ORIGINAL DIRECTIONAL RATIONALE = PARTIALLY INVALID
POST-UNBLIND FORENSIC REVIEW   = SUPPORTS Y
Y                              = 13px
D4 FINAL                       = 13px table header
FINAL ENGINEERING CONFIDENCE   = MEDIUM
RERUN FOR PRODUCT ENGINEERING  = NOT REQUIRED
```

The confidence is downgraded from the blind review's historical `HIGH` to **MEDIUM** because the explanatory layer contained a clear sign/direction error, even though the selected letter, mapping chain and post-unblind pixel review all converge on 13px.

A fresh independent blinded reviewer would be appropriate if this campaign is later used as methodology/benchmark evidence. It is not required to choose the production value for this product.

## D4 FINAL

```text
D4 FINAL = 13px table header
```

Implementation meaning: **no D4 production change is required.** The as-built governed header rule — `[data-slot="table-head"]` in `apps/web/src/table/recipes.css` (`font-size: 0.8125rem` = 13px, `line-height: 1.25rem` = 20px, weight 500) — already matches the frozen decision. Under the D2-frozen 15px body/control baseline, the alternative of raising governed table headers to 14px is rejected for the product campaign.

## State after freeze

```text
D2 = FROZEN at 15px (body / control text tier — converged UP)
D4 = FROZEN at 13px (table header — as-built retained; no D4 production change)
D4 final engineering confidence = MEDIUM
D5–D7 = untouched
```
