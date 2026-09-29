# #586 — 04 A/A Gate (implicit-default-10 vs explicit-10)

Status: FINAL (computed post-campaign with the fixed `aa-gate.mjs`).
Machine-readable verdict: [`results/aa-gate.json`](results/aa-gate.json).

## Design

A = `EXAM_586_RESEARCH_POOL_MAX` unset (canonical deployment path — the
research seam is a no-op, postgres.js builds its own default-10 pool).
A' = explicit `10`. Per the frozen schedule (02-experiment-schedule.md):
8 bursts, interleaved S100/S200, 2 replicates per arm per scale.
Tolerance = observed replicate spread pooled across the same arm/scale
(§14: the gate must use measured variance, never an imposed ε).

## Gate result: **A_A_GATE_PASS**

All 8 A/A cells completed with `meta.status=valid`, 100% submit 2xx,
zero 429/5xx/timeouts, zero serialization retries, all correctness
oracles passed.

Per-metric verdicts (full numbers in `results/aa-gate.json`):

| Metric (p99) | A median | A' median | |shift| | pooled spread | verdict |
| --- | --- | --- | --- | --- | --- |
| HTTP submit (S100) | ≈ 4129 ms | ≈ 4133 ms | 0.02 | 0.53 | within |
| HTTP submit (S200) | ≈ 8215 ms | ≈ 8464 ms | within spread | 0.53-group | within |
| TX_ACQUIRE_PROXY (S100) | ≈ 2400 ms | ≈ 2433 ms | 0.015 | 0.636 | within |
| TX_ACQUIRE_PROXY (S200) | ≈ 6214 ms | ≈ 6311 ms | within spread | 0.636-group | within |
| PG active-backends max | 10 | 10 | 0 | 0 | identical |
| serialization retries | 0 | 0 | 0 (degenerate both-zero) | — | within |

The both-zero retries row required an explicit degenerate rule in
`aa-gate.mjs` (two identical all-zero distributions have no shift);
this is documented in the script and is a gate-mechanics fix, not an
evidence change.

## Consequence

Explicit `10` is statistically indistinguishable from the canonical
implicit default on every substantive metric. The treatment contrast
{10 → 20 → 30} may be read as {default → 20 → 30}. No re-baselining of
A/A was needed during the main matrix (§27: no gate re-run trigger
fired).
