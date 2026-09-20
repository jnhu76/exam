# 02 — Style Proof

Computed-style isolation results across the 24 captures (12 surface×viewport pairs). Raw machine record: `artifacts/D2/style-proof.json` (**validity-only — it records px per letter and therefore reveals the mapping; not judge-facing**).

## Guard summary

| Guard | Result |
| --- | --- |
| D4 header guard (`table-th` identical across arms) | **PASS** — 5/5 th rows static at 13px / 20px / 500 |
| Controlled properties (family, weight, color, letter-spacing, radius, padding; height where not text-driven) | **PASS** — 0 violations |
| Tier consistency (every d2-tier target changed size) | **PASS** — 23/23 changed, 0 static |
| Font gate (per capture, B6) | **PASS** — 24/24 (`artifacts/font-gate.json`) |
| CROSS_VARIABLE_CONTAMINATION | **none** |

36 complete cross-arm pairs: **23 changed** (all d2-tier), **13 static** (all external tiers).

## What moved (the D2 tier — 23 rows)

Per surface/viewport, both directions of every moved target read `15px ↔ 14px` consistently with the sealed map (per-letter values in the raw JSON):

- sidebar nav links, toolbar/page buttons, form labels, inputs, dialog labels/inputs/buttons, runtime `text-sm` text and buttons — the `text-sm` control tier;
- `.type-body` / `.type-secondary` body text and governed table cells (`[data-slot="table-cell"]`) — the body-recipe tier.

## What did NOT move (external tiers — 13 rows)

| Target | Computed | Note |
| --- | --- | --- |
| `table-th` (D4) | 13px / 20px / 500 everywhere | structural isolation: th styling lives in `table/recipes.css`, outside both override sets |
| page headings | 24px | `type-page-title` |
| dialog heading | 18px | dialog title style |
| question stem | 20px / 32px | `type-reading` (reading tier, not D2) |
| `body` element | 16px | negative control (no D2 rule addresses body) |

No 12px metadata/badge target was measured as changed (they sit outside the tier — consistent with the pill-delta result in 04).

## Line-height coupling (disclosed, not policed)

| Element class | Line-height behavior across arms |
| --- | --- |
| `text-sm` controls (Tailwind unitless 1.5) | scales: 22.5px ↔ 21px |
| typography recipes + table cells (fixed rem) | constant: 22px |
| labels (`leading-none`) | equals font size: 15px ↔ 14px |

These are product couplings of the D2 variable itself, recorded per target in the raw JSON; no line-height declaration was injected.

## Height rule (B7 "height where not text-driven")

The only controlled-property deltas observed were `height` on **text-driven** containers (form labels, dialog labels, runtime text containers) — they shrink/grow with their line-height, which is the D2 variable propagating through text geometry. Fixed-height controls (`h-9` inputs/buttons) were measured identical across arms. The guard polices the latter class only (rule codified in the harness; `TEXT_DRIVEN_HEIGHT` set).

## Targets recorded as not found

- `runtime-body` (`main .type-body`) — the take surface at this seed renders its running text through `text-sm` containers; recorded `found:false` in both arms (no asymmetry).
- All other targets resolved in both arms; incompletes are listed per-pair in the raw JSON and none involve the D4 guard.

## Verdict

The experiment is style-isolated: the two arms differ **only** in the computed font-size of the body/control text tier (plus its documented text-driven geometry propagation), on the same build, DOM, and font path.

**STYLE_PROOF = VALID**
