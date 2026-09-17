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

## Corrective round 2 (human review of the draft PR)

The human reviewer independently re-audited the draft and returned: architecture verdict AGREE,
`KEEP_CURRENT_ARCHITECTURE` SUPPORTED, 0 MAJOR / 2 BLOCKING minors / 2 NONBLOCKING minors, PR
verdict `CORRECTIVE_REQUIRED_BEFORE_MERGE`. Both blocking claims were re-verified against the
installed `postgres@3.4.9` source before editing:

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | BLOCKING | Docs claimed "postgres.js has no per-query cancellation / query cancellation is a driver limitation". False for the pinned version: `Query.cancel()` exists (3.4.9 `query.js`), and the pool implements three cancel paths (active → new-connection PG cancel request; assigned-not-active → pre-execution cancel; still queued → removed from queue with `57014`). | 00/01/04/06: reworded as "cancellation exists but is NOT wired" — the readiness path (`pingDb` Drizzle select → await) never retains the underlying `Query` handle. Kept the official boundary: cancellation is best-effort (README: no guarantee, a race can cancel another query; "for fast queries, simply ignoring results" is recommended), so the hardening rung order stays single-flight/cached-result BEFORE wiring cancellation. D12 disposition unchanged. |
| 2 | BLOCKING | Pool defaults recorded `idle_timeout = 0 (never idle-close)`, `max_lifetime = unset`. Actual 3.4.9 defaults: `idle_timeout: null` (no idle close — same behavior, wrong literal) and `max_lifetime` = default fn `60 × (30 + Math.random() × 30)` s ⇒ randomized ~30–60 min per connection. | 00 pool block + E12 corrected; #550 test list (06) and #550 impact block (08) now require long-running pool observations to account for the randomized connection lifetime. No experiment re-run: P1/RP/L/T ran for seconds-to-minutes, far below any lifetime effect. |
| 3 | NONBLOCKING | D3's reopen trigger fixed an arbitrary `≥ ~20% pool capacity` threshold, in tension with the no-fabricated-numbers rule. | 06: replaced with a composition-load trigger — #550 must demonstrate transient-write pool occupancy as a material contributor to business-request queueing/tail latency under the full composed workload; no percentage is fixed in advance. Disposition unchanged (REJECT_SEMANTIC_MISMATCH). |
| 4 | NONBLOCKING | M2/M3 rejection reasons were overstated as correctness-impossible ("work lost on Redis loss", "ack ≠ completion" as unanswerable). Persistent-Redis + PG-reconstruction, or MQ consume → idempotent PG commit → ACK-after-commit, are correctness-designable. | 04: rejection restated as scope- and evidence-based — no measured property bought in the current topology, second stateful substrate added, completion authority unchanged (#304, PG) ⇒ REJECT_CURRENT_SCOPE, not impossibility. Dispositions unchanged. |

Outcome: all four correctives applied; every D1–D13 disposition, the final verdict, and the
#550 topology are byte-for-byte unchanged in meaning. Evidence-discipline fixes only.
