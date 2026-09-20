# 04 — Judge Handoff

```text
EXAM-582-D4-VISUAL-AB-EVIDENCE-1

UPSTREAM_D2_FREEZE_SHA:
  42ef848fb3feb78a7fdfc60bec01a0f7932c5afc

D4_BRANCH:
  research/582-d4-visual-ab-1

D4_HEAD_SHA:
  <pack commit> — the branch tip additionally carries this evidence pack;
  the exact tip SHA is published in the handoff message (D2/Phase-1 pattern)

FROZEN BASELINE:
  D2 body/control baseline = FROZEN (15px), established experimentally in
  BOTH arms and verified per capture (37/37 baseline pairs, 0 violations);
  the mapping/numeric value of each blind letter is intentionally omitted
  from this blind judge bundle

D4:
  table header size      = blind X/Y (single variable, font-size only)
  line-height fixed      = 20px (product value, verified 9/9 pairs both arms)
  weight fixed           = 500  (product value, verified 9/9 pairs both arms)

VALIDITY:
  D2 common baseline:            PASS (15px in both arms, absolute check)
  D4 single-variable isolation:  PASS (9/9 pairs moved in font-size only)
  font:                          PASS (24/24 capture gates, HarmonyOS Sans SC)
  structural:                    PASS (no wrapping/clipping/overflow/alignment
                                 drift in either arm; see 03)
  cross-variable contamination:  NONE

JUDGE ARTIFACTS (letters only — provide this bundle to the reviewer):
  judge/README.md
  judge/macro-contact-sheet.png          scaled overview, blind X|Y pairs
  judge/micro-contact-sheet.png          NATIVE-PIXEL header+3-row crops
  judge/macro/  (18 raw full-viewport captures)
  judge/micro/  (18 raw native crops)

VALIDITY ARTIFACTS — DO NOT SEND TO BLIND JUDGE:
  validity/variant-map.json   (mapping; crypto coin flip)
  validity/style-proof.json   (computed px per letter)
  validity/structural.json
  validity/font-gate.json
  validity/run-manifest.json

EVIDENCE VERDICT:
  READY_FOR_D4_MULTIMODAL_REVIEW
```

## Adjudication contract (for the multimodal reviewer)

- Provide **only** the `judge/` directory. Do not open `validity/` before deciding.
- Judge **only** D4: table-header font size, evaluated **against the 15px body** (frozen upstream D2). Chinese-language exam/LMS/admin product, dense enterprise tables.
- Blind labels only: Variant X vs Variant Y. The two variants of each pair differ in exactly one property; anything else is identical by construction.
- Use the micro sheet for glyph-level legibility (native pixels) and the macro sheet for hierarchy/density/dominance; raw PNGs are authoritative.
- Per issue #582 return: `DECISION: X | Y | NO_CLEAR_WIN`, `CONFIDENCE: HIGH | MEDIUM | LOW`, `WHY` (hierarchy / Chinese legibility / scanning / dominance / density / structural artifacts), `RISKS`, `PAGES WHERE DIFFERENCE MATTERED`. "Framework defaults" and "looks cleaner" are not arguments.

## Boundaries respected

No production visual file changed (0 `apps/web` diffs on this branch — product tree byte-identical to `3f5bd9c4`). D2 not re-adjudicated (treated as frozen upstream authority; its 15px convergence is the experiment's common baseline). D5–D7 not touched. #582's final decision table not updated. This branch is evidence-only.
