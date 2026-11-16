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

> **V1 boundary note (PROPOSED ADR-028, 2026-11-13).** The non-goals above
> describe the binding Phase 2 contract. The W0 baseline has no production
> OpenTelemetry SDK, Collector, or log shipping.
> [ADR-028](../adr/ADR-028-opentelemetry-technical-telemetry.md) proposes
> bounded technical telemetry for #964. ADR acceptance sets the architecture
> scope. Production opt-in requires W1–W7 acceptance evidence and separate
> Owner approval.

## V1 transition (PROPOSED — not in force)

The V1 column describes proposed behavior. ADR-028 §3–§4 lists the
acceptance criteria and outstanding runtime validation.

| Aspect | Phase 2 (current, binding) | V1 (planned, gated by ADR-028 acceptance + Owner enablement) |
| --- | --- | --- |
| Traces / metrics | None (stdout logs + `/system/*` projections only) | OTel SDK behind a default-Off switch; On requires per-deployment opt-in |
| HTTP correlation id | Server UUIDv4 `request.id` + `x-request-id` (ADR-025) — authoritative, unchanged | Same id remains authoritative. Trace and span IDs provide technical correlation. Untrusted inbound trace headers do not supply the server parent context. |
| Logs | Pino → stdout, single path | Pino remains the only server logging API; when remote ingestion is enabled, exactly ONE remote path per deployment mode (stdout collection or OTLP Logs); default stdout contract stays available |
| Remote log ingestion | None | Not yet supported; selection and single-path proof are W1/W6 acceptance items |
| Readiness / alerts | `probeApplicationReadiness` + `operability.*` stdout events | Unchanged; telemetry (collector/exporter) failure must never alter readiness, transactions, retries, or shutdown semantics |
| DB observability | `transactionRetryLogger` + `CAPACITY_RESEARCH` research wrapper | Independent workspace plugin (W2) behind the same Off default; retry semantics unchanged |
| Enablement | — | ADR-028 acceptance and #964 W1–W7 review, including W7.2 three-state acceptance (Off / On-no-export / On-full-export, CPU and p99 overhead budgets ≤5% each, unknown until measured), precede the separate Owner production-enable decision. |
| Rollback | — | Configuration-level return to Off; no business-schema change; audit/receipt/client-event behavior untouched |

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
| failedCount | scanner error log | pino `logger.error` on failed auto-submit |
| consecutiveFailedTicks | scannerMetrics | surfaced in diagnostics (#886); #862 escalation run-length (reset on restart, clean settle zeroes, tick throw freezes) — not the cumulative failedCount |
| organizationId | ctx of the scanned attempt | tenant scoping |
| attemptId | the scanned row | for incident correlation |

> Implementation status: scanIntervalMs, lastScanAt, disruptedCount,
> autoSubmitCount are surfaced via `/system/diagnostics` and the
> `heartbeatMetrics`/`deadlineScannerMetrics` objects. Failed auto-submits are
> logged via `logger.error` (deadlineScanner.ts:192). No structured-job-log
> table exists; this is intentional for Phase 2 (no queue/worker). Redis
> diagnostics are also surfaced in diagnostics (`redisStatus`).

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
| requestId in error envelope | Done | — | — |
| actorId/role/orgId in business logs | Available via ctx; included in audit + errors | Standardize in business log statements | SHOULD FIX (incremental) |
| State transition audit rows | Done (action/target/metadata/createdAt) | Standardize `metadata.stateBefore/stateAfter/source` | SHOULD FIX (incremental) |
| Background job diagnostics | Done via `/system/diagnostics` + scannerMetrics | — | — |
| Redis diagnostics | Done (`redisStatus` in diagnostics, Phase C) | — | — |
| Pino redaction (creds/tokens/cookies/auth/standardAnswer) | Done | — | — |
| No answer-content / full-body logging | Policy (manual discipline) | Add a lint/test guard if abuse appears | DEFER |
| Distributed tracing (OTel) | Not present | Out of Phase 2 scope (PROPOSED ADR-028 would gate V1 adoption behind default-Off + Owner enablement) | PHASE 3+ |
| Centralized metrics (Prometheus) | Not present | Out of Phase 2 scope | PHASE 3+ |
