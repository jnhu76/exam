# EXAM-547 — Alert contract: canonical home

The operability alert contract is LIVE product documentation, not historical
evidence, so its canonical home is:

> **[`docs/operations/active-alerting.md`](../../../operations/active-alerting.md)**
> (event catalogue, stability/content guarantees, minimal external hook
> contract, and the explicit not-alerted list)

It was frozen in THIS directory during #547 design and moved to
`docs/operations/` at adversarial-review closeout (a contract must not live
in the evidence tree where it would silently drift from the product). The
executable pins live in `apps/api/src/plugins/operabilityMonitor.test.ts`
(full catalogue, wired end to end via `evaluateOperabilityTick`) and in
`tests/deployment/readiness-gate.sh` D2/D3 (readiness transitions on a real
Compose topology).

This file is retained as the evidence-trail pointer required by the #547
brief's evidence layout (00–04).
