# #554 Current authority map (as-built, master `364d1473`)

BASE_SHA: `364d1473989e2642047ba36106482fb287570269` (= origin/master; PR #563 merge)
BRANCH: `research/554-infrastructure-trigger-review-1`
WORKTREE: clean at baseline; this directory is the only intended delta (docs/research + raw measurement artifacts)
ENV: Node v24.15.0 · pnpm 11.1.2 · Docker 29.5.3 · PostgreSQL 18.4 (compose pin; research probes on a throwaway 18.4 instance with identical default settings) · Host: WSL2 x86_64, 20 CPU, 15 GiB

This document freezes the CURRENT responsibility/authority reality that the #554 decisions
reason about. It is an as-built description, not a proposal.

## Durable exam truth (PostgreSQL is the sole authority)

All of the following live in PostgreSQL and nowhere else (schema: `packages/db/src/schema/pg.ts`;
access only through repositories):

| Fact | Table(s) | Written by | Read/derived by |
| --- | --- | --- | --- |
| answers | `exam_attempts.answers` (+ frozen `submitted_answers`) | answer-save protocol (versioned, idempotent, conflict-detected) | grading, recovery |
| attempts + state | `exam_attempts` (status value-set enforced by check constraint, #542) | domain commands/engines only (submit/grade/disrupt/recover/deadline) | all runtime + reporting |
| enrollments | `exam_enrollments` | enrollment flows (lock seam Enrollment→Attempt→Exam) | attempt start |
| deadlines | `exam_attempts.deadline_at`, `exams.close_at`, frozen snapshots | exam/attempt commands | deadline scanner (candidate discovery only — authority re-check under lock), save-time enforcement |
| submission | `exam_attempts.submitted_at/submission_reason` | submit command (single canonical path) | grading, audit |
| grading | `grading_result`, `grading_status` | auto/manual grading under attempt authority | results |
| scores/results | `exam_attempts.total_score/passed` | grading commit | dashboards, export |
| incidents | `exam_incidents`, `exam_incident_events` (+ arbiter unique `(organization_id, operation_id)`, #304) | system/human incident delivery | reconciliation, operator UI |
| disruption episodes | `attempt_interruptions`, `attempt_interruption_events` | heartbeat scanner / recovery (#545: detection→episode→events) | reconciliation, incidents |
| admission facts | `exam_admissions` (partial unique index = one active membership; CAS write-once admission/consumption) | admission commands in start transaction | `requireQueue` gate |
| audit records | `audit_logs` (incl. `ip_address` from the single `request.ip` authority) | audit writer | operator audit views |
| outbox durable work | `email_outbox` (ADR-011 Class A transactional outbox) | business tx + delivery loop | email worker |
| operation/idempotency records | command-receipt/operation tables (canonical completion arbiter) | command execution | recovery, reconciliation |
| worker liveness (durable) | `worker_heartbeats` (email worker, 5 s) | email outbox loop | diagnostics staleness |
| rate-limit identity keys | — NOT in PG: HMAC digests live only inside Redis counters / local fallback maps | rate limiter | limiter |

**OWNER:** PostgreSQL (single instance, compose `db`, `restart: unless-stopped`).
**PERSISTENCE:** bind-mount data dir; `pg_isready` healthcheck gates app start (`depends_on: service_healthy`).
**SERIALIZATION:** row locks via explicit lock order Enrollment → Attempt → Exam; `FOR UPDATE` on
attempts/exams/enrollments/users; `SKIP LOCKED` ONLY in the email outbox claim CTE
(`emailOutboxRepo.ts:272`); admission uses CAS + partial unique, no advisory locks in runtime
(`pg_advisory_lock` exists only in test infrastructure `packages/db/src/testInfraLock.ts`).
**DEDUP:** operation-id arbiters (unique index deep-equality check) for System incidents;
write-once CAS for admission; idempotent versioned answer saves.
**RECOVERY:** stateless reconciliation loops re-derive from canonical rows every tick (#304/#545);
no cursors, no process-local work state; email outbox reclaims expired leases (`recoverAbandoned`).

This baseline is ADR-001 ("PostgreSQL remains durable exam-fact authority") and is NOT weakened
anywhere below.

## Responsibility inventory (current owner per responsibility)

| # | Responsibility | Current owner | Mechanism (as-built) | Durability |
| --- | --- | --- | --- | --- |
| R1 | durable exam truth | PostgreSQL | tables above | durable |
| R2 | rate-limit coordination | Redis (bounded, ADR-001) OR process-local fallback | Lua fixed-window `INCR`+`PEXPIRE` under `ratelimit:v1:` prefix, HMAC-IP keys, TTL mandatory; modes `off/optional/required` (`redisRuntime.ts`, `rateLimitStores.ts`) | ephemeral by design |
| R3 | presence / heartbeat observation | PostgreSQL | candidate POST heartbeat 30 s → status-qualified `UPDATE exam_attempts.last_activity_at` under `FOR UPDATE`; scanner compares `now - last_activity_at > HEARTBEAT_TIMEOUT_MS` → durable disruption episode | durable (deliberately: disruption facts are forensic) |
| R4 | client-event ingestion | PostgreSQL | `client_events` batched insert (5 s / ≤20 rows per candidate, backoff), low-trust telemetry (#544), 30-day retention sweep (24 h) | durable, disposable |
| R5 | system-incident reconciliation | in-process loop | inside heartbeat tick (30 s, `activeScan` guard): O(history) discovery + chunked 10k arbiter probe (#545), stateless | durable input, stateless executor |
| R6 | deadline scanning | in-process loop | 30 s tick (`DEADLINE_SCAN_INTERVAL_MS`), O(active) discovery `listDeadlineCandidates`, per-candidate REPEATABLE READ tx, lock order Enrollment→Attempt→Exam, authority re-check under lock | durable input, stateless executor |
| R7 | email outbox delivery | in-process supervised loop | 5 s poll, `SKIP LOCKED` claim CTE, lease + `recoverAbandoned`, durable `worker_heartbeats` | durable queue (PG outbox) |
| R8 | general background jobs | — does not exist | no jobs table, no worker platform (ADR-003: general queue DEFERRED) | — |
| R9 | multi-instance coordination | — not a supported topology | compose defines ONE app instance; `TRUSTED_PROXY_CIDRS`/#546 freezes identity for proxy topologies; Redis shared limiter is the only cross-instance state that exists | — |
| R10 | realtime fanout / push | — does not exist | pure HTTP polling (5–30 s cadences, `ADR-002` deferred); zero WebSocket/SSE code | — |
| R11 | cacheable reads | — no cache | every read hits PostgreSQL; no cache layer anywhere | — |
| R12 | external integration / events | — does not exist | no event bus, no outbound webhooks, no MQ | — |
| R13 | readiness / health probes | in-process | `/api/health` (liveness, DB-blind) vs `/api/ready` (readiness: bounded 2 s `pingDb()` via `Promise.race` + Redis-required leg) vs `/api/system/*` (auth diagnostics); compose healthcheck consumes `/api/ready` 30 s/5 s/3 (#547); operability monitor tick 15 s emits `operability.*` transition alerts | process-local alert dedupe; no alert ledger |

## Deployment topology (supported, as-built)

```text
docker-compose.yml: services = app + db (+ redis ONLY under the "redis" profile, off by default)
API instances: 1 (compose defines one app service; nothing supports >1 today)
proxy topologies (#546): DIRECT_LAN | SHARED_NAT (documented policy) |
                         REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP (TRUSTED_PROXY_CIDRS opt-in) |
                         REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP (degraded-by-config)
REDIS_MODE: derived "off" unless operator configures it; required-mode fails closed (503)
client transport: HTTP polling only
```

## PostgreSQL connection pool (production shape — measured in 03)

`packages/db/src/postgres.ts` passes NO options for the runtime pool → postgres.js defaults:

```text
max            = 10
connect_timeout= 30 s
idle_timeout   = 0 (never idle-close)
max_lifetime   = unset
prepare        = true
```

No environment variable overrides any pool knob (`max: 1` exists only for test searchPath pools).
ALL work shares this one pool: request handlers, heartbeat scan, deadline scan, incident
reconciliation, email loop, retention sweep, readiness probes.

## Background loops (as-built)

| Loop | Cadence | Guard | Work shape | Tx model |
| --- | --- | --- | --- | --- |
| heartbeat + incident reconciliation | 30 s (`HEARTBEAT_SCAN_INTERVAL_MS`) | `activeScan` promise (no overlap; slow tick delays next) | per-org: O(active) disruption scan → O(history) reconciliation (#545) | short txs (one per disruption; per-query checkout elsewhere) |
| deadline scanner | 30 s | `activeScan` | per-candidate candidates from O(active) discovery | short REPEATABLE READ tx per candidate, retry 40001/40P01 |
| email outbox | 5 s poll | supervised while-loop | claim ≤20 due (`SKIP LOCKED`), deliver, `recoverAbandoned` | short READ COMMITTED tx per claim |
| client-event retention | 24 h + startup | `activeRun` | per-org bounded DELETE by received_at | single-statement |
| operability monitor | 15 s | `activeTick` | readiness probe + stall classification + transition dedupe | read-only + ping |

## #545 / #546 / #547 carry-forward (evidence this gate must consume)

- **#545** (CLOSED, PR #561): reconciliation is O(total history) per org per tick by design —
  the smallest correctness-preserving candidate set (#304 arbiter semantics). MEASURED:
  steady tick 28 ms @1k / 215–227 ms @10k / 1058–1220 ms @50k episodes per org; discovery sort
  spills to disk ≥~40k episodes (bounded linear residual); the hard 65,533-parameter cliff was
  the real defect → FIXED by chunked probe; candidate partial index MEASURED/REJECTED (~0 plan
  benefit) and must not be silently resurrected. Semester-realistic scale (hundreds of episodes)
  is far below S1.
- **#546** (CLOSED, PR #562): rate-limit identity frozen across 4 topologies; Redis's ONLY
  adopted responsibility is shared rate limiting (bounded counters); client IP authority is the
  single Fastify `request.ip`; trust-all CIDRs machine-rejected.
- **#547** (CLOSED, PR #563): liveness/readiness/diagnostics/alerting layered; PostgreSQL is the
  mandatory readiness dependency; Redis matters only in `required` mode; scanners classified
  OPERABILITY (stall alerts), NOT readiness-blocking. RESIDUAL accepted into this gate: the 2 s
  readiness budget bounds the CALLER only — postgres.js has no per-query cancellation, so a
  timed-out ping keeps running and concurrent probes are not single-flighted
  (`operabilityMonitor.ts:27,93-110`; route runs one probe per request, no dedup).

## Search sweep confirmation (negative facts)

Repo-wide sweep on this base confirms as-built ABSENCES that the decision matrix must respect:
no runtime advisory locks; no `SKIP LOCKED` outside the outbox; no Redis pub/sub, cache,
session, or presence keys; no WebSocket/SSE endpoints; no jobs table or worker platform; no
event bus/webhooks/MQ client; no multi-instance topology support; no second database.
