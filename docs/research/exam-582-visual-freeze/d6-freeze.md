# d6 freeze — TagBadge font-weight, frozen at 500 (change from as-built 400)

> Compact canonical copy of the final d6 unblind/freeze record.
>
> - source branch: `research/582-d6-visual-ab-1 (PR #592 chain, closed unmerged at closeout)`
> - source exact SHA: `7ee7905d450e7e0232c2f69f741e172e85775373` (last commit touching the freeze record; the D7 snapshot tree carrying every record is `ff1b535902a8f8ee5d21545450a5774f3c1a46d4`)
> - original path: `docs/research/exam-582-d6-visual-ab-1/06-d6-unblind-freeze.md`
> - retained contact sheets: [`contact-sheets/d6-micro.png`](contact-sheets/d6-micro.png) · [`contact-sheets/d6-macro.png`](contact-sheets/d6-macro.png)
>
> Sibling-path references in the record body (`validity/…`, `judge/…`, `artifacts/…`, `0X-*.md`) resolve inside the original research directory, which is preserved only in the raw evidence archive (see [EVIDENCE-MANIFEST.md](EVIDENCE-MANIFEST.md)). The body below is preserved verbatim from the source below its original title line; verdicts are unaltered.

---


Adjudication record for D6 (TagBadge font weight) under issue #582.

The blind multimodal reviewer judged only the rendered X/Y variants from the physically separated `judge/` bundle (`judge/README.md` + the two contact sheets). Mapping-revealing validity artifacts were not consulted until after the blind letter decision.

## Blind verdict

```text
PASS-1
DECISION: Y
CONFIDENCE: MEDIUM

PASS-2 (adversarial review)
VERDICT: UPHOLD Y
CONFIDENCE: MEDIUM

FINAL BLIND DECISION: D6 = Y
```

The reviewer preferred Y because it gave more stable glyph edges and faster recognition on 12px medium-length Chinese tags (消防安全 / 安全培训 / 设备维护 / 应急处置), while — checked explicitly in PASS-2 — not creating a dark tag stripe in 3-tag clusters, `+N` rows or the 8-row dense view, and not competing with the 15px body or the 13px table header for hierarchy. X was acknowledged as slightly quieter, but near the "quiet at the cost of recognition speed" boundary for small Chinese text; the single short tag 安全 was the weakest differentiator and would likely have been a `NO_CLEAR_WIN` on its own. Three consistent evidence groups (medium CJK, CJK+CJK+Latin cluster, dense repeated rows) carried the decision, hence MEDIUM rather than HIGH confidence.

Important discipline: the reviewer did **not** infer which arm was numerically heavier, current, or candidate. Only the rendered letter was selected; numeric interpretation is mechanical after unblinding.

## Unblinding

`validity/variant-map.json` reveals:

```text
X = 400
Y = 500
```

Therefore:

```text
FINAL BLIND DECISION = Y
Y = 500
D6 FINAL = 500 TagBadge font-weight
```

The campaign tie rule (current value wins ties) is **not invoked**: the blind decision was a clear Y, not `NO_CLEAR_WIN`.

## Engineering interpretation

D6 is a **CHANGE from as-built** (unlike D5).

The production authority at the base SHA is:

```css
[data-slot="tag-badge"] {
  font-weight: 400;
}

[data-slot="tag-badge"][data-tag-variant="compact-table"] {
  font-weight: 400;
}
```

Weight is owned by BOTH blocks of the single TagBadge recipe, so the frozen decision requires **500 in both blocks** when implemented. No other TagBadge property (height 22px, size 12px, line-height 16px/18px, padding 6px, radius 4px/3px, colors) moves with it — the experiment held all of them absolutely in both arms.

Implementation is deferred to the campaign's final implementation phase; this evidence branch changes no production file. The numeric coincidence with the frozen D4 table-header weight (500) carries no selector coupling: the change is scoped to the `[data-slot="tag-badge"]` owner blocks only.

The chosen arm was structurally clean, so the decision is a visual-quality choice among two structurally valid candidates, not a correctness repair: row heights and cluster wrapping were identical across arms, the only geometry movement was +1/+2px text advance on two Latin-tag instances (absorbed without reflow), the `+N` chip kept its product styling, and no overflow or alignment artifact appeared in either arm.

## Evidence summary

Frozen upstream environment:

```text
D2 = 15px body/control typography (common block injected in BOTH arms)
D4 = 13px / 20px / 500 governed table header (as-built, re-verified per capture)
D5 = 22px StatusBadge (as-built, probed under the D6 injection)
```

D6 validity facts from the packaged run (`d6-1789914972522`):

```text
D2 common baseline:              PASS — 11/11 complete pairs
D4 frozen baseline:              PASS — 3/3 pairs
D5 non-contamination:            PASS — probed on /admin/exams under the D6 injection
D6 single-variable isolation:    PASS — weight is the only moving property; frozen constants held
Font gate:                       PASS — 8/8 captures; HarmonyOS Sans SC subsets force-loaded
                                 at BOTH weights with the real CJK tag vocabulary
Tag-overflow non-contamination:  PASS — chip stays product 400 in both arms
Geometry:                        16/18 badge widths identical; 2 Latin instances +1/+2px (causal);
                                 CJK advances identical; row heights/wraps identical
Cross-variable contamination:    NONE
Structural artifacts:            NONE (0 wrapped/clipped headers, no overflow, alignment unchanged)
Representation:                  1023 excluded — card mapping drops the tags column below lg
                                 (TAGBADGE_CONTINUES = NO), recorded per arm
```

## Adjudication rationale retained

The highest-value evidence was:

1. Medium Chinese tags — clearest glyph-edge difference at 12px;
2. Three-tag CJK + CJK + Latin cluster — mixed-script clarity at cluster density;
3. Dense repeated rows (8 rows, `+N` chips) — the noise/dominance check that Y passed;
4. Single short Chinese tag 安全 — weakest differentiator, near-tie on its own.

The selected arm was preferred for more stable small-Chinese glyph edges while keeping metadata hierarchy (12px / muted color / subtle surface / small geometry) and table rhythm unchanged.

## Limitations

```text
DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP
```

The visual evidence comes from the only real production consumer: the Question Management `compact-table` tag column. If the default variant ever becomes a real product surface, the same frozen weight must be re-confirmed in that context before treating this decision as covered there. The 1023 boundary is excluded because the responsive card representation renders no tag column at all (as-built classification, recorded per arm in `validity/`).

## Relation to issue #590

The dense-table cell-fitting defect family (#590) is separate and is **not** D6 evidence. The recorded ≤2px badge-width movement and the existing 1100px wrapped-cluster baseline do not authorize any cell-fit, padding or column-width compensation.

## Final state

```text
D2 = FROZEN at 15px body/control
D4 = FROZEN at 13px / 20px / 500 table header
D5 = FROZEN at 22px StatusBadge height (KEEP AS-BUILT)
D6 = FROZEN at 500 TagBadge font-weight (CHANGE from as-built 400; both recipe blocks;
     production implementation deferred to the campaign implementation phase)
D3 = untouched
D7 = untouched
```

`#582` remains open; its final decision table is updated by the campaign tracker step, not by this freeze record.
