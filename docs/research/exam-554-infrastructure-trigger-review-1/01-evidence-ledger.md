# #554 Evidence ledger

Every load-bearing claim used by the decision matrix (06) is registered here. Evidence types are
restricted to: `CODE`, `MEASURED`, `QUERY_PLAN`, `LOAD_PROBE`, `DEPLOYMENT_PROBE`,
`HISTORICAL_EVIDENCE`, `INDUSTRY_COMPARISON`, `INFERENCE`, `UNKNOWN`. `INFERENCE` never solely
supports an `ADOPT_*`.

| ID | Claim | Source | Evidence type | Confidence | Decision impact |
| --- | --- | --- | --- | --- | --- |
| E01 | PostgreSQL is the sole durable exam-fact authority; access only via repositories | `packages/db/src/schema/pg.ts`, repo layer, AGENTS §5 | CODE | high | D1 KEEP_PG_AUTHORITY |
| E02 | Redis's only adopted responsibility is shared/global rate limiting (bounded Lua counters, TTL mandatory, HMAC keys; modes off/optional/required) | ADR-001; `apps/api/src/redis/rateLimitStores.ts`, `redisRuntime.ts` | CODE | high | D2 KEEP; no expansion |
| E03 | No Redis pub/sub, cache, session, presence, or lock usage exists anywhere | repo sweep (publish/subscribe/cache/session keys) | CODE | high | D3/D4/D5 reject-by-default framing |
| E04 | No WebSocket/SSE endpoints exist; client is pure HTTP polling (5–30 s cadences) | repo sweep; `ADR-002` DEFERRED; web page poll intervals | CODE | high | D4 REJECT_CURRENT_SCOPE |
| E05 | Supported topology is ONE API instance; compose = app + db (+ redis profile off by default) | `docker-compose.yml`; #546 topology freeze | CODE | high | D13 NOT_PROVEN/FUTURE |
| E06 | Admission (`requireQueue`) is durable PostgreSQL already: `exam_admissions` partial unique + CAS; consumed inside attempt-start tx; no process-local queue Map exists | `packages/db/src/repository/examAdmissionRepo.ts`, `attempts.candidate.ts:590-720` | CODE | high | D7-adjacent; no queue infra needed for admission |
| E07 | Email outbox = PostgreSQL transactional outbox with `SKIP LOCKED` claim, lease + `recoverAbandoned`, durable `worker_heartbeats` (5 s) | `emailOutboxRepo.ts:272`, `emailOutboxLoop.ts`, ADR-011 | CODE | high | D8 KEEP_POSTGRES_OUTBOX |
| E08 | Incident reconciliation is O(history) per org per 30 s tick by design (smallest correctness-preserving candidate set, #304 arbiter) | #545 00-baseline/02-correctness | CODE | high | D6 input |
| E09 | Reconciliation steady tick MEASURED: 28 ms @1k / 215–227 ms @10k / 1058–1220 ms @50k episodes/org; delivery pass ~107 ms–1.9 s; 3-org 61k-episode whole loop ≈1.4 s | #545 01-query-plans, 03-final-verdict (`plans/` raw EXPLAIN committed) | MEASURED + QUERY_PLAN | high | D6 KEEP_CURRENT_RECONCILIATION |
| E10 | 65,533-parameter probe cliff FIXED by 10k-id chunked probe; probe wall unchanged (459 vs 479 ms @50k); index candidate measured ~0 benefit and REJECTED | #545 01/03 + raw plans | MEASURED | high | no queue/index reopening without new evidence |
| E11 | Deadline scanner discovery is O(active) (status IN in_progress/disrupted + deadline/closeAt predicate), not O(history); per-candidate short REPEATABLE READ tx, authority re-checked under lock | `attemptRepo.ts:410-490` (`listDeadlineCandidates`), `deadlineScanner.ts` | CODE | high | D7 KEEP_CURRENT |
| E12 | Pool shape: postgres.js runtime pool created with NO options → max=10, connect_timeout 30 s, idle_timeout 0, no env override; ALL work (requests + 5 loops + readiness) shares it | `packages/db/src/postgres.ts:32-34`; settings sweep | CODE | high | D3/D12 input |
| E13 | Readiness probe: 2 s `Promise.race` budget; losing ping is NOT cancelled (postgres.js has no per-query timeout); no single-flight/dedup of HTTP probes; monitor tick 15 s internal probe | `operabilityMonitor.ts:27,93-110`, `apiSurface.ts:80-100` | CODE | high | D12 residual definition |
| E14 | P1: idle-pool probe p50 0.36 ms / p95 0.53 ms; pool fully held (10/10) → first probe 2605 ms total (acquisition ≈ 7200× execution, equals holder remaining hold); K=15 holders ⇒ identical probe wait (extra holders queue client-side only) | `experiments/p1-rp-results.json` (P1) | MEASURED | high | DB_POOL classification |
| E15 | RP2: under full 45 s pool block, 5 benign-cadence readiness probes → all `timeout@~2001ms` (caller bounded, correct not_ready); 25-probe abusive burst → 25×`timeout@2001ms`, 0 errors; business query through same pool waited 44.6 s; abandoned pings invisible server-side (0→1 statements); after release drain ≈ instant, next probe 0.5 ms | `experiments/p1-rp-results.json` (RP2) | MEASURED | high | D12 verdict |
| E16 | RP3: slow-DB (2.5 s/ping) at limiter-ceiling abuse 100/min sustained 60 s → 100/100 caller timeouts (bounded), pool occupancy steady 4/10 (= Little's law 4.2); benign 6/min cadence → ~0.25 connections | `experiments/p1-rp-results.json` (RP3) | MEASURED | high | D12: bounded by limiter × query cost |
| E17 | Readiness HTTP probe rate is bounded: `/api/ready` sits inside the /api limiter (100/min/IP); compose healthcheck consumes it at 2/min from loopback; monitor probes internally at 4/min (not HTTP) | #547 semantics §3 abuse audit; `docker-compose.yml`, `operabilityMonitor.ts` | CODE | high | D12 materiality bound |
| E18 | L1: 200 concurrent heartbeat-shaped txs on DISTINCT attempts → zero lock waits (pg_locks sampled), wall 144 ms, per-tx p50 96 ms dominated by pool waves not locks | `experiments/lt-results.json` | MEASURED | high | LOCKS: no material contention |
| E19 | L2: 50 concurrent txs on SAME attempt (20 ms in-tx work) → wall 1157 ms ≈ N×20 ms exact serialization; bounded expected serialization, production never does this (1 heartbeat/attempt/30 s) | `experiments/lt-results.json` | MEASURED | high | LOCKS classification |
| E20 | T1: worst-case client_events ingest at 200 candidates (40×20-row batches/s sustained) → p50 2.23 ms/batch, max 8.8 ms; ≈9% of one pool connection | `experiments/lt-results.json` | MEASURED | high | D3 transient writes |
| E21 | T2: heartbeat-shaped single-row UPDATE throughput 2733/s (p50 0.6 ms) vs production worst-case 6.7 writes/s at 200 candidates (~400× margin) | `experiments/lt-results.json` | MEASURED | high | D3: no Redis presence trigger |
| E22 | Heartbeat disruption facts are deliberately durable (episodes feed interruption-time compensation + incidents; ADR-013/014) — presence is NOT ephemeral-only in this product | `heartbeat.ts`, ADR-014 | CODE | high | D3 REJECT_SEMANTIC_MISMATCH |
| E23 | 130-user audit load experiment: zero correctness errors, visible DB-pool queueing tails | #550 issue body (audit source) | HISTORICAL_EVIDENCE | medium | pool is a #550 dimension, not an infra trigger |
| E24 | Measured steady load ≈ 6.6 requests/candidate/min; limiter sizing rule documented | #546 runbook rule; production reality audit | HISTORICAL_EVIDENCE | high | capacity framing |
| E25 | Mature LMS/exam platforms: durable truth in RDBMS (Moodle/Canvas/Sakai) or split MySQL+Mongo (Open edX); Redis = optional cache (Moodle/Canvas), cache+broker (Open edX), or absent (Sakai/SEB); jobs DB-queued (Moodle/Canvas/Sakai) or Celery (Open edX); event bus only where an external integration exists (Open edX Kafka, Canvas Kinesis outbound) | 05-industry-comparison.md (official docs/repos, URL-cited) | INDUSTRY_COMPARISON | high | comparative only; per-responsibility pattern confirmation |
| E26 | Redis loss cannot erase durable exam truth (counters are the only state; TTL'd) | ADR-001 + CODE | CODE | high | failure-semantics gate for any expansion |
| E27 | Multi-level proxy chains / proxy XFF pass-through contract are documentation-enforced residual unknowns of #546 | #546 residual unknowns 1–4 | CODE | high | not an infra trigger |
| E28 | Pool wait vs query execution NOT directly observable in production runtime (no instrumentation; postgres.js queues client-side invisibly) | E14 experiment method note | MEASURED (method bound) | high | honesty note for #550 |
| E29 | Whether some unmeasured read path is a cacheable hotspot | none found in code sweep; no candidate with (high QPS × high cost × staleness tolerance) identified | UNKNOWN | — | D5: absence of evidence recorded explicitly |

## Gaps this gate explicitly does NOT close

- Full-scale E2E load re-proof (20/50/100/130/200 with reconnect/refresh/submit bursts) belongs
  to #550; this gate consumed #545/#546/#547 artifacts + targeted pool-level probes only.
- Production HTTP-level readiness flood (through Fastify+limiter) was reasoned from E13–E17
  (limiter CODE bound + pool-level measurement), not measured end-to-end; recorded as residual.
