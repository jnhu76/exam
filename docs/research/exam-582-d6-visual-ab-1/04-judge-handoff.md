# 04 — Judge handoff

EXAM-582-D6-VISUAL-AB-EVIDENCE-1 · this pack is **READY_FOR_D6_MULTIMODAL_REVIEW**.

## What the reviewer receives

Per the campaign handoff law, the reviewer-facing material is ONLY:

```text
judge/README.md                  — the blind judging contract and return format
judge/macro-contact-sheet.png    — scaled full-viewport X|Y pairs (orientation only)
judge/micro-contact-sheet.png    — native-pixel X|Y crops (AUTHORITATIVE for glyph judgement)
```

Supplementary native-pixel sheets live under `judge/micro/<pair>-pair.png`
(short-cjk / medium-cjk / cluster-3 / cluster-overflow / dense-rows) and the
raw captures under `judge/macro/` and `judge/micro/` — same surfaces, letters
only, for readability if the combined sheets are too small to inspect.

## Absolute rule for the reviewer session

- Do **not** open, request, or accept anything from `validity/` — it holds
  the experiment's answer key (`variant-map.json` and the per-letter computed
  records).
- Decide rendered X vs Y only. Do not infer numeric values, which variant is
  "heavier", or which is the current runtime value. Unblinding happens
  mechanically after the blind decision is recorded.
- Return format is in `judge/README.md` (`DECISION` / `CONFIDENCE` / `WHY` /
  `RISKS` / `PAGES / CROPS WHERE DIFFERENCE MATTERED`).
- Campaign tie rule (applied only after unblinding, never shown to the blind
  judge): a `NO_CLEAR_WIN` resolves to the current runtime value.
