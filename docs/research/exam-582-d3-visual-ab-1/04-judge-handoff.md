# 04 — Judge handoff

The reviewer-facing handoff is **only**:

```text
docs/research/exam-582-d3-visual-ab-1/judge/README.md
docs/research/exam-582-d3-visual-ab-1/judge/macro-contact-sheet.png
docs/research/exam-582-d3-visual-ab-1/judge/micro-contact-sheet.png
docs/research/exam-582-d3-visual-ab-1/judge/macro/   (raw full-viewport pairs)
docs/research/exam-582-d3-visual-ab-1/judge/micro/   (raw native-pixel crops + per-group sheets)
```

No validity artifact ships with the judge bundle. Everything under `validity/` — including `variant-map.json` — is mapping-revealing and must not be provided to the blind multimodal judge before its verdict is recorded.

The judge reads `judge/README.md` and answers exactly the contract printed there:

```text
DECISION: X | Y | NO_CLEAR_WIN
CONFIDENCE: HIGH | MEDIUM | LOW
WHY: …
RISKS: …
PAGES / CROPS WHERE DIFFERENCE MATTERED: …
```

The judge never sees numbers for the decision dimension, the as-built split, or any roundness-direction language — the pack was built and scanned for that discipline (`judge/README.md` names the frozen upstream tiers, as the D5/D6 packs did).

On `NO_CLEAR_WIN`, the D3-specific tie rule applies (task §25): the current runtime is a **split** (fields at one radius, buttons at another), so a tie means `D3 = NO_CLEAR_WIN / CURRENT SPLIT PRESERVED / no convergence authorized` — neither candidate may be chosen mechanically. The unblinding and freeze belong to a later commit in the D5/D6 pattern (`06-d3-unblind-freeze.md`); this pack stops at `READY_FOR_D3_MULTIMODAL_REVIEW`.
