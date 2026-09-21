# EXAM #582 — Reusable Test Candidates

The campaign's ~2,000-line one-off A/B harnesses (runtime style injection, blind capture packs, per-surface validity JSON) are research apparatus, archived externally — **not** preserved as permanent tests. This file records the evergreen regression checks the research implies, for extraction as small focused tests when the corresponding surfaces are next touched. Nothing here is implemented in the closeout.

## Candidates

| Candidate | Evergreen assertion | Suggested shape |
| --------- | ------------------- | --------------- |
| HarmonyOS font actually loads | Runtime network probe: HarmonyOS CSS + woff2 requests 200; computed font stack is the single product stack on probed elements (no local override); Latin render differential distinct from fallback | E2E patrol assertion (Phase-1 `04-font-truth.md` machinery) |
| StatusBadge ownership remains singular | Exactly one recipe owns `[data-slot="status-badge"]` height/radius; no competing override anywhere in `apps/web` styles | Static/stylelint-style or unit check against recipes |
| TagBadge ownership remains singular | Exactly the two `[data-slot="tag-badge"]` owner blocks define weight; no second definition appears | Static check |
| D2 body/table-cell semantic owner has no competing override | The body typography recipes + governed table cells remain the single authority for their font-size; no ad-hoc `font-size` overrides appear on governed table content | Static check over `apps/web/src` |
| Dialog/Sheet surface authority remains in surface recipes | Modal/panel background/border/radius/shadow are defined only by `.surface-overlay[data-overlay-variant=…]` recipes; component files carry no overlay surface styling | Static check |
| Small-overlay background remains independent of modal/panel | The `.surface-overlay` base tier background can change without moving `data-overlay-variant="modal"|"panel"` values (and vice versa after D7) | Unit test over the CSSOM / recipe fixture |
| Table content never crosses cell boundary (#590) | Fixed-layout governed tables: widest pill/tag content fits its column (or is reserved/truncated); page-local pills route through governed badge recipes | E2E with dense CJK seed data (Phase-1 DOM-probe technique; belongs to the #590 fix) |
| Horizontal table scroll reaches final column | In forced-overflow tables, `scrollLeft` full range + `data-scroll-end` + last cell reachable (700×800 probe from Phase-1 `03-scroll-audit.md`) | E2E patrol assertion |

## Extraction rules

- Extract as small, named tests against the **product** selectors — not by porting the research harness's variant-injection machinery.
- The dense-CJK seed vocabulary from the campaign (medium Chinese tags, 3-tag clusters, 8-row dense views) is the valuable part for #590 work; reuse the vocabulary, not the 2,000-line specs.
- Each extraction happens in the PR that owns the surface (e.g. the #590 fix owns the cell-boundary candidates; the unified visual implementation PR owns the ownership-singularity checks).
