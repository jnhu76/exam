# 01 — Protocol

Controlled A/B for D6 (TagBadge font weight): the 12px metadata tag chip renders at `font-weight` **400 vs 500**. The question under adjudication (issue #582): **against the frozen 15px body/control typography, does the heavier TagBadge rendering materially improve small Chinese-tag edge clarity and legibility without making tag-dense rows visually noisy/heavy?**

## Experiment law

Only the TagBadge's `font-weight` changes between the arms. Everything else — build, seed, filtered row set, tag arrays, tag order, routes, DOM state, user, browser, viewport, DPR, zoom, font family/loading, height, size, line-height, padding, radius, border, colors, the `+N` chip, column widths, row heights, table layout — is the identical product.

### Common frozen baseline (both arms): upstream D2 = 15px

Production has not implemented D2 globally yet. Per the frozen D2 decision the body/control tier converges **UP** onto the 15px control tier, so the byte-identical baseline block proven in the D2/D4/D5 campaign is injected in **both** arms:

```css
.type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }
[data-slot="table-cell"] { font-size: 0.9375rem !important; }
```

The style proof re-verifies the absolute baseline per capture: table cells and representative sidebar/control targets must compute **15px in both arms** — otherwise `EXPERIMENT_INVALID_D2_BASELINE` and no evidence is packaged.

### D6 variable (the only cross-arm difference)

Weight ownership lives in BOTH TagBadge recipe blocks (`badge/recipes.css`), so the candidate must be authoritative for the whole owner:

```css
[data-slot="tag-badge"],
[data-slot="tag-badge"][data-tag-variant="compact-table"] {
  font-weight: <candidate> !important;
}
```

Which letter (X/Y) carries which weight is sealed in `validity/variant-map.json` only (independent `crypto.randomInt(2)` coin flip; no forward assumption from D2/D4/D5).

### Frozen TagBadge constants (product values, never injected)

- `height: 1.375rem` = **22px**, `padding-inline: 0.375rem` = **6px**, `font-size: 0.75rem` = **12px** (base block).
- compact-table variant (the production variant, Question Management): `line-height: 1.125rem` = **18px**, `border-radius: 0.1875rem` = **3px**, color `--text-muted`.
- Border width, background, text color, gap are the product's.

### Geometry changes caused by weight are legitimate effects

400 → 500 may alter glyph advance widths and therefore badge width, tag-cluster width, cluster wrapping, `+N` chip position, row height and column pressure. These are **causal geometry effects** — recorded evidence (03-structural-effects.md), never compensated and never classified as contamination. Only a direct non-weight CSS property differing between arms is contamination.

## Evidence surface and actual instance inventory

TagBadge has exactly one production consumer at the base SHA: the Question Management tags column (`QuestionPage.tsx`, `variant="compact-table"`, `maxVisible=3` with the local `[data-slot="tag-overflow"]` `+N` chip). The default variant has **no** real production instance (`DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP`); D6 is therefore decided from the actual compact-table runtime, with the injection still covering both owner blocks. Excluded lookalikes (StatusBadge, question-type Badge, role pills, audit pills, `+N` chip, TagFilterSelect options) are not D6 evidence; the `+N` chip and StatusBadge carry explicit non-contamination guards.

### Fixture rows (real product records, §11–§13)

Eight deterministic questions are seeded through the real question API in a dedicated course, with a representative tag vocabulary: short Chinese (安全 设备 电气 应急 基础), medium Chinese (消防安全 设备维护 安全培训 应急处置), Latin (safety equipment PPE); rows with 1 / 2 / 3 / 4 / 5 / 6 tags so the `+N` chip renders. The harness filters the workbench with the server-side content search (`D6`) so the header band plus all eight fixture rows fit one viewport; the identical filter runs in both arms and pairwise DOM identity (same questions, same tag arrays, same order, same `+N`) is re-proved per capture by the tag oracle.

### 1023 boundary finding (recorded, not repaired)

Below `lg`, Question Management switches to the MobileRecordList card representation. As-built, the card mapping **omits** the tags column (role `tag-list` resolves to priority `low`; low columns are dropped from cards), so governed TagBadges do not render there. Per the campaign law this is classified `RESPONSIVE_REPRESENTATION_CHANGE / TAGBADGE_CONTINUES = NO` and **1023 is excluded from D6**; the runtime probe records the classification.

## Gates per capture

1. **Injection gate**: the variant `<style>` must exist inside `<head>` with an `!important` font-weight rule on both owner blocks — otherwise `EXPERIMENT_INVALID`.
2. **Font gate** (§16): `document.fonts.ready`, computed body stack contains `HarmonyOS Sans SC`, the subsets covering the actual CJK tag vocabulary force-loaded at BOTH weights, `fonts.check` true for 400 AND 500 — else `EXPERIMENT_INVALID_FONT_WEIGHT_FACE` and no adjudication.
3. **Representation gate**: the governed table must actually render at the primary viewports — otherwise `EXPERIMENT_INVALID`.
4. **D2 baseline proof**: table cells and control targets compute 15px in both arms.
5. **D4 frozen proof**: table headers compute 13px/20px/500 in both arms (guarding especially against a broad experimental selector — the D6 candidate weight numerically equals the header weight).
6. **D5 frozen proof**: StatusBadge probed under the D6 injection on /admin/exams — 22px/500/12px identical across arms.
7. **D6 style proof**: tag badges move in font-weight between arms and hold 22px height / 12px size / 18px line-height / 6px padding / 3px radius / 1px border / HarmonyOS family in both; color/background/border identical across arms.
8. **Tag-overflow non-contamination**: the `+N` chip holds the product's own values (including 400 weight) in both arms; position shifts are causal geometry.
9. **Cross-variable contamination guard**: no non-TagBadge target may move in any computed property between arms.
10. **Structural sweep**: document overflow, table scroll state, header wrap/clip, column alignment, action-column reachability, per-row heights, rendered tag/chip counts, cluster line counts, `+N` positions. Recorded, never repaired.

## Viewports

| Viewport | Role |
| --- | --- |
| 1440 × 900 | primary adjudication |
| 1100 × 800 | density-sensitive repeat |
| 1023 × 800 | boundary probe — classified out of D6 (see above) |

## Micro evidence plan (§22–§25)

Native-pixel band crops are authoritative; macro views are orientation only. Bands span the full shell width and start at the header band so every crop keeps the §23 hierarchy (13px header / 15px body / 12px tag) — no specimen-sheet isolation:

- **short-cjk** — single short Chinese tag (header band + first row)
- **medium-cjk** — single medium Chinese tag (header band + first two rows)
- **cluster-3** — three-tag cluster CJK + CJK + Latin (header band + first five rows)
- **cluster-overflow** — the 4/5/6-tag rows with `+1/+2/+3` chips together
- **dense-rows** — all eight rows (repeated tags, visual-noise context)

Tight supplements (body text | tag cluster | adjacent columns) accompany short-cjk and cluster-3. No magnified previews are used: all crops are 1:1 framebuffer pixels (DPR=1).

## Blinding (permanent rule after D4)

The judge renders X/Y only; the numerical direction is revealed mechanically afterward. Judge-facing files carry letters only — no candidate values, no "current/candidate/heavier" language. Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning. Tie rule: if and only if the blind result is `NO_CLEAR_WIN`, the current runtime value (400) wins after unblinding — the judge is never told this.
