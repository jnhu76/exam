# #554 Fresh adversarial review

A fresh-context reviewer (no part in producing 00–06) was given exactly: Issue #554, the #552
roadmap, #545/#546/#547 closeout evidence, documents 00–06, the raw experiment JSON, and repo
access for spot-checking. Required to attack all 20 failure modes of the gate's review protocol
and to verify cited code facts independently.

## Verdict

```text
ACCEPT_WITH_MINORS
MAJOR: none
MINOR: 5 (all presentational; none changed a disposition)
ATTACK LIST: 20/20 points answered NO (no conflation, no technology-first reasoning,
             no smuggled implementation)
CODE SPOT-CHECKS: 10+ facts independently verified against the working tree, 0 refuted
                  (pool shape, SKIP LOCKED uniqueness, readiness budget/no-single-flight,
                  compose topology/profile, O(active) deadline discovery, Redis Lua/namespace/
                  modes, admission partial-unique + CAS gate, pingDb shape,
                  no WebSocket/SSE, advisory locks test-only, raw JSON fidelity,
                  docs-only branch delta, base SHA)
```

## Reviewer's attack-table summary (all NO)

Measurements were run to answer open questions and produced a KEEP-heavy outcome (1);
O(history) classified bounded/watch with reopen triggers, not as a live bottleneck (2); P1
separates acquisition from execution and E28 records non-observability honestly (3); lock
serialization separated from contention with production-cadence argument (4); async loops kept
as M0, DEFER for the queue (5); queue≠completion upheld even hypothetically (6–7); Redis
presence rejected on durable-forensics semantics, not just performance (8); no cache without
hotspot, E29 recorded as UNKNOWN (9–10); no fanout consumers exist (11); no event bus in a
monolith (12–13); M1 seriously compared per-workload and deferred with ADR-003's trigger
register (14–15); operational cost and failure semantics documented (16–17); KEEP/DEFER treated
as valid decisions and stress-tested symmetrically (18); industry comparison kept comparative
(19); branch delta is docs-only, scripts stayed out of the repo runtime surface (20).

## Minors and their resolution (all fixed in this revision)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | T1 row labeled the emulated 38.8 batches/s cadence as "measured capability"; headroom actually derives from per-batch latency | 03: column relabeled "Emulated worst-case cadence result"; margin attribution corrected (per-batch latency ≈9% of one connection) |
| 2 | Dangling §-references (§16/§21/§31/§32) to sections that exist only in the execution brief, not in repo documents | 04/06: replaced with named principles ("lowest mechanism first — no layer skipping"; the Issue's own completion-authority constraints; the issue's event-bus evidence conditions) |
| 3 | D3 reopen trigger was the only unquantified one | 06: made measurable relative to measurement (≥ ~20% steady pool share = an order of magnitude above the measured ~1–2%; no invented absolute thresholds, per the no-fabricated-numbers rule) |
| 4 | D12 disposition "ACCEPT_CURRENT" outside the issue's disposition vocabulary | 06: renamed **KEEP_CURRENT** with the accept-current meaning stated inline |
| 5 | Issue's "Required final report" literal block not emitted as a block | 08: the literal report block is now included verbatim-shaped |

Per the gate protocol: zero MAJOR findings ⇒ no re-measurement or re-review cycle required.
