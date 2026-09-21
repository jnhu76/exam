# d7 freeze — modal/panel overlay background tier, frozen at var(--surface)

> Compact canonical copy of the final d7 unblind/freeze record.
>
> - source branch: `research/582-d7-visual-ab-1 (PR #593, closed unmerged at closeout)`
> - source exact SHA: `ff1b535902a8f8ee5d21545450a5774f3c1a46d4` (last commit touching the freeze record; the D7 snapshot tree carrying every record is `ff1b535902a8f8ee5d21545450a5774f3c1a46d4`)
> - original path: `docs/research/exam-582-d7-visual-ab-1/06-d7-unblind-freeze.md`
> - retained contact sheets: [`contact-sheets/d7-micro.png`](contact-sheets/d7-micro.png) · [`contact-sheets/d7-macro.png`](contact-sheets/d7-macro.png)
>
> Sibling-path references in the record body (`validity/…`, `judge/…`, `artifacts/…`, `0X-*.md`) resolve inside the original research directory, which is preserved only in the raw evidence archive (see [EVIDENCE-MANIFEST.md](EVIDENCE-MANIFEST.md)). The body below is preserved verbatim from the source below its original title line; verdicts are unaltered.

---


Adjudication record for D7 (Dialog / Sheet modal-surface background tier) under issue #582.

The blind multimodal reviewer judged only the rendered X/Y variants from the physically separated `judge/` bundle. Mapping-revealing validity artifacts were not consulted until after the blind letter decision.

## Blind verdict

```text
PASS-1
DECISION: Y
CONFIDENCE: HIGH

PASS-2 (adversarial review)
VERDICT: UPHOLD Y
CONFIDENCE: HIGH

FINAL BLIND DECISION: D7 = Y
```

Reviewer rationale (compressed): Y lets Dialog/AlertDialog form a clearly readable top interaction layer above the fixed overlay, shadow and border; it markedly reduces the muted, merged feeling of large modal interiors; and it does NOT lose hierarchy against the light content cards behind the modal, because the dimming veil, modal border and modal shadow already carry the z-layer separation. The drawer scenario was weakly differentiating but produced no reverse evidence. All four adversarial counter-hypotheses (X softer, Y merging with cards, Sheet indifference, difference-too-small) were tested and none overturned the letter decision.

Strength ranking of the evidence (reviewer's, strongest first): destructive confirmation over the open-background page → large import wizard → create-form dialog over card-table page → second create-form dialog → mobile navigation drawer.

Discipline: the reviewer did not infer which arm carried which tier, which arm was current, or any token value. Only the rendered letter was selected; tier interpretation is mechanical after unblinding.

## Unblinding

`validity/variant-map.json` reveals:

```text
X = canvas   (var(--bg) — the current recipe value)
Y = white    (var(--surface) — the candidate)
```

Therefore:

```text
FINAL BLIND DECISION = Y
Y = content tier (var(--surface))
D7 FINAL = content-tier (var(--surface)) background for the modal/panel large-overlay tier
```

The tie rule (current value wins ties) was NOT invoked: the blind verdict was a clear Y win at HIGH confidence.

## Engineering interpretation

D7 is a **PRODUCTION CHANGE** decision (unlike D5's keep-as-built).

The production authority at the base SHA is:

```css
.surface-overlay[data-overlay-variant="modal"] {
  background: var(--bg);    /* canvas tier — CURRENT */
}
.surface-overlay[data-overlay-variant="panel"] {
  background: var(--bg);    /* canvas tier — CURRENT */
}
```

The frozen D7 decision moves BOTH variants to the content tier:

```css
.surface-overlay[data-overlay-variant="modal"]  { background: var(--surface); }
.surface-overlay[data-overlay-variant="panel"]  { background: var(--surface); }
```

Modal and panel move TOGETHER — one semantic decision, adjudicated as one family (task §4 law; the experiment injected both variants with the same token in the winning arm).

Implementation contract for the campaign's final implementation PR (deferred — NOT authorized by this freeze alone):

- change ONLY the two `background` declarations above; border, radius, shadow, dimmer, panel edge, layout and all small-overlay surfaces stay byte-identical (the single-variable law the evidence was generated under);
- the small-overlay family keeps the `.surface-overlay` base tier (`var(--surface)`) — after D7 the modal/panel tier EQUALS the small-overlay tier, i.e. the overlay family becomes single-tier on background; the modal/panel-vs-base distinction remains carried by radius/shadow/edge recipes;
- as-built cleanup candidate to decide separately (not required): the mobile-nav Sheet's layered `bg-sidebar` utility already loses to the unlayered panel recipe today and stays inert after the change (recorded in `03-structural-effects.md`);
- #590 stays out of scope.

## Frozen record — reviewer-requested limitation

```text
SHEET_VISUAL_SIGNAL = WEAK
```

The 1023×800 mobile drawer's visible area is dominated by its internal navigation content, so the panel background candidate itself carries little perceptual signal there. This is NOT a coverage gap — the Sheet was genuinely covered in both arms (macro + native panel-edge crops + full validity gates); the surface is simply less sensitive to a background-only candidate. The panel therefore rides on the modal evidence plus the absence of reverse evidence, which is exactly what the family-joint decision law allows.

## Evidence summary

Frozen upstream environment (both arms):

```text
D2 = 15px body/control typography
D3 = 6px primary control family radius
D4 = 13px / 20px / 500 governed table header
D5 = 22px StatusBadge height
D6 = 500 TagBadge weight
```

D7 validity facts from the packaged run (EXAM-582-D7-VISUAL-AB-1, base `e6d683cc`):

```text
as-built authority gate:        PASS (modal/panel = canvas token, small-overlay
                                containers = content token, clean product)
D7 single-variable isolation:   PASS — 9/9 pairs moved in background only, 0 static
overlay dim invariant:          PASS — 9/9 pairs identical
shadow / radius / panel edge:   PASS — identical across arms
small-overlay non-contam.:      PASS — 7/7 probe pairs identical
geometry:                       PASS — 99 pairwise comparisons, all deltas 0.0px
interaction (§23):              PASS — 9/9 state pairs identical
cross-variable contamination:   NONE
font gate:                      PASS — 29/29
Sheet coverage:                 PASS (with SHEET_VISUAL_SIGNAL = WEAK sensitivity note)
```

## Final state

```text
D2 = FROZEN at 15px body/control typography
D3 = FROZEN at 6px primary control family radius
D4 = FROZEN at 13px / 20px / 500 governed table header
D5 = FROZEN at 22px StatusBadge height (KEEP AS-BUILT)
D6 = FROZEN at 500 TagBadge weight
D7 = FROZEN at content-tier (var(--surface)) modal/panel background (PRODUCTION CHANGE, deferred)
```

The D2–D7 decision matrix is closed. `#582` remains open; its final decision table and the unified implementation PR belong to the campaign's final implementation phase. Nothing in this freeze authorizes touching production visual files, #590, or the GitHub issue.
