# EXAM #582 — Visual Freeze (D2–D7)

This directory is the **compact canonical record** of the #582 visual research campaign: the frozen D2–D7 decisions, the reasoning that produced them, the audit trail to the raw evidence, and the mechanical implementation contract for the future production task.

Campaign status:

```text
VISUAL_ADJUDICATION_COMPLETE
IMPLEMENTATION_PENDING
```

## Reading order

| Document | Content |
| --- | --- |
| [FINAL-DECISIONS.md](FINAL-DECISIONS.md) | The one authoritative frozen decision matrix D2–D7, with recorded caveats |
| [IMPLEMENTATION-CONTRACT.md](IMPLEMENTATION-CONTRACT.md) | Frozen mechanical implementation authority — the only design input the future implementation PR needs |
| [d2-freeze.md](d2-freeze.md) … [d7-freeze.md](d7-freeze.md) | Per-decision adjudication records (blind verdict, confidence, mapping, rationale, limitations) — preserved verbatim from the campaign's `06-unblind-freeze` records |
| [PHASE1-BASELINE.md](PHASE1-BASELINE.md) | Pre-A/B Phase-1 findings that still matter (font truth, table/scroll audit, #590 separation) |
| [EVIDENCE-MANIFEST.md](EVIDENCE-MANIFEST.md) | Audit bridge: per-decision source branch/SHA, retained contact-sheet hashes, raw archive location + SHA256 |
| [REUSABLE-TEST-CANDIDATES.md](REUSABLE-TEST-CANDIDATES.md) | Evergreen regression tests worth extracting from the research, to be built later |
| [contact-sheets/](contact-sheets/) | 12 adjudicated sheets — one micro + one macro per decision — for fast future visual verification without reopening the raw archive |

## Raw evidence

The full research apparatus (≈529 files / 36.7 MB uncompressed: all raw screenshots, validity JSON, variant maps, run manifests, the one-off A/B harness and contact-sheet builders, plus the complete per-decision research directories) is **not** kept in the active tree. It is preserved in the external research archive:

```text
release:  research-exam-582-visual-v1 (asset exam-582-visual-research-evidence-v1.tar.gz)
SHA256:   9574aba557f9187fd8c5e94279ad4fcde529325c9258b33d0254add45c51f487
source:   full research tree at ff1b535902a8f8ee5d21545450a5774f3c1a46d4
          (origin/research/582-d7-visual-ab-1 tip — inherits the whole campaign chain)
```

See [EVIDENCE-MANIFEST.md](EVIDENCE-MANIFEST.md) for the per-decision provenance mapping.

## Scope laws

- Nothing in this directory freezes or authorizes production visual changes by itself; the campaign's unified implementation PR is the authorized vehicle ([IMPLEMENTATION-CONTRACT.md](IMPLEMENTATION-CONTRACT.md) defines its exact mechanical scope).
- `#590` (dense-table cell fitting) is deliberately sequenced **after** the frozen visual implementation, because D2 14→15 and D6 400→500 change text-width pressure; repairing cell fitting against the obsolete typography baseline would be wasted work.
- Historical detail (experiment bring-up runs, invalidated runs, per-capture manifests) lives in the raw archive and the merged/closed research PRs (#588, #589, #591, #592, #593), not here.
