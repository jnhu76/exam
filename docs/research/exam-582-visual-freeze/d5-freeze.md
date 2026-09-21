# d5 freeze — StatusBadge height, frozen at 22px (keep as-built)

> Compact canonical copy of the final d5 unblind/freeze record.
>
> - source branch: `research/582-d5-visual-ab-1 (merged via PR #591)`
> - source exact SHA: `4e9d5b5a08a2cad861db7b75de6c248c2bf90db9` (last commit touching the freeze record; the D7 snapshot tree carrying every record is `ff1b535902a8f8ee5d21545450a5774f3c1a46d4`)
> - original path: `docs/research/exam-582-d5-visual-ab-1/06-d5-unblind-freeze.md`
> - retained contact sheets: [`contact-sheets/d5-micro.png`](contact-sheets/d5-micro.png) · [`contact-sheets/d5-macro.png`](contact-sheets/d5-macro.png)
>
> Sibling-path references in the record body (`validity/…`, `judge/…`, `artifacts/…`, `0X-*.md`) resolve inside the original research directory, which is preserved only in the raw evidence archive (see [EVIDENCE-MANIFEST.md](EVIDENCE-MANIFEST.md)). The body below is preserved verbatim from the source below its original title line; verdicts are unaltered.

---


Adjudication record for D5 (StatusBadge physical height) under issue #582.

The blind multimodal reviewer judged only the rendered X/Y variants from the physically separated `judge/` bundle. Mapping-revealing validity artifacts were not consulted until after the blind letter decision.

## Blind verdict

```text
PASS-1
DECISION: Y
CONFIDENCE: MEDIUM

PASS-2
VERDICT: UPHOLD Y
CONFIDENCE: MEDIUM

FINAL BLIND DECISION: D5 = Y
```

The reviewer preferred Y because, across the most informative contexts (Recovery queue, Grading queue, Scores, Exam list, Users), it provided slightly better glyph breathing room and icon/text balance without any visible table-density penalty. The advantage was consistent but small, so confidence remained MEDIUM rather than HIGH.

Important discipline: the reviewer did **not** infer which arm was numerically taller, current, or candidate. Only the rendered letter was selected; numeric interpretation is mechanical after unblinding.

## Unblinding

`validity/variant-map.json` reveals:

```text
X = 24px
Y = 22px
```

Therefore:

```text
FINAL BLIND DECISION = Y
Y = 22px
D5 FINAL = 22px StatusBadge height
```

## Engineering interpretation

D5 is a **KEEP AS-BUILT** decision.

The production authority at the base SHA is:

```css
[data-slot="status-badge"] {
  height: 1.375rem;      /* 22px */
  border-radius: 0.375rem;
}
```

So no production change is required for D5.

The 24px arm was not structurally invalid: both candidates preserved 48px table rows, produced no new overflow/clipping/collision, kept StatusBadge widths identical, left TagBadge untouched, and passed font/upstream-baseline guards. The final choice is therefore a visual preference among two structurally valid candidates, not a correctness repair.

## Evidence summary

Frozen upstream environment:

```text
D2 = 15px body/control typography
D4 = 13px / 20px / 500 governed table header
```

D5 validity facts from the packaged run:

```text
D2 common baseline:          PASS — 48/48 pairs
D4 common baseline:          PASS — 13/13 pairs
D5 single-variable isolation: PASS — 11/11 pairs moved in height only
Font gate:                   PASS — 22/22
Width guard:                 PASS — 11/11, delta 0.0px
Row height:                  48px in both arms on all pairs
TagBadge non-contamination:  PASS — 2/2
Cross-variable contamination: NONE
Icon-bearing coverage:       PASS
Text-only coverage:          PASS
Structural artifacts:        NONE
```

## Adjudication rationale retained

The highest-value surfaces were:

1. Recovery queue — icon-bearing and text-only statuses in the same dense diagnostic context;
2. Grading queue — dense warning/manual-grading badges;
3. Scores — destructive/pass-fail statuses;
4. Exam list — lifecycle statuses;
5. Users — account statuses (weakest differentiator, close to a tie).

The selected arm was preferred for slightly more stable vertical breathing room while preserving the same row rhythm and visual density. The macro evidence did not show the status column becoming pill-heavy or more dominant.

## Relation to issue #590

The separately confirmed dense-table boundary defects (role pill, relation text, long datetime/window values) are tracked in #590 and are explicitly **not** D5 evidence. D5 does not authorize changing D2/D4 typography, TagBadge, local role/action pills, or table-fit policy.

## Final state

```text
D2 = FROZEN at 15px
D4 = FROZEN at 13px / 20px / 500
D5 = FROZEN at 22px StatusBadge height (KEEP AS-BUILT)
D6 = untouched
D3 = untouched
D7 = untouched
```

`#582` remains open. Production implementation is still deferred to the campaign's final implementation phase; D5 itself requires no production change because the frozen value already matches as-built authority.
