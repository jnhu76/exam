# #554 Final verdict

```text
VERDICT: KEEP_CURRENT_ARCHITECTURE
READY_FOR_ROADMAP_CONTINUATION: YES
#550 BLOCKED BY THIS GATE: NO (no implementation-producing ADOPT_*; the topology below is final)
```

The PostgreSQL-authoritative, single-instance, in-process-loop, HTTP-polling architecture with
Redis confined to bounded rate-limit coordination **survives the gate on the evidence**. Every
candidate problem measured in #545–#547 and this review is bounded at supported scales,
synthetic, or abuse-induced; every genuinely open item is delegated to #550 with concrete
reopen triggers (06) instead of being converted into infrastructure adoption.

## Required final report (Issue #554 format)

```text
VERDICT:
  KEEP_CURRENT_ARCHITECTURE

MEASURED BOTTLENECKS:
DB QUERY:
  verdict: bounded at supported scales; O(history) reconciliation is scale-dependent watch item
  evidence: #545 MEASURED/QUERY_PLAN (28 ms @1k, 1.1 s @50k episodes/org/tick; cliff fixed;
            index rejected ~0 benefit); deadline discovery O(active) (CODE)
DB POOL:
  verdict: acquisition/execution separation PROVEN in mechanism (2605 ms wait vs 0.36 ms exec
           under synthetic 10/10 hold); production queueing NOT directly observable (honest
           bound); readiness residual bounded by limiter × query cost (≤0.3 conns benign,
           4/10 only at limiter-ceiling abuse × 2.5 s slow DB); harm in supported topology
           NOT_PROVEN
  evidence: P1/RP2/RP3 MEASURED (experiments/p1-rp-results.json); pool shape CODE (max=10,
            no env override); 130-user audit tails HISTORICAL_EVIDENCE → #550 dimension
LOCKS:
  verdict: NO_MATERIAL_CONTENTION; same-row serialization is bounded and does not occur at
           production cadence
  evidence: L1 zero lock waits at 200-way distinct-attempt; L2 exact N×20 ms serialization
TRANSIENT WRITES:
  verdict: ~1–2% of one pool's capacity at the 200-candidate ceiling; NOT a Redis-presence
           trigger; durable-disruption semantics deliberate
  evidence: T1/T2 MEASURED (2733 updates/s vs 6.7/s needed; 2.23 ms/batch at worst-case ingest)
BACKGROUND JOBS:
  verdict: no contention, no backlog class; the only durable-work class already has the PG
           outbox; general queue DEFER_NOT_PROVEN with ADR-003 trigger register
  evidence: loop shapes CODE; W1–W3 mechanism audit; M1 needs #304 authority change + M0
            backstop anyway
MULTI-INSTANCE_COORDINATION:
  verdict: hypothetical (supported topology = 1 instance); forward trigger recorded (first
            breakage class = per-process metrics/alerts/limiter fallback, not durable facts)
  evidence: compose CODE; #546 topology freeze; arbiter/outbox/admission multi-worker safety
            reasoning
FANOUT:
  verdict: REJECT_CURRENT_SCOPE — no SSE/WebSocket exists; ADR-002 triggers unmet
  evidence: repo sweep CODE; ADR-002
CACHE HOTSPOTS:
  verdict: none measured; UNKNOWN recorded honestly; REJECT_CURRENT_SCOPE (NOT_MEASURED)
  evidence: E29; no (high QPS × high cost × staleness-tolerant) read path identified

DURABLE AUTHORITY:
  owner: PostgreSQL (sole) — KEEP_PG_AUTHORITY, restated unchanged

RESPONSIBILITY DECISIONS:
  rate_limit:                  KEEP existing bounded Redis responsibility (ADR-001, #546)
  presence_heartbeat:          REJECT_SEMANTIC_MISMATCH (durable forensic input; ~400× write headroom)
  client_events:               KEEP (PG, low-trust telemetry, 30-day retention; worst case ≈9% of one connection)
  incident_reconciliation:     KEEP_CURRENT_RECONCILIATION (28 ms/tick at semester scale; reopen triggers in 06)
  deadline_work:               KEEP_CURRENT (O(active) discovery; under-lock authority recheck)
  email_outbox:                KEEP_PG_AUTHORITY (ADR-011 Class A outbox — already the industry-default mechanism class)
  general_job_queue:           DEFER_NOT_PROVEN (M1 deferred with concrete reopen triggers; M2/M3 REJECT_CURRENT_SCOPE — correctness designable, no measured property bought)
  external_mq:                 REJECT_CURRENT_SCOPE
  event_bus:                   REJECT_CURRENT_SCOPE
  fanout:                      REJECT_CURRENT_SCOPE
  read_cache:                  REJECT_CURRENT_SCOPE (no measured hotspot)
  readiness_probe_pool:        KEEP_CURRENT (accept-current outcome; residual bounded + reopen triggers; optional non-infra hardening named in rung order: single-flight/cached result first, native cancellation later — best-effort)
  multi_instance_coordination: DEFER_NOT_PROVEN (future; per-responsibility reviews on adoption)
  durable_exam_truth:          KEEP_PG_AUTHORITY

NEW IMPLEMENTATION ISSUES:
  none

#550 TEST-TOPOLOGY IMPACT:
  FINAL TOPOLOGY (see 06): 1 API instance; PG sole authority; Redis = rate-limit only, modes
  unchanged; in-process loops unchanged; no MQ/event bus/cache/fanout. #550 is NOT blocked.
  #550 must additionally instrument pool-queue vs execution under load (E28 bound), run the
  supported #546 proxy/NAT modes, include a composition-realistic long-lived dataset
  (#545 index residual), exercise readiness/alerting paths (#547), and account for postgres.js'
  default randomized ~30–60 min connection lifetime in long-running pool observations (E12).
```

## Acceptance criteria check (Issue #554)

- [x] #545/#546/#547 evidence consumed (01; none marked insufficient — each contributed CODE +
      MEASURED facts).
- [x] Bottlenecks separated into query/pool/lock/transient-write/job/coordination/fanout/cache
      causes (02).
- [x] Every candidate responsibility has an explicit KEEP/ADOPT/DEFER/REJECT disposition
      (06: D1–D13).
- [x] PostgreSQL durable authority explicitly restated, not changed (D1; no separate authority
      decision triggered).
- [x] Redis responsibilities scoped individually; no generic "Redis backend" (D2–D5).
- [x] Background-job need evaluated independently from MQ product choice (04 W1–W3 vs D10).
- [x] Event-bus need evaluated independently from background-job need (D9 vs D11).
- [x] Failure/degradation/restart semantics documented (04 failure table + cost model; nothing
      new adopted, so no unowned semantics created).
- [x] No implementation-producing decision ⇒ no child issues, and #550 is not blocked (06).
- [x] KEEP_CURRENT_ARCHITECTURE accepted as the evidence-based result (this document).

## STOP GATE

This gate ends here by protocol: the evidence PR is handed to human review. No merge, no
implementation child, no #548/#549/#550 start is initiated regardless of how obvious the
KEEP outcome may look. Roadmap continuation (#548/#549 → #550) may proceed only after human
acceptance of this verdict.

## Provenance

- Baseline: master `364d1473989e2642047ba36106482fb287570269` (PR #563 merge), worktree clean.
- Branch: `research/554-infrastructure-trigger-review-1` — docs/research only + raw measurement
  JSON; research probes ran on a throwaway PostgreSQL 18.4 instance (tmpfs, port 5554, deleted
  after evidence capture); no production runtime, schema, configuration, or test surface changed.
- Fresh adversarial review: ACCEPT_WITH_MINORS, 0 MAJOR / 5 MINOR (all fixed, see 07).
