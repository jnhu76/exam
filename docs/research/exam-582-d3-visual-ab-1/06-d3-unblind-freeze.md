# 06 — D3 Unblind & Freeze

Adjudication record for D3 (primary control family radius: Input, SelectTrigger, Textarea, standalone Button — judged as ONE family) under issue #582.

The blind multimodal reviewer judged only the rendered X/Y variants from the physically separated `judge/` bundle (entrypoint: `judge/README.md` + the two contact sheets). Mapping-revealing validity artifacts were not consulted until after the blind letter decision.

## Blind verdict

```text
PASS-1
DECISION: Y
CONFIDENCE: MEDIUM

PASS-2 (adversarial)
VERDICT: UPHOLD Y
CONFIDENCE: MEDIUM

FINAL BLIND DECISION: D3 = Y
```

The reviewer preferred Y for family coherence: in the real dialog/form compositions (Exam wizard, Course dialog, User dialog, destructive confirm), inputs, select triggers, textareas and action buttons read as one geometric language instead of "fields are one set, buttons are another". Form rhythm across consecutive label→control→footer stacks was judged slightly more natural, and the focus ring sat more naturally against the control outline. The adversarial pass tested the strongest counter-arguments — X's tighter "engineering tool" precision, Y being too soft, the small macro-level difference, and the AlertDialog slot-ownership oddity — and none overturned the letter decision. Confidence stayed MEDIUM because the difference is only reliably visible in native-pixel micro evidence and in continuous form composition, never in macro orientation.

Important discipline: the reviewer did **not** infer which arm was numerically larger, current, or candidate. Only the rendered letter was selected; numeric interpretation is mechanical after unblinding.

## Unblinding

`validity/variant-map.json` reveals:

```text
X = 8px
Y = 6px
```

Therefore:

```text
FINAL BLIND DECISION = Y
Y = 6px
D3 FINAL = 6px primary control family radius
```

The tie rule was **not** triggered: the blind decision is a letter win, not `NO_CLEAR_WIN`, so the as-built split is not preserved by default — the family converges.

## Engineering interpretation

D3 is a **CONVERGE DOWN** decision.

As-built at the evidence base SHA:

```text
Input / SelectTrigger / Textarea:  6px   (control/recipes.css 0.375rem) — unchanged by D3
Button:                            8px   (button.tsx rounded-lg)       — moves to 6px
```

The frozen decision makes **6px the single family radius** for all seven `D3_INCLUDED` slot names (`input`, `select-trigger`, `textarea`, `button`, and the three buttonVariants-consuming `alert-dialog-trigger` / `alert-dialog-cancel` / `alert-dialog-action`), in every standalone context: forms, dialog footers, header actions, destructive confirms. Inputs, selects and textareas stay exactly as-built; the production change is the button side joining them at 6px.

Implementation consequence recorded for the campaign's final implementation phase (not performed here): the button radius authority cannot be expressed through `[data-slot="button"]` targeting alone — Radix `Slot` composition means the three alert-dialog consumers render their own slot names and would silently keep 8px. The change must own the whole family boundary. The destructive-action members (`alert-dialog-action` with `data-variant="destructive"`) inherit the same 6px; no radius-by-variant exceptions exist as-built and none are authorized by D3.

The 8px arm was not structurally invalid: both candidates passed every gate — single-variable convergence (50/50 family pairs, radius the only controlled property that moved), state invariants (12/12 focus/invalid/disabled pairs, state treatment identical in both arms), geometry (95/95 bounding-box pairs Δ=0), quiet-toolbar seam absence in both arms, and zero cross-variable contamination against the frozen D2/D4/D5/D6 baselines. The final choice is a visual-preference decision between two structurally valid candidates, not a correctness repair.

## Evidence summary

Frozen upstream environment:

```text
D2 = 15px body/control typography (injected common baseline)
D4 = 13px / 20px / 500 governed table header (as-built, re-verified per capture)
D5 = 22px StatusBadge height (frozen; non-contaminated)
D6 = 500 TagBadge weight (frozen; injected common baseline)
```

D3 validity facts from the packaged run (`d3-1789926694489`):

```text
As-built authority audit:      PASS — 61 inventory rows, zero mismatch, no AUTHORITY_MISMATCH
D2 common baseline:            PASS — 15px in BOTH arms
D4 baseline:                   PASS — 13px/20px/500 in BOTH arms
D5 non-contamination:          PASS — StatusBadge 22px identical across arms
D6 non-contamination:          PASS — TagBadge 500 in BOTH arms, radius unchanged
Family single-variable:        PASS — 50/50 pairs; radius only; every instance = own arm's candidate
Quiet-toolbar seam (§18):      PASS — absent in BOTH arms (18 selector pairs); 0px rule active had anything matched
State invariants:              PASS — 12/12 focus / invalid / disabled pairs
Non-contamination guards:      PASS — badges, overlays, dialog/AlertDialog containers identical across arms
Cross-variable contamination:  NONE — zero non-family movement across 117 pairwise diffs
Geometry:                      PASS — 95/95 pairs, Δx=Δy=Δw=Δh=0
```

## Adjudication rationale retained

The highest-value surfaces were:

1. Course dialog — full label/input/select/textarea/footer stack in one composition;
2. User dialog — same stack plus a select trigger and open-overlay probe;
3. Exam wizard — page-level form rhythm with stepper and footer actions;
4. Destructive confirm — AlertDialog cancel/action row against a frozen dialog container;
5. Quiet-toolbar / table contexts — environmental, where the family reads as controls-in-place.

The selected arm was preferred because the button/control relationship — the core of the family question — favored it consistently across all three form/dialog compositions without density, correctness, focus-ring or geometry cost. No surface split toward the other arm.

## Reviewer-retained follow-ups

Two implementation risks were flagged by the reviewer and are recorded here as campaign follow-ups, explicitly **not** part of this freeze:

- The AlertDialog slot-name leak (above) — the production D3 change must cover `alert-dialog-trigger` / `-cancel` / `-action`, not just `button`.
- The quiet-toolbar composite-seam rules in `control/recipes.css` are dead CSS as-built (no component renders `toolbar-filters`). Their removal is an independent cleanup decision and must not ride along with the D3 implementation.

## Final state

```text
D2 = FROZEN at 15px
D4 = FROZEN at 13px / 20px / 500
D5 = FROZEN at 22px StatusBadge height (KEEP AS-BUILT)
D6 = FROZEN at 500 TagBadge weight (KEEP AS-BUILT)
D3 = FROZEN at 6px primary control family radius (CONVERGE DOWN: button 8px → 6px)
D7 = untouched
```

`#582` remains open; its final decision table is not updated by this document. Production implementation of D3 is deferred to the campaign's final implementation phase. D7 (dialog/sheet container geometry) has not been started.
