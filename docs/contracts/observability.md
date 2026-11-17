# Observability Contract

> Phase G of Phase 2 收口. Define the **minimum** observability contract for
> maintenance, troubleshooting, and test diagnostics before Phase 3. This is a
> contract definition, not a full OpenTelemetry rollout. It aligns what already
> exists (pino logs, audit_logs, diagnostics, requestId) into a documented
> shape.

## Purpose

Give operators and maintainers a consistent, non-leaking trail for: request
tracing, state transitions, audit, background-job diagnostics, and test
failure diagnosis — using the infrastructure already in place (pino logger,
`audit_logs` table, `/system/diagnostics`, `request.id`). No new heavy
dependency is introduced.

## Non-goals

- No OpenTelemetry / distributed-tracing stack (no collector, no exporters).
- No metrics aggregation system (Prometheus/Grafana) — `/system/health` and
  `/system/diagnostics` suffice for Phase 2 single-instance LAN.
- No log shipping/centralization — pino writes to stdout (Docker/compose
  captures it). Operators retain logs per their deployment policy.
- No PII or answer content in logs (see Redaction policy).

> **V1 boundary note (ADR-028 REJECTED 2026-11-16).** The non-goals above
> describe the binding contract and remain in force. The proposed V1
> OpenTelemetry technical telemetry standard
> ([ADR-028](../adr/ADR-028-opentelemetry-technical-telemetry.md)) was
> **REJECTED** by Owner decision after the #964 W1–W7 implementation failed
> to satisfy the production enablement gate. In WSL2 exploratory measurements,
> H2 On/no-export CPU median overhead was ≈ +3.91% (inconclusive against the
> +5% budget), while H4 On/full-OTLP was ≈ +10.14% (formal UNKNOWN due to
> dispersion; its 95% CI lower bound exceeded +5%). PR #997 restores the
> v0.0.15 product tree on its candidate branch; this becomes the effective
> master baseline only upon merge. The implementation and research evidence
> remain reachable as
> archive references (tags `archive/otel-master-964` and
> `archive/pr996-otel-research`). The successor direction — incremental
> enhancement of the native facilities this contract already owns — is
> [ADR-029](../adr/ADR-029-exam-native-observability.md) (PROPOSED; not
> implementation authority until accepted). The facilities below are the
> current, binding observability contract.

## Request trace fields

Every request has a correlation id. The minimum traceable shape:

| Field | Source | Example | Notes |
|---|---|---|---|
| requestId | `request.id` (server UUIDv4 `genReqId`) | `"550e8400-e29b-41d4-a716-446655440000"` | server-generated; error envelope, `x-request-id` response header (#865), Pino and HTTP audit correlation |
| method | HTTP method | `POST` | pino default request log |
| path / route | matched route template (`routeOptions.url`; #925 serializer) | `/api/attempts/:attemptId/submit` | fixed `(unrouted)` placeholder when no route matched — never the raw URL/query |
| statusCode | reply status | `200` | pino onResponse log |
| durationMs | response time | `42` | pino onResponse log |
| timestamp | pino `time` | ISO | pino default |
| actorId | `ctx.actorId` | user id | only when authenticated; include in business log lines |
| actorRole | `ctx.role` | `Admin`/`Candidate` | include in business log lines |
| organizationId | `ctx.organizationId` | org id | tenant scoping for log search |
| errorCode | normalized code | `EXAM_NOT_OPEN` | only on error responses |

> Implementation status: requestId/method/path/statusCode/durationMs/timestamp
> are already produced by Fastify's pino integration. actorId/actorRole/
> organizationId/errorCode are available via `ctx` and the error handler; they
> are included in error envelopes and audit rows, and SHOULD be added to
> business-specific log statements where troubleshooting value is high.

## Request correlation semantics (#860 — owner supersession: UUIDv4)

The production API explicitly generates a fresh UUIDv4 using Node
`crypto.randomUUID()` for each HTTP request. This supersedes the historical
`KEEP_DEFAULT_OPTION_B` (Fastify local counter) proposal. No boot ID,
central ID service, database allocation, or distributed-tracing runtime is
required merely to identify an HTTP request.

- **Identity scope.** UUIDv4 gives a server-generated, probabilistically
  unique correlation value across different API processes and process
  lifecycles; collision risk is negligible but not mathematically impossible.
  It is not a tenant, authentication, answer, event, transaction, or operation
  identity. Historical logs/audit rows still contain legacy `req-<base36>`
  values; do not rewrite them or infer provenance solely from ID shape.
- **Untrusted headers.** Fastify `requestIdHeader` remains explicitly disabled.
  Client-supplied `request-id` / `X-Request-Id` is never authoritative
  for the server's `request.id`.
- **Response-header carrier (#865).** One root-scope `onRequest` hook stamps
  `x-request-id: request.id` onto every Fastify-managed response — success,
  business rejection, validation error, unmatched route, and thrown-error
  paths alike. No second id is minted: the header makes the SAME
  server-generated value (which already keys the pino lines and the error
  envelope) readable by the caller on 2xx responses, where no envelope
  exists. The web client consumes it opt-in
  (`api.getWithMeta` / `api.postWithMeta` in `apps/web/src/lib/api.ts`); the
  answer-save path is the first production consumer (#924): a 200 business
  rejection (`accepted: false`) surfaces the header id as the rejection
  alert's 请求编号 and as the client-claimed `requestId` in the
  `answer_autosave_failed` telemetry metadata — never as a server-verified
  fact. On error responses the envelope `requestId` stays authoritative; a
  divergent header is recorded as a bounded client-log warn, not promoted
  onto the error object. `api.getWithMeta` itself is a documented
  forward-looking surface with no production caller yet (read-side
  counterpart of the same opt-in seam, contract pinned by its unit test) —
  retained deliberately, not dead code.
  CORS exposes it only to the configured web origin
  (`docs/contracts/api-contract.md` §Standard response headers).
  Non-carriable boundary: requests whose response is never sent — connection
  destroyed mid-request, socket-level HTTP framing failures, Node-level
  request/keepAlive timeouts — and protocol-level framework errors answered
  in router lookup before request construction (malformed request target,
  e.g. `FST_ERR_BAD_URL`) carry no header; the server's log lines for the
  former are still keyed by the same `request.id`.
- **End-to-end correlation.** The same server-generated requestId is carried
  in the error envelope, the `x-request-id` response header (#865), Pino
  request logs, and HTTP audit metadata where
  an audit row exists. Not every HTTP request produces an audit row.
  A UUIDv4 is a correlation key, not proof of causality or of complete
  log retention. Use the known server time, origin, tenant/actor and request
  lifecycle to interpret evidence; NO_MATCH may mean UNKNOWN and multiple
  plausible records remain AMBIGUOUS.
- **Save success, retries and UNKNOWN (#924 / #861).** A 2xx response, the
  presence of a `requestId`, or a readable `x-request-id` header is never
  proof that an answer was saved: save success is decided only by the
  server's `accepted: true` response and its receipt / attempt domain state
  (`apps/web/src/pages/exam/TakeExamPage.tsx`,
  `docs/operations/save-failure-evidence.md`). The `accepted: false` body
  deliberately carries no `requestId`; the header id is a correlation
  candidate, not a save verdict. Each retry is a NEW HTTP request with its
  own server-minted id, so a reported failure is correlated by
  `attemptId` + `questionId` + `clientSeq` + server time window, not by
  reusing an earlier request id. When the response is never observed
  (connection destroyed, ACK dropped, timeout) there is no client-visible
  id; the server-side fact is settled by receipts / domain state, and a
  missing record is an evidence gap (UNKNOWN, F6), never proof of
  non-arrival.
- **DB transaction retry correlation (#1006 / E05).** The `transaction retry`
  WARN emitted by `packages/db` (`executeInTransaction`) carries a CLOSED
  `correlation` object only when the call site supplies one:
  `{ requestId?, attemptId?, organizationId?, operation? }` — `requestId` is
  the same server-minted `request.id` used by the `x-request-id` header and
  the Pino request trace (ADR-025), `attemptId`/`organizationId` come from the
  authorized request context, and `operation` is a closed enum (currently only
  `attempt.answer.save`). W03 answer save is the only wired call site; other
  call sites omit correlation rather than fabricating an HTTP identity. The
  retry logger is deliberately synchronous and fail-open: a logger failure
  never aborts a retry, changes its backoff, or alters the transaction result.
  Join rule (same `requestId`, complete log capture, W03 transaction only):

  | observed | determinable fact |
  | --- | --- |
  | 0 retry WARN + 2xx | request succeeded, no transaction retry observed |
  | 1–3 retry WARN + 2xx | request succeeded, retries occurred |
  | 3 retry WARN + 409 | three retries ran and the request ended 409; the final SQLSTATE is UNKNOWN (40001 exhaustion and a 4th-attempt 23505 are indistinguishable) |
  | 1–2 retry WARN + 409 | retries occurred and the request ended 409; the cause cannot be inferred from the count |
  | 0 retry WARN + 409 | HTTP conflict with no retry trace; NOT necessarily 23505 |

  Limits (owner-frozen #1006 D6): `0 WARN` does not prove "no retry" when log
  emission or collection is incomplete, and `3 WARN + 409` does not prove
  retry exhaustion — the terminal 409 boundary is silent by design, and an
  explicit terminal event is out of scope (D6.2 DEFERRED). Missing evidence is
  UNKNOWN, never "no retry" or "exhausted".

  Volume bound (closed-field rule 7): the extended event emits at most
  `MAX_RETRIES` (3) retry WARN lines per transaction chain and only for
  retryable SQLSTATEs (40001/40P01) — there is no always-on per-request line.
  Worst-case raw line is 333 bytes (pino envelope 125 B + correlation 208 B),
  pinned at <= 512 bytes by the cross-tenant interleaving test.
- **Candidate submit outcome (#1007 / E06, commit-authoritative).** The
  candidate submit + grade orchestrator emits ONE `attempt.submit.completed`
  info line per successfully committed submit execution, with a closed
  five-value `outcome` classifying the path THIS transaction took (not the
  attempt's full grading state):

  | committed path (locked-in authority) | outcome |
  | --- | --- |
  | locked read already `graded`, idempotent early return | `replay_no_change` |
  | deadline reconciliation froze this execution (early return) | `deadline_frozen` |
  | post-submit `gradingStatus = pending_manual` (fresh OR crash-held) | `pending_manual` |
  | fresh submit + `finalizeGrading` committed | `graded` |
  | entry `submitted` (crash-landed) + `finalizeGrading` committed | `recovered` |

  The classification travels as the transaction callback's return value
  (`SubmitOutcomeClassification`); every failed/retried attempt's
  classification dies with its transaction. `alreadyGraded` remains the
  legacy boolean projection (`outcome ∈ {replay_no_change, deadline_frozen}`)
  with unchanged caller semantics; the outcome channel is internal — it is
  NOT part of the public HTTP schema.

  Emission law: the only call site (`emitSubmitCompleted`,
  owner-local typed boundary in `submitAndGradeAttempt.ts` — #1001 方案 A)
  sits AFTER `await executeInTransaction(...)` resolves (COMMIT confirmed)
  and BEFORE the out-of-tx response re-read. Therefore: ownership/authz
  rejection (preHandler `reply.send`, handler never reached), transaction
  rollback, retry exhaustion, and commit-phase faults emit ZERO completed
  lines; a post-commit response-build failure (internal re-read fault /
  exam re-read 404 / parse 400 / serialization 500) keeps the line un-lost
  and un-rewritten. Intermediate retry attempts never emit. What a WARN
  `transaction retry` line means — and does NOT mean: it records that ONE
  transaction attempt failed with a retryable SQLSTATE and is about to be
  retried, nothing more. The candidate submit transaction is opened via the
  two-argument `executeInTransaction` (no correlation option), so its retry
  WARNs carry no request identity and cannot be reliably attributed to a
  specific request. Even where a join is possible, a completed line may be
  missing for a request that DID commit: a process crash between COMMIT and
  the synchronous emit, a sink failure, or log filtering (level / collection
  policy) each drops the line. The absence of a completed line therefore
  does NOT establish that the request was not finally submitted — final
  facts about submission live in the database (EXSEM-013): query the
  attempt row / persisted receipts, never the log. One line per HTTP
  request: concurrent submits of the same attempt each produce their own
  line; business side effects remain governed by the idempotent domain
  protocol, and there is no per-operation log dedup.

  Identity & privacy: emitted through the request-scoped Pino logger, so the
  line carries the SAME server-minted `reqId` as the `x-request-id` header
  and the request trace (no duplicate requestId payload field), plus the
  inherited authenticated-request child bindings (`actorId`, `actorRole`,
  `organizationId` — `plugins/auth.ts`, business-line tenant scoping). The
  emitter adds only `{event, outcome, attemptId}` (whitelist object; no
  answer/score/error/reason/URL content, no spreading request/ctx/result).
  Non-HTTP callers (demo seed grader) pass no HTTP handle and emit nothing —
  no fabricated HTTP identity. A synchronous sink throw is swallowed at the
  single emit point: committed result, HTTP response and retry behavior are
  unchanged.

  Limits (proposed, pending owner review): sink failure drops the line (no
  delivery retry); a process crash between COMMIT and the synchronous emit
  loses the line — the durable business fact is the database row, never
  this log (EXSEM-013).
  Measured raw line (production shape, UUID identities): 347–357 B —
  envelope (level/time/pid/hostname) ≈ 50 B, inherited identity
  (reqId/actorId/actorRole/organizationId) ≈ 180 B, event payload
  ({event,outcome,attemptId}) 106–116 B. The design-catalog 256 B target is
  met by envelope+reqId+payload alone but not by the full line, because the
  pre-existing per-request child bindings add ≈ 130 B; removing them would
  mean abandoning the request logger as the identity source, so the
  deviation is documented rather than truncating the line. Frequency is
  business-action bound (one line per successful submit request, replays
  included), not always-on; at the measured 357 B worst case, 1 submit/s ≈
  0.36 KiB/s of log volume (visible at `info` level only).
- **Client-claimed candidates.** A requestId sent inside client telemetry
  remains an unverified claim about a previous interaction. The "客户端声明，
  未经服务端核验" label applies to all such metadata until corroborated by
  the server's logs. A matching UUID string alone does not authenticate
  the sender or establish ownership of the claimed request.
- **Background work.** Background scanner/incident operations continue to
  use their existing workerInstanceId/operationId; do not fabricate an HTTP
  requestId for work that did not originate from an HTTP request.
- **Raw URLs never persisted in app pathways (#925).** No application-side
  log pathway writes the raw client URL (query or path): the pino request
  line logs the matched route template via the `req` serializer in
  `lib/logRedaction.ts`; error, authz-denial and 404 logging use the same
  `routeTemplateOf`. This is a separate claim from the nginx edge below —
  do not merge them into one statement.
- **nginx access-log privacy vs error-log risk acceptance (#925 / Owner
  Decision A).** The nginx edge access log keeps the secret-free
  `exam_privacy` format (`deploy/nginx/web.conf`): fixed prefix-level
  route placeholder plus server-observed fields only — raw request
  line/URI, Referer, Cookie and Authorization are banned from it forever.
  The nginx error_log stays at the native `error` level so a self-managed
  deployment keeps upstream/resolution fault diagnostics; nginx core quotes
  the FULL request line (including query secrets) in error-level messages
  during upstream/DNS failures — verified by container fault injection
  (access log: zero raw-URL leaks across all scenarios/levels; error log:
  leaks in the upstream-failure family; `crit` suppresses all diagnosis;
  `warn` adds no failure-diagnostic value but additionally leaks malformed
  request lines via uninitialized-variable warnings) — and that raw-URL
  exposure is an explicitly accepted, bounded risk (no `crit` suppression,
  no log-filtering proxy). Access-log
  privacy and error-log exposure are reported as separate verdicts; any
  third-party log collector outside the deployment boundary remains a
  documented residual, not a verified surface.
- **Multi-instance boundary.** Generating unique request IDs does NOT make
  the current deployment multi-instance safe. Scanner ownership, scheduling,
  deployment and lifecycle concerns require a separate architecture decision.


## State transition log fields

State transitions (exam/attempt/enrollment) already emit **audit** rows. The
contract for a transition event:

| Field | Source | Notes |
|---|---|---|
| organizationId | ctx | tenant scoping |
| actorId | ctx | who/what triggered (userId, or `system`/`deadline_scanner`) |
| action | e.g. `exam.close`, `attempt.submit` | the audit action string |
| targetType | `exam` / `attempt` / `enrollment` | |
| targetId | the entity id | |
| stateBefore | previous status | add to audit `metadata` for lifecycle actions |
| stateAfter | new status | add to audit `metadata` |
| metadata | jsonb | transition reason, extendMinutes, source (`candidate`/`proctor`/`deadline_scanner`) |
| timestamp | audit_logs.createdAt | |

> Implementation status: audit rows already carry organizationId, actorId,
> action, targetType, targetId, metadata, createdAt. stateBefore/stateAfter
> and `source` are partially in metadata (e.g. reconciliation records
> fromStatus/toStatus in `reconciliation.ts`). The contract is to **standardize**
> these into `metadata.stateBefore`/`metadata.stateAfter`/`metadata.source`
> going forward (SHOULD FIX incrementally, not a 收口 blocker).

## Audit log fields

Already the canonical, append-only record. Contract (matches `audit_logs`
table):

| Field | Type | Notes |
|---|---|---|
| id | text | PK |
| organizationId | text | tenant boundary |
| actorId | text | who acted |
| action | text | e.g. `exam.publish`, `attempt.forceSubmit`, `login.success` |
| targetType | text | `exam`/`attempt`/`enrollment`/`user`/`candidate`/`organization` |
| targetId | text | entity id |
| metadata | jsonb | structured details (stateBefore/After, reason, source) |
| ipAddress | text? | request IP |
| userAgent | text? | request UA |
| createdAt | timestamptz | immutable |

Identity metadata keys are injected at the writer boundary with distinct
semantics:

- `metadata.requestId` — HTTP request identity (Fastify `request.id`), injected
  by the HTTP writer paths only. No writer injects it for a system row: a
  system audit row never fabricates an HTTP request id.
- `metadata.operationId` — the operation identity of the recorded change. A
  business payload may carry it (HTTP rows persist e.g. the attempt receipt
  operationIds unchanged); the system writer injects it from the system
  context (e.g. the episode-derived system incident operationId) and refuses
  to overwrite a different value already present in the payload.

Provenance is never inferred from the value's string shape. Rows written
before the keys were split stored system operationIds under
`metadata.requestId`; they are historical evidence and stay as written (no
migration, no reclassification). The CSV export projects the two keys into
separate columns (请求ID / 操作ID) by key name; because the exported columns
are an operations-visible contract, a release that ships the new column calls
it out in its release notes.

> Implementation status: complete. `GET /api/admin/audit-logs` exposes it
> (action/targetType/date filter). No change needed.

## Background job log fields

The background scanners (heartbeat, deadline) are the only background jobs in
Phase 2 (in-process `setInterval`). Their diagnostics contract:

| Field | Source | Notes |
|---|---|---|
| job | `heartbeat` / `deadline_scanner` | |
| scanIntervalMs | runtimeConfig / scannerMetrics | |
| lastScanAt | scannerMetrics | surfaced in `/system/diagnostics` |
| disruptedCount / autoSubmitCount | scannerMetrics | surfaced in diagnostics |
| failedCount | scannerMetrics | surfaced in diagnostics (#800); in-memory since process start, reset on restart. The heartbeat block splits the legs: disruption failures as `failedCount`, System-incident reconciliation failures as `incidentReconciliationFailedCount` |
| consecutiveFailedTicks | scannerMetrics | surfaced in diagnostics (#886); #862 escalation run-length (reset on restart, clean settle zeroes, tick throw freezes) — not the cumulative failedCount |
| incidentCreatedCount / incidentConflictCount | heartbeatMetrics | surfaced in diagnostics (#1004); #304 F4A System-incident reconciliation counters since process start — process-local, reset on restart, not persisted, never aggregated across API instances. `incidentCreatedCount` = distinct applied creates (max one per interruption episode; idempotent replays excluded); `incidentConflictCount` = per-cycle idempotency-conflict OBSERVATIONS (operationId already used for a different command/payload, or the committed event's incident row missing in the defensive recovery path; the same collision is re-counted each reconciliation cycle until resolved); every conflict observation is also a reconciliation-leg failure, so `incidentConflictCount` is a subset of `incidentReconciliationFailedCount` |
| organizationId | ctx of the scanned attempt | tenant scoping |
| attemptId | the scanned row | for incident correlation |

> Implementation status: scanIntervalMs, lastScanAt, disruptedCount,
> failedCount, incidentReconciliationFailedCount and consecutiveFailedTicks are
> surfaced via `/system/diagnostics` from the `heartbeatMetrics` /
> `deadlineScannerMetrics` objects. Failed auto-submits are additionally logged
> via `logger.error` (deadlineScanner.ts:192). The heartbeat incident
> reconciliation counters (`incidentCreatedCount` / `incidentConflictCount`)
> are surfaced the same read-only way through the existing diagnostics
> response (#1004) — they are host-level, process-local counters, never a
> tenant-scoped incident report. No structured-job-log table exists; this is
> intentional for Phase 2 (no queue/worker). Redis diagnostics are also
> surfaced in diagnostics (`redisStatus`).

## Test diagnostics fields

For test failure diagnosis (BUG-FLAKE-001 etc.), the contract is captured in
`docs/standards/test-flakes.md` + `docs/archive/dev/adr-isolation-audit.md`. Minimum fields
a flake record carries:

| Field | Notes |
|---|---|
| date | observation date |
| jobContext | `pnpm verify`, `pnpm coverage`, CI shard |
| failingTest | file:line |
| errorSnippet | the failure output |
| rootCauseHypothesis | state-leak / I/O-contention / auth-amplification / env-missing |
| currentMitigation | serial containment, advisory lock, etc. |
| recurrenceCount | upgrade threshold ≥3 |

> Implementation status: this format is already followed by test-flakes.md.

## Redaction policy

Logs must NEVER contain (enforced by `apps/api/src/lib/logRedaction.ts`
`SENSITIVE_LOG_PATHS`, applied via pino `redact: { remove: true }`):

- passwords (`password`, `newPassword`, `currentPassword`, `passwordHash`)
- tokens (`token`, `accessToken`, `refreshToken`, `authorization`, `auth-token`)
- cookies (`req.headers.cookie`) and auth headers (`req.headers.authorization`)
- `standardAnswer` (answer key) from question payloads

Additional rules (policy, partially enforced):
- **No raw answer content** in logs except in explicit security-audit paths,
  and only sanitized. Answer bodies flow to PostgreSQL, not logs.
- **No full request body** in routine logs (redact removes credential fields;
  do not log full bodies for answer-save/submit).
- **No secrets/env** (JWT_SECRET, DB passwords) — never logged.
- PII (candidate field values) must not be logged at info level; audit rows
  store only ids + structured metadata, not free-form PII.

> Implementation status: the pino redact list covers the credential/token/
> cookie/auth/standardAnswer cases with `remove: true`. The policy rules above
> are the standing guideline for any new log statement.

## Examples

Request trace (pino, error path):
```json
{"level":"info","time":1730000000000,"req":{"method":"POST","route":"/api/attempts/:attemptId/submit","remoteAddress":"10.1.2.3"},"reqId":"r1"}
{"level":"error","time":1730000000042,"reqId":"r1","msg":"attempt submit failed","actorId":"u7","organizationId":"org1","errorCode":"ATTEMPT_CLOSED"}
{"level":"info","time":1730000000042,"res":{"statusCode":409},"reqId":"r1","responseTime":42}
```

Audit row (exam close):
```json
{"action":"exam.close","actorId":"u1","organizationId":"org1","targetType":"exam","targetId":"e3","metadata":{"stateBefore":"open","stateAfter":"closed","reason":"manual"},"createdAt":"2026-06-24T05:00:00Z"}
```

Diagnostics snapshot (background + redis):
```json
{"redisStatus":{"connected":true,"latencyMs":3},"heartbeatStatus":{"interval":30000,"lastScanAt":"...","disruptedCount":0},"deadlineScannerStatus":{"interval":30000,"lastScanAt":"...","autoSubmitCount":0}}
```

## Implementation status

| Area | Current status | Gap | Priority |
|---|---|---|---|
| Request trace (requestId/method/status/duration) | Done (pino default) | — | — |
| Candidate submit outcome (#1007 / E06) | Done: one commit-authoritative `attempt.submit.completed` per committed submit execution (five-value outcome) | commit-to-emit crash window loses the line (known blindspot; acceptance pending owner review) | — |
| DB transaction retry correlation (#1006) | Done for W03 answer save (closed `correlation` on retry WARN) | other call sites stay opt-in; terminal outcome is a log-join inference only | — |
| requestId in error envelope | Done | — | — |
| actorId/role/orgId in business logs | Available via ctx; included in audit + errors | Standardize in business log statements | SHOULD FIX (incremental) |
| State transition audit rows | Done (action/target/metadata/createdAt) | Standardize `metadata.stateBefore/stateAfter/source` | SHOULD FIX (incremental) |
| Background job diagnostics | Done via `/system/diagnostics` + scannerMetrics | — | — |
| Redis diagnostics | Done (`redisStatus` in diagnostics, Phase C) | — | — |
| Pino redaction (creds/tokens/cookies/auth/standardAnswer) | Done | — | — |
| No answer-content / full-body logging | Policy (manual discipline) | Add a lint/test guard if abuse appears | DEFER |
| Distributed tracing (OTel) | Not present | Out of scope: ADR-028 REJECTED (2026-11-16); future direction is native-facility enhancement per PROPOSED ADR-029 | Revisit only via an accepted ADR |
| Centralized metrics (Prometheus) | Not present | Out of Phase 2 scope | PHASE 3+ |
