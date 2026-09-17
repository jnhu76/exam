# #554 Decision matrix

One explicit disposition per responsibility (D1–D13), each with its measured trigger, root-cause
class, current mechanism, reopen trigger, and the minimum-mechanism challenge. Allowed
dispositions follow Issue #554; `KEEP`/`DEFER`/`REJECT` are decisions, not failures.

| ID | Responsibility | Measured trigger | Root cause (02) | Current mechanism | Decision | Why (evidence) | Reopen trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Durable exam truth | none — no correctness or scale evidence against PG | — | PostgreSQL sole authority (repos only) | **KEEP_PG_AUTHORITY** | E01; no evidence class in 02 touches durable correctness; Redis/MQ candidates all fail §16 completion-authority or loss semantics | Only via a separate, explicit authority decision (ADR-level); never by convenience |
| D2 | Rate-limit coordination | none new; #546 closed the identity/topology question | — | bounded Redis counters (ADR-001), local fallback, required=fail-closed | **KEEP existing bounded Redis responsibility unchanged** | E02, E26; #546 freeze; no second responsibility earned | Redis outage semantics proven insufficient in a supported topology; or a NEW measured coordination need that PG-local mechanisms (L1–L3) cannot satisfy |
| D3 | Presence / heartbeat | PG transient-write headroom ~400× (heartbeat), ~10×+ (client events) at the 200-candidate ceiling | Q5 measured NOT material; Q3 n/a | candidate heartbeat → PG `last_activity_at`; durable disruption episodes | **REJECT_SEMANTIC_MISMATCH** (+ no measured trigger) | E20–E22: writes are 1–2% of pool capacity; "presence" here IS durable forensic input (interruption compensation, incidents) — an ephemeral TTL store cannot own it, and as a hint it optimizes an unmeasured cost | These paths' measured steady pool share growing by an order of magnitude (≥ ~20% of pool capacity, vs ~1–2% measured) at #550 scales AND a product decision that liveness observation is separable from durable disruption facts |
| D4 | Realtime fanout / push | product has zero SSE/WebSocket; ADR-002 triggers unmet | Q8 not present | HTTP polling 5–30 s | **REJECT_CURRENT_SCOPE** | E04, ADR-002 | ADR-002's documented triggers met by operational evidence (polling staleness unacceptable), or a supported multi-instance topology needs cross-instance push |
| D5 | Read cache | no measured hotspot (no high-QPS × high-cost × staleness-tolerant read identified) | Q9 not proven | direct PG reads everywhere | **REJECT_CURRENT_SCOPE** (NOT_MEASURED) | E29 recorded as UNKNOWN honestly; proctor/ops reads are scoped indexed projections at ≤200 candidates | A measured hotspot: named query + QPS + cost + data size + invalidation owner + staleness tolerance, all evidenced |
| D6 | System-incident reconciliation | steady tick 28 ms @1k episodes (semester), 1.1 s @50k, cliff FIXED; no current trigger | Q1/Q2 bounded, scale-dependent | stateless reconciliation + chunked arbiter probe (#545) | **KEEP_CURRENT_RECONCILIATION** | E08–E10; #545 proves full enumeration is the smallest correctness-preserving candidate set; M1 queue still requires M0 as backstop (04) and an #304 authority change to be correct | Measured: reconciliation routinely fails to settle within its cadence bound (monitor's k×interval stall semantics), or pool-queue share dominates scan execution at #550, or a supported multi-instance runtime is adopted, or #550's composition-realistic long-lived dataset re-opens the #545 index decision with plan-level benefit |
| D7 | Deadline work | discovery is O(active), ms-scale at ceiling | Q6 not present | scanner candidate discovery + under-lock authority recheck | **KEEP_CURRENT** | E11; deadline "work" is derived discovery, not enqueued work (ADR-003 Class D caution) | Scanner-specific review trigger (ADR-003): measured scan cadence overrun or a supported multi-instance ownership need |
| D8 | Email outbox | none — existing Class A adoption is the industry-default shape | — | PG transactional outbox, SKIP LOCKED, lease+recovery | **KEEP_PG_AUTHORITY** (workload-specific outbox; already M1-shaped) | E07, ADR-011, 04/W3, E25(2) | A second Class-A/B workload with measured duplicated-lifecycle debt → ADR-003 "generic platform" review, not an opportunistic move |
| D9 | General background job queue | no work class requires it; the one durable-work class is already served by the outbox | Q10 not present | none (by ADR-003 DEFERRED) | **DEFER_NOT_PROVEN** | 04/W1–W3: M1 adds a second fact class while M0 remains the correctness backstop; M2 fails loss semantics; no trigger in 02 | A demonstrated Class B workload (measured request-budget overrun for export/import/recompute) or duplicated worker-lifecycle debt across ≥2 independent workloads (ADR-003's own trigger register) |
| D10 | External MQ | no broker-shaped workload exists | Q10/Q11 not present | none | **REJECT_CURRENT_SCOPE** | 04 failure table: ack≠completion unanswerable; no independent consumers; no replay requirement; ops cost unbought | An integration requirement with an INDEPENDENT consumer and a bounded workload evidenced against M0/M1 |
| D11 | Event bus | single monolith, single DB, in-process consumers only | Q11 not present | none | **REJECT_CURRENT_SCOPE** | E03/E04; none of the issue's event-bus evidence conditions (independent consumers / cross-service integration / replay / audit-export / external downstream) exists; industry comparison shows buses appear only with real integrations (E25) | Cross-service integration, replay/export requirement, or an external downstream system appearing in product scope |
| D12 | Readiness probe pool behavior | callers bounded (timeout@2s) under full block AND 2.5 s slow DB; abandoned pings ≤4/10 pool ONLY at limiter-ceiling abuse × slow DB; benign ≤0.3 conns | Q3, bounded | 2 s budget, no cancellation (driver limitation), no single-flight | **KEEP_CURRENT** (the readiness-pool-residual "accept current" outcome: no focused follow-up is created by this gate); hardening, if ever wanted, is L1/L2 non-infra (single-flight probe or short-TTL cached result) — a candidate focused NON-INFRA issue, not a dependency | E13–E17: correct not_ready semantics under every measured scenario; harm NOT_PROVEN_IN_SUPPORTED_TOPOLOGY; queue-backlog is client-side and drains instantly (measured) | Readiness probe rate materially increases (new consumer), probe query stops being trivial, or #550 shows pool-queue dominance attributable to probes |
| D13 | Multi-instance coordination | supported topology = 1 instance (compose; runbook; load-test topology) | Q7 hypothetical | none needed; Redis shared limiter is the only cross-instance state | **DEFER_NOT_PROVEN** (FUTURE; forward trigger recorded below) | E05; durable correctness would largely survive 2 instances today (arbiter converges concurrent reconcilers #545-T7; outbox claim is SKIP LOCKED multi-worker-safe; admission CAS+unique is instance-agnostic; deadline scanner re-checks under lock) — the FIRST breakage class is per-process state: in-memory metrics/stall alerts, alert dedupe, and process-local limiter fallback sizing | Adopting a supported multi-instance runtime (a product/deployment decision) — which then triggers per-responsibility reviews (D6 scanner ownership, alert coherence, limiter budgets), not a blanket Redis/MQ adoption |

## Minimum-mechanism challenge (§31)

For every `ADOPT_*` candidate the gate was required to name the acceptance property that fails
without it. Result: **no candidate survived to that question** — after the ladder walk (04), no
measured property requires Redis presence, fanout, cache, a jobs table, an MQ, or an event bus;
every measured property is satisfied by the current mechanism at L0–L2. Symmetrically, the
KEEP/REJECT dispositions were challenged: for each, the property that would fail if the current
mechanism were DELETED is concrete and stated in 04's failure table (e.g., deleting the outbox
breaks email durability; deleting stateless reconciliation breaks #304 anti-horizon delivery;
deleting the readiness probe breaks #547's deployment gate). No KEEP rests on convenience.

## #550 FINAL TOPOLOGY (output of this gate)

```text
API instances:            1 (compose-supported; nothing new)
PostgreSQL:               sole durable authority (unchanged, D1)
Redis mode:               off (default) | optional | required — as today, operator-chosen
Redis responsibilities:   shared/global rate limiting ONLY (unchanged, D2)
background workers:       in-process loops: heartbeat+reconciliation, deadline, email outbox,
                          client-event retention, operability monitor (unchanged, D6–D8)
MQ:                       none (D10)
event bus:                none (D11)
fanout/push:              none — HTTP polling (D4)
cache:                    none (D5)
proxy topology:           DIRECT_LAN | SHARED_NAT | REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP (#546, unchanged)
readiness:                /api/ready gated compose healthcheck + operability.* alerts (#547, unchanged)
```

`#550 BLOCKED` by this gate: **NO** — the gate returns no implementation-producing `ADOPT_*`,
so #550's prerequisite is satisfied by this decision itself. #550 must run the topology above.

## What #550 must test (inheriting this gate's residuals)

20 / 50 / 100 / 130 / 200 candidates; login/start burst; answer-save + heartbeat steady state;
proctor monitoring reads; submit/grading burst; refresh/reconnect storm; NAT and trusted-proxy
topologies (#546 modes); representative long-lived historical dataset (reconciliation + retention
paths; composition-realistic interruption-event table — the #545 index-residual note);
DB-pool pressure explicitly instrumented as pool-queue vs execution (E28: pool queue time is
not directly observable in production — #550 should decide whether a research-only
instrumentation harness is needed to separate them under load); reconciliation cadence
consumption at the tested dataset sizes.
