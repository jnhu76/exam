# 04 — Judge Handoff

```text
EXAM-582-D7-VISUAL-AB-EVIDENCE-1

BASE_SHA:
  e6d683cc8731030fea10632a407df270673d1c83 (exact remote tip of
  research/582-d3-visual-ab-1 at task handoff — PR #592 not yet merged, so
  the branch preserves the D3/D6 freeze authority; the product tree under
  test is byte-identical to it — the branch adds evidence + harness files
  only)

D7_BRANCH:
  research/582-d7-visual-ab-1

D7_HEAD_SHA:
  <pack commit> — the branch tip additionally carries this evidence pack;
  the exact tip SHA is published in the handoff message (D2–D5 pattern)

FROZEN UPSTREAM:
  D2 = frozen (15px body/control baseline, established experimentally in
       BOTH arms and verified per capture — 15/15 baseline pairs)
  D3 = frozen (6px primary control family radius, established
       experimentally in BOTH arms and verified per capture — 32/32 family
       pairs)
  D4 = frozen (13px/20px/500 governed table header, as-built upstream
       authority re-verified per capture — 5/5 header pairs)
  D5 = frozen (22px StatusBadge, as-built upstream authority re-verified
       per capture — 4/4 badge pairs)
  D6 = frozen (500 TagBadge weight, established experimentally in BOTH arms
       and verified — 1/1 probe pair)

D7 AUTHORITY:
  recipe:            apps/web/src/surface/recipes.css
                     .surface-overlay base tier /
                     [data-overlay-variant="modal"] /
                     [data-overlay-variant="panel"]
  modal selector:    [data-slot="dialog-content"][data-overlay-variant="modal"]
                     [data-slot="alert-dialog-content"][data-overlay-variant="modal"]
  panel selector:    [data-slot="sheet-content"][data-overlay-variant="panel"]
  excluded small-overlay selector family:
                     popover-content / dropdown-menu-content /
                     dropdown-menu-sub-content / select-content / tooltip /
                     toast / context-menu — stay on the base tier in BOTH
                     arms (probed non-contamination)

SURFACES (all judged macros keep the page behind in frame):
  form dialog:    create-course dialog + create-user dialog over card-table
                  pages (1440×900, 1100×800)
  confirm:        unpublish destructive AlertDialog over the open-background
                  sectioned exam-detail page (1440×900, 1100×800)
  large dialog:   import wizard, DialogContent size="lg", CSV
                  preview driven identically in both arms (1440×900, 1100×800)
  sheet:          AdminLayout mobile nav drawer at 1023×800 (below-lg
                  representation), page visible beside the panel

VALIDITY:
  upstream baseline:            PASS (D2 15/15, D3 32/32, D4 5/5, D5 4/4,
                                D6 1/1 — absolute checks, both arms)
  single-variable isolation:    PASS (9/9 modal/panel pairs moved in
                                background-color only, 0 static; arm values
                                equal the two token resolutions as a set)
  overlay dim:                  PASS (9/9 dimmer pairs identical)
  shadow:                       PASS (controlled property, 0 movement)
  radius:                       PASS (controlled property, 0 movement)
  panel edge:                   PASS (edge attribute + widths/colors
                                identical; as-built "right" for side="left")
  small-overlay non-contamination: PASS (7/7 probe pairs identical)
  geometry:                     PASS (99 pairwise comparisons, all deltas
                                0.0px; scroll ownership identical)
  interaction:                  PASS (9/9 state pairs: Escape close, close
                                control, focus containment, scroll lock)
  cross-variable contamination: NONE
  Sheet coverage:               PASS

JUDGE ARTIFACTS (letters only — provide ONLY this bundle to the reviewer):
  judge/README.md
  judge/macro-contact-sheet.png        scaled overview, blind X|Y pairs
  judge/micro-contact-sheet.png        NATIVE-PIXEL crops (modal/drawer edges
                                       with page context, interior bands,
                                       whole destructive confirm, drawer edge,
                                       small-overlay control reference)
  judge/macro/  (18 raw full-viewport captures)
  judge/micro/  (34 raw native crops)

VALIDITY ARTIFACTS — DO NOT SEND TO BLIND JUDGE:
  validity/variant-map.json              (mapping; independent crypto coin flip)
  validity/as-built-surface-inventory.json (clean-product overlay census +
                                           token resolutions — mapping revealing)
  validity/style-proof.json              (computed values per letter)
  validity/geometry.json                 (pairwise geometry oracle)
  validity/overlay-control-proof.json    (dim/shadow/radius/panel-edge/control
                                          group proofs)
  validity/upstream-baseline.json        (D2–D6 absolute proofs)
  validity/state-proof.json              (interaction probes per arm)
  validity/run-manifest.json

EVIDENCE VERDICT:
  READY_FOR_D7_MULTIMODAL_REVIEW
```

## Adjudication contract (for the multimodal reviewer)

- Provide **only** the `judge/` directory. Do not open `validity/` before deciding.
- Judge **only** the large modal/drawer background decision. Chinese-language exam/LMS/admin product. The frozen baselines listed above are identical in both arms — judge the overlay backgrounds RELATIVE to them.
- Blind labels only: Variant X vs Variant Y. The two variants of each pair differ in exactly one property; anything else you notice is identical by construction. The reviewer must never be asked which arm is which tier, which is current, or any token value.
- Use the macro sheet (and raw captures) for relational judgement — modal separation, hierarchy against page background and cards, drawer/page boundary; use the micro sheet for edge/boundary character at native pixels. Every macro keeps the page behind visible: the question is relational.
- Per issue #582 return: `DECISION: X | Y | NO_CLEAR_WIN`, `CONFIDENCE: HIGH | MEDIUM | LOW`, `WHY` (modal separation / hierarchy vs canvas / hierarchy vs cards / visual weight / muddy-crisp character / sheet boundary / cross-surface consistency), `RISKS`, `PAGES / CROPS WHERE DIFFERENCE MATTERED`. "Framework defaults" and "looks cleaner" are not arguments.

## Tie rule (applied only AFTER unblinding)

If and only if the blind judge returns `NO_CLEAR_WIN`, unbind `validity/variant-map.json` and apply the campaign law mechanically: **the current value wins ties** — no production change authorized.

## Boundaries respected

No production visual file changed (0 `apps/web` diffs on this branch — product tree byte-identical to `e6d683cc`). D2–D6 not re-adjudicated (treated as frozen upstream authorities). No radius/shadow/border/dimmer normalization. #582's final decision table not updated; #582 not closed; #590 not touched. Stop gate: `READY_FOR_D7_MULTIMODAL_REVIEW`.
