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


## Admin command outcome events (#1008)

The two admin attempt commands `force_submit` and `time_grant` emit
commit-authoritative technical outcome lines through the route-local typed
emission boundary `apps/api/src/routes/adminCommandTelemetry.ts` (owner-local
per the #1001 A decision; no central event bus, no new package). Receipts and
audit rows remain the business authority; these lines never reconstruct a
business fact.

**`admin.command.completed`** — one INFO line per request whose FULL
race-recovery wrapper (`forceSubmitWithOperationRaceRecovery` /
`grantWithOperationRaceRecovery`) resolved successfully, emitted in the route
AFTER that await and BEFORE the response schema parse. That placement covers
all four success sources with one code path — primary committed, auto-retry
committed, exact-23505 recovery, and the force-submit pre-read replay of an
already-committed receipt (which opens no transaction) — and guarantees a
response serialization/schema failure cannot rewrite or drop the committed
outcome. The classification is taken from the wrapper's own verified return
value (wire `disposition` / engine outcome), never from the HTTP status, the
receipt history's stored outcome, or a transaction-internal candidate. Fields:
`event` (the fixed catalog name `admin.command.completed` — the uniform
selection basis for technical event lines, same convention as the candidate-submit completed event
(#1007); `msg` mirrors it as human-readable content and is
not a query key), `command`, `outcome`, `disposition`, `attemptId`,
`operationId`, plus the Pino `reqId` binding (= `request.id`, ADR-025 — no
duplicate requestId field) and the request child-logger's inherited caller
bindings (`actorId`/`actorRole`/`organizationId`, the authenticated caller's
own server-verified identity; never the denied target's data).

| command / authoritative return | outcome (top level) | disposition |
| --- | --- | --- |
| force_submit / disposition `applied` | `applied` | `applied` |
| force_submit / disposition `no_change` (first execution on a terminal row; may still create the durable receipt per the existing contract) | `replay_no_change` | `no_change` |
| force_submit / disposition `idempotent_replay` (pre-read replay or 23505 recovery) | `replay_no_change` | `idempotent_replay` |
| time_grant / outcome `granted` | `applied` | `granted` |
| time_grant / outcome `terminal` (no time granted this run; see scope note) | `replay_no_change` | `terminal` |
| time_grant / outcome `idempotent_replay` | `replay_no_change` | `idempotent_replay` |

The mapping is an exhaustive switch over the real unions — a new enum value
fails compilation instead of defaulting to `applied`. As-built note: the
design table's `time_grant / no_change` row is unreachable; the engine union
is `granted | terminal | idempotent_replay` and `terminal` is the actual third
value. Replays write no receipt/audit/mutation; a first `no_change` keeps its
existing right to create a durable receipt.

Scope note for `terminal`: it classifies THIS RUN's command result — no time
was granted, no adjustment-ledger row was written (`adjustment` = null,
`addedSeconds` = 0). It does NOT mean the transaction was zero-mutation:
deadline reconciliation may already have terminalized the attempt (and
committed that state change) inside the same transaction. The log outcome is
the command's grant result, never a claim about the transaction's write set.

**`admin.command.denied`** — at most one INFO line per request, emitted by a
route-scoped `onResponse` hook (the command is a registration-time constant,
never inferred from the URL). Only 403/404/409 are mapped — the exits that
prove this request did NOT commit a business fact:

| status | outcome | exit form covered |
| --- | --- | --- |
| 403 | `forbidden` | scoped-capability preset / scope denials (preHandler `reply.send`, handler unreachable) |
| 404 | `not_found` | scoped-capability resource_not_found (anti-enumeration: one uniform value; a cross-org target is logged identically to a nonexistent one) |
| 409 | `conflict` | command adjudication throws (invalid state, idempotency conflict) and final error mapping (constraint/serialization conflicts) after the full recovery refused |

400 (global validation boundary — documented ownership), 401 (auth owner),
500/503 (safe error channels) emit NO admin.command line here. The hook cannot
misrecord a committed outcome: after the wrapper resolves, the remaining
failure modes are response-schema parse (400) and serialization (500), both
outside the mapped set, and `completed` is only emitted on the success path —
the two events are mutually exclusive. Denial fields: `event` (fixed catalog
name `admin.command.denied`, same selection convention as above), `command`,
`outcome`, plus `reqId` and the inherited caller bindings only. NO target
attemptId, operationId, organizationId, reason, permission relation, or error
details.

Measured raw line sizes (real Pino JSON, including envelope + inherited
bindings). The test-pinned figures are completed 445 B (event payload 208 B)
and denied 313 B (payload 79 B) — measured in the test harness, where
`buildTestApp` leaves Fastify's default short `req-N` counter as the reqId.
Production (`server.ts`, ADR-025) mints UUIDv4 request ids (36 chars), which
lengthens the full lines by 31 B to ≈ 476 B / 344 B (re-measured through the
same emitters with the production generator and the production logger options;
±1 B for the pid digit count). Both reqId口径 stay within the pinned
<= 512 B test budget; log-volume estimates should use the production figures.
Frequency: one completed line per successful
command request and at most one denied line per covered denial — bounded by
admin command traffic, not an always-on per-request line. Failure isolation:
the emitter swallows a synchronous logger failure (same fail-open contract as
the transaction retry logger); an emit failure never changes a committed
result or the HTTP response. Accepted blindspot: a process crash between
COMMIT and emit loses that line permanently — no persistence, no outbox, no
end-to-end exactly-once claim.

> Contract delta note (#1008): the `event` field, the `disposition` dimension,
> and the time_grant `terminal` mapping are the minimal contract addition
> proposed by this work; the #1015 owner decision adopted the owner-local typed
> emission boundary (A=ADOPTED) but did NOT pre-approve these new field values.
> They ride with #1008 review.

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
| DB transaction retry correlation (#1006) | Done for W03 answer save (closed `correlation` on retry WARN) | other call sites stay opt-in; terminal outcome is a log-join inference only | — |
| Admin command outcome events (#1008) | Done for force_submit / time_grant (completed + denied, route-local boundary; fixed catalog `event` field on every line) | `event` field + `disposition` dimension + time_grant `terminal` mapping are this PR's contract proposal (not pre-approved by #1015); other admin routes stay out of scope | — |
| requestId in error envelope | Done | — | — |
| actorId/role/orgId in business logs | Available via ctx; included in audit + errors | Standardize in business log statements | SHOULD FIX (incremental) |
| State transition audit rows | Done (action/target/metadata/createdAt) | Standardize `metadata.stateBefore/stateAfter/source` | SHOULD FIX (incremental) |
| Background job diagnostics | Done via `/system/diagnostics` + scannerMetrics | — | — |
| Redis diagnostics | Done (`redisStatus` in diagnostics, Phase C) | — | — |
| Pino redaction (creds/tokens/cookies/auth/standardAnswer) | Done | — | — |
| No answer-content / full-body logging | Policy (manual discipline) | Add a lint/test guard if abuse appears | DEFER |
| Distributed tracing (OTel) | Not present | Out of scope: ADR-028 REJECTED (2026-11-16); future direction is native-facility enhancement per PROPOSED ADR-029 | Revisit only via an accepted ADR |
| Centralized metrics (Prometheus) | Not present | Out of Phase 2 scope | PHASE 3+ |
