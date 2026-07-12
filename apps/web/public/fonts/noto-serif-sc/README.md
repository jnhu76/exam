# Noto Serif SC (self-hosted)

Self-hosted Chinese serif family for the **sustained Chinese reading** role only
(`--font-serif`, UI-TYPO-2). This is the project-owned CJK serif; it is NOT a
prestige / formal / important signal and must never be applied to UI controls,
status, scores, timers, tables, or metadata. Consumers must opt into a semantic
reading recipe (`type-reading` / `type-long-response`, UI-RECIPE-1A); serif is
not applied by HTML tag alone.

## Provenance

- **Family:** Noto Serif SC (Simplified Chinese), part of the Noto CJK family by Google.
- **Source package:** `@fontsource/noto-serif-sc@5.2.8` (npm), `chinese-simplified` subset.
- **License:** SIL Open Font License 1.1 (see `LICENSE`). Redistribution and
  self-hosting are permitted under the OFL.
- **Why this subset:** the `chinese-simplified` woff2 from fontsource is a single
  self-contained file per weight (≈1.5 MB), the smallest self-hosted addition
  consistent with an offline-capable LAN deployment. It deliberately differs from
  the sans strategy (unicode-range partitioned into ~382 micro-files): serif is
  used only on sustained-reading surfaces, where loading the full reading face
  up-front is acceptable, so the partitioning overhead is unnecessary.

## Weights shipped

| File                                   | Weight | Role                |
| -------------------------------------- | ------ | ------------------- |
| `…-chinese-simplified-400-normal.woff2` | 400    | reading body        |
| `…-chinese-simplified-700-normal.woff2` | 700    | reading emphasis    |

Only 400 and 700 are shipped (no 500/600): the reading role does not require a
medium weight, and shipping the minimum keeps payload small.

## Wiring

`apps/web/index.html` loads `css/regular.css` and `css/bold.css`. Each declares
`font-family: "Noto Serif SC"` with `local()` hints for system Noto Serif /
Source Han Serif before the self-hosted woff2 fallback. The semantic
`--font-serif` role is defined in `apps/web/src/index.css`.

## Glyph coverage

7946 mapped glyphs covering Simplified Chinese, full-width/half-width
punctuation, digits, and ASCII/Latin — verified against representative
Exam-like probe text (Chinese prose, `Chinese + 2026`, `API/HTTP`, CJK
punctuation, question numbering, full-width parentheses, score notation).
