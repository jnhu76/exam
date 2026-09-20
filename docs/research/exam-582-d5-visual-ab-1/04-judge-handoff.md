# 04 — Judge Handoff

```text
EXAM-582-D5-VISUAL-AB-EVIDENCE-1

BASE_SHA:
  9b08f9561856e021ad2ee92629e38c00f80dea60 (current master at task handoff;
  the product tree under test is byte-identical to it — the branch adds
  evidence + harness files only)

D5_BRANCH:
  research/582-d5-visual-ab-1

D5_HEAD_SHA:
  <pack commit> — the branch tip additionally carries this evidence pack;
  the exact tip SHA is published in the handoff message (D2/D4 pattern)

FROZEN UPSTREAM:
  D2 = frozen (15px body/control baseline, established experimentally in
       BOTH arms and verified per capture — 48/48 baseline pairs)
  D4 = frozen (13px/20px/500 governed table header, as-built upstream
       authority re-verified per capture — 13/13 header pairs)

STATUSBADGE AUTHORITY:
  component:        apps/web/src/components/shared/StatusBadge.tsx
                    (data-slot="status-badge", data-status-geometry="compact")
  recipe:           apps/web/src/badge/recipes.css
  runtime selector: [data-slot="status-badge"]

INSTANCE COVERAGE:
  included surfaces:     exam-list / grading-queue / recovery-queue / users /
                         scores (5 judged; per-instance classification in
                         validity/instance-inventory.json)
  excluded lookalikes:   TagBadge, shadcn Badge role pills, audit-log action
                         pill, page-local metadata chips
  text-only coverage:    PASS (exam lifecycle, grading, account, pass/fail
                         vocabularies across 5 tone classes)
  icon-bearing coverage: PASS (recovery queue, iconPolicy-"show" badges from
                         real incident data)

VALIDITY:
  upstream baseline:            PASS (D2 48/48, D4 13/13, absolute checks)
  single-variable isolation:    PASS (11/11 badge pairs moved in height only,
                                0 static; instance-level oracle)
  font:                         PASS (22/22 capture gates, HarmonyOS Sans SC)
  geometry:                     PASS (widths 0.0px delta; centering recorded;
                                icon/text center delta 0px both arms)
  row-height:                   PASS (48px rows identical both arms on all
                                pairs — no density increase from either arm)
  width:                        PASS (11/11 pairs)
  TagBadge non-contamination:   PASS (2/2 probe pairs, D6 untouched)
  structural:                   PASS (no wrap/clip/overflow/collision anywhere)
  cross-variable contamination: NONE
  pairwise DOM consistency:     PASS (row sets + badge sets identical across
                                arms after static-DOM reconciliation)

JUDGE ARTIFACTS (letters only — provide ONLY this bundle to the reviewer):
  judge/README.md
  judge/macro-contact-sheet.png        scaled overview, blind X|Y pairs
  judge/micro-contact-sheet.png        NATIVE-PIXEL crops (table context +
                                       tight badge context)
  judge/micro/<surface>-pair.png       per-surface native pair sheets
  judge/macro/  (22 raw full-viewport captures)
  judge/micro/  (44 raw native crops)

VALIDITY ARTIFACTS — DO NOT SEND TO BLIND JUDGE:
  validity/variant-map.json        (mapping; independent crypto coin flip)
  validity/style-proof.json        (computed px per letter — mapping revealing)
  validity/geometry.json           (per-badge geometry oracle)
  validity/structural.json         (row/header/overflow sweeps)
  validity/upstream-baseline.json  (D2/D4 absolute proofs)
  validity/font-gate.json
  validity/instance-inventory.json
  validity/run-manifest.json

EVIDENCE VERDICT:
  READY_FOR_D5_MULTIMODAL_REVIEW
```

## Adjudication contract (for the multimodal reviewer)

- Provide **only** the `judge/` directory. Do not open `validity/` before deciding.
- Judge **only** D5: StatusBadge physical height, evaluated against the frozen upstream baselines (15px body/control, 13px/20px/500 header). Chinese-language exam/LMS/admin product, dense enterprise tables.
- Blind labels only: Variant X vs Variant Y. The two variants of each pair differ in exactly one property; anything else is identical by construction. The reviewer must never be asked which arm is larger, current, or any px value.
- Use the micro sheets for glyph breathing-room and centering (native pixels; per-surface pair sheets exist for readability) and the macro sheet for row rhythm/density/salience; raw PNGs are authoritative.
- Per issue #582 return: `DECISION: X | Y | NO_CLEAR_WIN`, `CONFIDENCE: HIGH | MEDIUM | LOW`, `WHY` (breathing room / vertical alignment / row rhythm / density / consistency / structural effects), `RISKS`, `PAGES WHERE DIFFERENCE MATTERED`. "Framework defaults" and "looks cleaner" are not arguments.

## Tie rule (applied only AFTER unblinding)

If and only if the blind judge returns `NO_CLEAR_WIN`, unbind `validity/variant-map.json` and apply the campaign law mechanically: **the current value wins ties**.

## Boundaries respected

No production visual file changed (0 `apps/web` diffs on this branch — product tree byte-identical to `9b08f956`). D2 and D4 not re-adjudicated (treated as frozen upstream authorities). D3 (radius), D6 (TagBadge) and D7 not touched; #582's final decision table not updated; #582 not closed. This branch is evidence-only.
