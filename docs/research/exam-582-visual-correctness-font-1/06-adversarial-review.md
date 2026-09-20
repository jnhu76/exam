# 06 — Adversarial Review

Self-critique of this audit's evidence, method, and conclusions. Purpose: what would a hostile reviewer attack, and does the verdict survive?

## A1 · "Your CJK font proof is not proof"

Correct that advance-width is not a CJK discriminator (all full-width ideographs are 1em). The audit does not rest on it. The load-bearing evidence is: (a) subsets covering the page codepoints are fetched 200 in a cache-free context and report `loaded` in `document.fonts`; (b) HarmonyOS is first in the single computed stack with no override — per CSS font matching the renderer must use a loaded face of the first family that covers the codepoint; (c) the Latin differential (243 vs 220.4px) proves the family resolves to real font data rather than falling through. Residual risk: an element could render a codepoint whose subset silently failed — but a failed fetch would leave the face `unloaded`/`error`, and no page showed cjk-400 `check()=false`. Verdict survives; the residual UNKNOWN is documented in 04/05.

## A2 · "You only proved horizontal scroll at one width on one archetype"

True. At ≥1023 nothing overflows, so the scroll machinery is only exercised by the 700×800 audit-logs probe. Defense: that is the only place the product actually scrolls horizontally in the audited matrix; proving machinery on a case that never engages would prove nothing. The machinery itself (overflow-x:auto owner, scrollLeft reachability, `data-scroll-end`, fades/hints, last-cell reachability) verified where it runs. Residual: management-list horizontal scroll below lg is structurally unreachable (mobile cards replace the table), and detail-comparison sticky-column behavior never rendered (no such table under this seed). Recorded, not hidden.

## A3 · "Wheel ergonomics unproven" — per the task contract, programmatic + geometry proof is the accepted floor when automation cannot prove wheel feel. Browser Use backend was unavailable (`agent.browsers.list()` → `[]`); the standing multimodal patrol has no wheel probe either. Consequence for D2–D7: none of the six variables (size/radius/typography/badge height/weight/surface) depends on wheel ergonomics.

## A4 · "Visual judges could have missed things / hallucinated overlap"

Findings were not accepted on judgment alone: both MEDIUM findings were re-verified with deterministic DOM measurements (`badge-overflow-dom-probe.json`), including exact px positions at a second viewport band by the judges. PASS verdicts carry no risk to the A/B decision unless a missed defect systematically biases one A/B variant — impossible here, since A/B variants will be captured from the same code with one variable toggled.

## A5 · "Your seed is synthetic; real deployments differ"

True. Density was deliberately raised (20-row tables, 6-char CJK action labels, tagged questions) and that synthetic density is exactly what surfaced F-1/F-2. Real deployments with longer titles could stress other cells (e.g. exam titles truncate via `DataTableOverflowText`). For the D2–D7 decision the relevant surfaces are the same; the A/B protocol must reuse the same seed for both variants (issue #582 already requires identical data).

## A6 · "The audit harness grew 12 questions per rerun"

Each full rerun adds 12 stamped questions + a teacher + an exam. Final-run numbers are cited throughout; the growth only increases density (favorable for correctness probing) and never reuses identity (unique stamps). No cross-run contamination of evidence.

## A7 · "The sticky-topbar check on candidate pages produced false flags"

Yes — the first scan flagged the take page's non-sticky header. Verified against `ExamLayout` source: non-sticky is the documented design; the check was scoped to admin layouts where the sticky contract exists. Final scan: 0/30 flags. The correction is recorded here rather than silently dropped.

## A8 · "Tab/state contamination between captures"

Each capture navigates fresh (`goto` + networkidle + `document.fonts.ready` + 400ms settle), resets horizontal `scrollLeft` after testing, and vertical scroll resets to top before the next capture. The dialog test closes via Escape before the next viewport. Console/page errors were collected per capture (none surfaced in the final run).

## A9 · "You might have changed production behavior"

Repo-tree diff on this branch: `apps/e2e/patrol/ui-visual-correctness-582.spec.ts` (new, evidence only), `apps/e2e/scripts/probe-badge-overflow-582.mjs` (new, confirmatory probe), this research directory. Zero production files touched; `pnpm`-level gates (`check-code-quality`) pass. The e2e database received only seed data through product APIs.

## Conclusion

The two MEDIUM visual findings, the font-truth confirmation, and the READY decision survive adversarial review. The honest unknowns (CJK glyph metrics, wheel feel, unrendered detail-comparison archetype) are recorded and none of them gates D2–D7 adjudication.
