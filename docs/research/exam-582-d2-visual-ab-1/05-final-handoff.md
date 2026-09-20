# 05 — Final Handoff

```text
EXAM-582-D2-VISUAL-AB-EVIDENCE-1

PHASE1_EVIDENCE_SHA: fe7662acda60a51c4ab0467ce10217dc0b3cc924
D2_BRANCH:           research/582-d2-visual-ab-1
D2_HEAD_SHA:         788349f3260998df5bbc8e8e8d6ad1a7300f2260
                     (harness + evidence commit; the branch tip additionally
                      carries this report — tip SHA published in the handoff
                      message and reproducible as its parent-child)

PRODUCT_UNDER_TEST_SHA: 3f5bd9c4c757daec2554de98ed06e4d4e2784c8b

ENVIRONMENT:
  browser:      Chromium (Playwright 1.61.0, chromium revision 1228)
  viewport:     1440x900 primary; 1100x800 density repeat
  DPR:          1
  zoom:         100%
  font:         HarmonyOS Sans SC self-hosted (production loading path);
                per-capture gate 24/24 (fonts.ready, check 400/500, stack)

VARIANT BLINDING:
  mapping persisted: yes (artifacts/variant-map.json, crypto coin-flip)
  mapping exposed to judge: no (sheets/reports carry Variant X / Y only)

STYLE PROOF:
  target property isolated: font-size of the body/control text tier ONLY
                            (15px arm: body recipes + table cells raised;
                             14px arm: text-sm control tier lowered)
  cross-variable contamination: none
  D4 header unchanged: yes (13px / 20px / 500 in all 5 probes)
  font unchanged: yes (single stack, 400/500 faces gated per capture)
  line-height disclosure: unitless-1.5 couplings scale with the variable
    (22.5<->21 on text-sm), fixed-rem recipes/table stay 22px, labels track
    font size; no line-height was injected

STRUCTURAL EFFECTS:
  table overflow: none in either arm at either viewport (overflowing=false,
                  scroll-end reachable)
  row height: 48px constant in every table, both arms
  document overflow: 0/10 records
  known pill overflow delta: 0.0px (defects are 12px metadata tier — not D2)
  new defects: none

MACRO ARTIFACTS:
  artifacts/D2/macro-contact-sheet.png (scaled overview, blind labels)
  artifacts/D2/macro/<surface>-<X|Y>-1440x900.png (16 raw)
  artifacts/D2/macro/<exam-list|questions>-<X|Y>-1100x800.png

MICRO ARTIFACTS (native pixels, authoritative for glyph judgement):
  artifacts/D2/micro-contact-sheet.png (blind labels)
  artifacts/D2/micro/m1-table-<X|Y>-1440x900.png   dense table body
  artifacts/D2/micro/m2-form-<X|Y>-1440x900.png    label/input/button
  artifacts/D2/micro/m3-sidebar-<X|Y>-1440x900.png sidebar hierarchy
  artifacts/D2/micro/m3-heading-<X|Y>-1440x900.png heading/body copy
  artifacts/D2/micro/m4-runtime-<X|Y>-1440x900.png candidate runtime

EVIDENCE VERDICT:
  READY_FOR_D2_MULTIMODAL_REVIEW
```

## Adjudication contract (for the multimodal reviewer)

- Judge **only** D2: body/control text size. Chinese-language exam/LMS/admin product with dense tables and forms.
- Blind labels only: Variant X vs Variant Y. Do not open `variant-map.json` or `D2/style-proof.json` before deciding.
- Use the micro sheet for glyph-level readability and the macro sheet for hierarchy/density/rhythm; raw PNGs are authoritative.
- Per issue #582 return: `DECISION: A|B|NO_CLEAR_WIN`, `CONFIDENCE`, `WHY` (hierarchy / legibility / density / consistency / artifacts), `RISKS`, pages where the difference mattered. "Framework defaults" and "looks cleaner" are not arguments.

## Boundaries respected

No production visual file changed (0 `apps/web` diffs on this branch). D4–D7 not adjudicated. #582's decision table not updated. The two Phase-1 pill MINORs are re-measured, not fixed.
