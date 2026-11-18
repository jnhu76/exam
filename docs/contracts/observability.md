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
| timestamp | pino `time` | `1730000000000` | epoch-milliseconds integer (pino default); jq needs `(.time / 1000 | todate)` for ISO |
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
- **DB transaction retry correlation (#1006).** The `transaction retry`
  WARN emitted by `packages/db` (`executeInTransaction`) carries a CLOSED
  `correlation` object only when the call site supplies one:
  `{ requestId?, attemptId?, organizationId?, operation? }` — `requestId` is
  the same server-minted `request.id` used by the `x-request-id` header and
  the Pino request trace (ADR-025), `attemptId`/`organizationId` come from the
  authorized request context, and `operation` is a closed enum (currently only
  `attempt.answer.save`). The answer-save call site is the only wired one;
  other call sites omit correlation rather than fabricating an HTTP identity. The
  retry logger is deliberately synchronous and fail-open: a logger failure
  never aborts a retry, changes its backoff, or alters the transaction result.
  Join rule (same `requestId`, complete log capture, the wired answer-save
  transaction only):

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
- **Candidate submit outcome (#1007, commit-authoritative).** The
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

  Accepted V1 limits (#1000): a sink failure drops the line without a delivery
  retry. A process crash between COMMIT and the synchronous emit or a log
  collection filter can also leave no line. The durable business fact is the
  database row (EXSEM-013).
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


## Authentication and rate-limit observability (#1005 — DEFER)

#1000 E04 / #1005 (W01 unauthenticated 401 reason signal) is closed as
**DEFER + docs-only** (Owner disposition,
`issues/1005#issuecomment-6960996678`): no diagnostic reason
channel, counter, or response change was added. This section is the
documentation deliverable of that disposition (its item 3; not part of any
code PR) and describes only the as-built behavior of existing code.

### Unified anonymous 401 surface (deliberate)

Every 401 emitted by the `authenticate` preHandler returns the SAME envelope
— `{error: {code: "AUTH_REQUIRED", message, requestId}}` — from all its
anonymous exits: missing/unreadable auth cookie (`apps/api/src/plugins/auth.ts:68-77`),
failed JWT verification (`:82-86`), unknown or inactive user (`:112-116`),
and authEpoch mismatch (`:123-127`). The no-context exits of
`requireRole` / `requireCapability` use the same 401 `AUTH_REQUIRED` form
(`:226-230`, `:267-272`). No reason, epoch value, or credential shape is
disclosed to the anonymous caller.

This is deliberate design, anchored in two places:

- `apps/api/src/plugins/auth.ts:118-122` — the epoch-mismatch exit shares the
  generic failure surface by intent ("Same generic failure surface as invalid
  or expired tokens — no epoch values, no reason distinction"), citing #325.
  #325 established the durable revocation authority itself — per-user
  `auth_epoch`, the JWT `authEpoch` claim compared against the persisted
  epoch on every authenticated request, legacy tokens failing closed — and
  does not contain a "do not disclose reasons to anonymous clients"
  sentence in its issue text or comments; that formulation lives in the code
  comment, in D0.5, and in the #1005 disposition.
- `docs/contracts/api-contract.md` D0.5 — `error.message` is
  non-authoritative compatibility text; machine clients must not parse it.

Observed consequence (measured in the #1005 audit's in-process witness): the
four states — invalid/expired token, unknown/inactive user, epoch mismatch —
produce byte-identical 401 bodies (only the requestId differs) and identical
log output. A garbage-credential scan and a legitimate epoch-revocation
lockout are indistinguishable from response shape or logs alone; that is the
accepted cost of the unified surface. The distinguishing evidence available
today is timestamp correlation plus, for the no-active-assignment case, the
WARN documented below.

Distinct shapes that are NOT this surface: a failed interactive login
returns 401 `AUTH_INVALID_CREDENTIALS` (`apps/api/src/routes/auth.ts:167-169`
and the other login-failure exits), and operational failures of the authority
loader fail closed as 503 `AUTHZ_UNAVAILABLE`, never masquerading as 401
(`apps/api/src/plugins/auth.ts:146-153`, `:167-174`).

### What a 401/403/429 leaves in stdout

For these responses, start with the two Pino request trace lines
(see Request trace fields / Request correlation semantics). Interactive
login and the no-active-assignment path can add the separate evidence
described below.

- incoming: `msg: "incoming request"` with `reqId` and
  `req: {method, route, remoteAddress, remotePort}` — `route` is the matched
  route template (or the fixed `(unrouted)` placeholder); the raw URL is
  structurally absent (#925);
- completed: `msg: "request completed"` with `reqId`, `res: {statusCode}`
  and `responseTime` — with NO `route` (the template lives only on the
  incoming line) and no `errorCode`.

The completed line's `res.statusCode` identifies the response status.
Per-route aggregation joins the trace lines on `reqId`. The
`x-request-id` header is stamped on every Fastify-managed response —
including 401 and 429 (`apps/api/src/plugins/requestIdHeader.ts:34-37`) — so
a caller-reported request id is directly greppable in stdout.

Key-spelling hazard for aggregation: request-bound lines (the two trace
lines and anything emitted via `request.log`) carry the Pino binding
`reqId`, while root-logger events — the login `security.authentication`
events (`apps/api/src/routes/auth.ts:156-404`), the auth operational error
lines, and the transaction-retry WARN's `correlation.requestId` (#1006) —
carry the request identity in `requestId` or `correlation.requestId`, depending
on the event. A query must state which line families it searches.

### stdout jq recipes

Export a bounded time window of app stdout as local `app.log`. The
preprocessing step retains JSON objects and skips non-JSON lines. Results
describe the retained records in that window. If the stream was incomplete
or lines could not be parsed, zero matching records means no matching
evidence in that export.

```bash
jq -Rrc 'fromjson? | objects' app.log > app.jsonl
```

`time` is an epoch-milliseconds integer (see Request trace fields).
Status-code histogram of completed requests:

```bash
jq -r 'select(.msg == "request completed") | .res.statusCode' app.jsonl \
  | sort | uniq -c | sort -rn
```

Aggregate error responses by route template and status by joining incoming
and completed lines on `reqId`. This reads the full bounded export into
memory. `(route unknown)` denotes missing join evidence. `(unrouted)` is the
route placeholder emitted by the request serializer.

```bash
jq -sr '
  (reduce (.[] | select(.msg == "incoming request" and
    (.reqId | type) == "string" and (.req.route | type) == "string")) as $l
    ({}; .[$l.reqId] = $l.req.route)) as $route
  | [ .[] | select(.msg == "request completed" and
      (.res.statusCode | type) == "number" and .res.statusCode >= 400)
    | {route: ($route[(.reqId // "") | tostring] // "(route unknown)"),
       status: .res.statusCode} ]
  | group_by([.route, .status])
  | map(.[0] + {count: length})
  | sort_by(-.count)' app.jsonl
```

Login denial reasons — root-logger events, note the `requestId` payload key
(not `reqId`) and the closed `reason` enum
(`unknown_organization|unknown_user|disabled_user|invalid_password|no_active_assignments|admin_maintainer_exclusion|non_login_role`,
plus `credentials_and_authority_accepted` on success paths):

```bash
jq -r 'select(.event == "security.authentication")
  | [(.outcome // "-"), (.reason // "-")] | @tsv' app.jsonl | sort | uniq -c
```

Search the retained trace, root events and retry warnings for one request id:

```bash
jq -c --arg id '<request-id>' \
  'select(.reqId == $id or .requestId == $id or .correlation.requestId == $id)' \
  app.jsonl
```

Readable timestamp for one status family:

```bash
jq -r 'select(.msg == "request completed" and .res.statusCode == 429)
  | (.time / 1000 | todate)' app.jsonl
```

### The no-active-assignment WARN and its missing reqId

Naming mapping first: the #1005 disposition calls this the "authority_denied
WARN". `authority_denied` is the counter-enum vocabulary of the design
catalog (`docs/design/native-observability-contracts.md:133,406`); no such
key exists in code. The as-built emission is
`apps/api/src/plugins/auth.ts:159-162`:

```ts
fastify.log.warn(
  { actorId: user.id, reason: authority.reason },
  "authenticate: no active assignment authority — deny login",
);
```

with `reason` fixed to `no_active_assignments` — the only member of
`AUTHORITY_401_REASONS` (`apps/api/src/plugins/auth.ts:24-27`). It fires when
the JWT verified, the user is active, and the epoch matched (i.e. past all
anonymous 401 exits) but no ACTIVE `user_role_assignments` row resolves: one
WARN per request, carrying `actorId` and `reason` only.

Known limitation (accepted with the DEFER): the line goes through the ROOT
logger (`fastify.log`), so it carries neither the `reqId` binding nor a
`requestId` payload — unlike the sibling operational error lines in the same
function (`apps/api/src/plugins/auth.ts:103-106`, `:146-149`, `:167-170`),
which all carry `requestId: request.id`. Until re-evaluation, correlation is
timestamp-proximity plus `actorId` only. The counter-only projection from
the design catalog is NOT implemented — `GET /api/system/diagnostics`
exposes no 401/authDenied counters (`apps/api/src/routes/system.ts`).

### 401 vs 403 vs 429 response shapes

| status | code | exit | notes |
| --- | --- | --- | --- |
| 401 | `AUTH_REQUIRED` | authenticate anonymous exits + no-ctx gates | unified surface above; no reason disclosed |
| 401 | `AUTH_INVALID_CREDENTIALS` | interactive login failures (`apps/api/src/routes/auth.ts`) | distinct code; has its own `security.authentication` WARN line |
| 403 | `PERMISSION_DENIED` | requireRole / requireCapability denials (`apps/api/src/plugins/auth.ts:232-236`, `:274-278`) | authenticated but unauthorized |
| 403 | `AUTH_REGISTER_DISABLED` | register route disabled (`apps/api/src/routes/auth.ts:115`) | deployment state, not caller fault |
| 403 | `CSRF_ORIGIN_REJECTED` | origin check (`apps/api/src/plugins/security.ts:160-169`) | onRequest-stage rejection |
| 429 | `RATE_LIMITED` | limiter `errorResponseBuilder` throws `AppError` → global error handler (`apps/api/src/plugins/rateLimit.ts:107-113`, `apps/api/src/plugins/errors.ts:106-111`) | standard envelope plus rate headers below |

All rows carry the standard envelope, the registry compatibility message,
and `x-request-id`.

### Rate-limit boundary (429)

Scope: the limiter is registered inside the /api encapsulation
(`apps/api/src/routes/apiSurface.ts:44-47`) — every `/api` route enters it,
including `/api/health` and `/api/ready`; the docs surface and the static
frontend are outside the limiter by encapsulation (no allow-list, no URL
inspection).

Keys: `request.ip` is HMAC-SHA256-digested with the deployment JWT secret
(domain separator `exam-ratelimit-ip-v1:`; `apps/api/src/redis/rateLimitKey.ts`)
— raw IPs never enter the keyspace. Redis keys sit under the `ratelimit:v1:`
namespace; override routes are additionally prefixed `${method}${url}-`
(`apps/api/src/redis/rateLimitStores.ts`), which is what isolates their
budgets per method+route+IP.

Budgets (defaults from the settings leaves `RATE_LIMIT_MAX` = 100 and
`RATE_LIMIT_WINDOW_MS` = 60000, `apps/api/src/config/settings.ts:694-695`):

| bucket | budget | dimension |
| --- | --- | --- |
| all non-override /api routes | 100 per 60 s | ONE shared per-IP bucket across ALL such routes |
| POST /api/auth/login (`routes/auth.ts:122`) | 10 per 60 s | per method+route+IP |
| POST /api/auth/invitations/accept (`routes/auth.ts:755`) | 10 per 60 s | per method+route+IP |
| POST /api/auth/password-reset/consume (`routes/auth.ts:995`) | 10 per 60 s | per method+route+IP |
| POST /api/auth/password-reset/request (`routes/auth.ts:861`) | 5 per 600 s | per method+route+IP |
| POST /api/candidates/import (`routes/candidate.ts:533-537`) | 10 per 60 s | per method+route+IP |
| POST /api/invitations (`routes/invitation.ts:73`) | 20 per 60 s | per method+route+IP |
| POST /api/launchpad/bootstrap (`routes/launchpad.ts:107`) | 5 per 60 s | per method+route+IP |

The disposition's "单 IP/路由 ≤100/min" is the loose form of this table. The
as-built default is one cross-route per-IP budget — a single IP drawing on
two different non-override routes consumes ONE shared bucket, not 100 per
route — and only the seven overrides isolate per route. No budget bounds the
aggregate across many IPs: per-IP buckets multiply without a global cap, and
that unbounded multi-IP aggregate is the accepted current cost of the 429
boundary (disposition item 3).

429 responses carry `x-ratelimit-limit` / `x-ratelimit-remaining` /
`x-ratelimit-reset` (also present on un-exceeded responses) and
`retry-after` (429 only). These are `@fastify/rate-limit` defaults —
`apps/api/src/plugins/rateLimit.ts:98-114` does not override `addHeaders` —
so re-verify them if that dependency is upgraded. Enabled logic: production
always on, e2e fully bypassed, dev/test disable via `RATE_LIMIT_DISABLED`
(`apps/api/src/config/runtimeConfig.ts:712-716`). Store selection: shared
Redis while ready, in-process local store when Redis is off or degraded in
`optional` mode, fail-closed 503 `RATE_LIMIT_UNAVAILABLE` in `required`
mode.

Deployment sizing (`RATE_LIMIT_MAX` headroom, login staggering, trusted
proxy wiring) is operator guidance and lives in
`docs/deployment/mvp-deployment-runbook.md` §"Rate-limit identity, trusted
proxies, and sizing (#546)"; the code defaults above are the contract.

Re-evaluation triggers for the DEFER (disposition item 4) — any one fires
the counter-proposal (owner-local fixed-enum counters + a read-only
diagnostics `authDenied` projection, brief already prepared):

1. any deployment completes E-2 401 rate sampling and the magnitude would
   interfere with operational judgment;
2. a real incident needs reason attribution to change a decision;
3. the Owner approves a `DiagnosticsResponseSchema` additive change — at
   which point the keep-or-demote decision for the WARN above must be
   adjudicated in the same batch (demotion permanently loses its `actorId`
   attribution);
4. the deployment form changes.

Residual NOT_MEASURED: production 401 rate / reason distribution (no
deployment has run E-2 sampling).

The operations-window rehearsal and application entry point are tracked in
[#1032](https://github.com/jnhu76/exam/issues/1032).


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
±1 B for the pid digit count). Both reqId scopes stay within the pinned
<= 512 B test budget; log-volume estimates should use the production figures.
Frequency: one completed line per successful
command request and at most one denied line per covered denial — bounded by
admin command traffic, not an always-on per-request line. Failure isolation:
the emitter swallows a synchronous logger failure (same fail-open contract as
the transaction retry logger); an emit failure never changes a committed
result or the HTTP response. Accepted V1 limits (#1000): a process crash
between COMMIT and emit, sink failure or collection filtering can leave no
line. Resolve the business outcome from the committed database evidence.

> #1000 accepts the shipped #1008 log contract: `event`, `disposition`,
> and the time-grant `terminal` mapping above. The mapping describes the
> command disposition for this run. W07 request p99 and CPU remain
> INCONCLUSIVE; V1 accepts the bounded emission evidence and targeted tests
> for this command path.

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

The background scanners (heartbeat, deadline) and the email outbox delivery
loop (§Email error privacy) are the background jobs of Phase 2; the scanners
run in-process on `setInterval`. Their diagnostics contract:

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

### Deadline scanner tick settlement (#1009)

A settled NON-EMPTY deadline scanner tick emits exactly one structured
settlement line (`deadlineScanner.ts` tick body). It replaces the former
count-gated summary — which fired only on `submittedCount > 0 ||
failedCount > 0` — so acted/partial ticks are a 1:1 line-for-line replacement
and the net-new line type is the `no_op` settlement (non-empty ticks whose
candidates all resolve no-op under lock; previously these ticks were
indistinguishable from empty ticks):

| Field | Value | Notes |
|---|---|---|
| event | `scanner.tick.completed` | |
| scanner | `deadline` | the heartbeat scanner's same-shape summary gate is unchanged — it does not emit this event |
| tickId | one `randomUUID()` per fired tick | the identity of one scan cycle (one interval firing); also carried by the tick's per-candidate error lines (`deadlineScanner.ts:422-432`) as the join key to the settlement line. A background identity, never an HTTP requestId; not persisted, not reused across ticks; skipped (overlapped) ticks mint none |
| outcome | `no_op` / `acted` / `partial_failure` | `no_op`: candidates discovered, every under-lock recheck resolved no-op; `acted`: at least one submission and no candidate failure; `partial_failure`: at least one candidate failure. A thrown tick keeps the existing tick-level error line + `consecutiveThrowTicks` and never emits a fabricated settlement line |
| submittedCount, failedCount, discoveredCount, noOpCount | non-negative integers | `discoveredCount` is the discovery-set size (`listDeadlineCandidates` rows iterated); `noOpCount` counts candidates the under-lock canonical recheck rejected. All counts are known in this implementation — the explicit-`unknown` count form is not reachable and is not emitted |

Emission condition: non-empty ticks only (`submittedCount + failedCount +
discoveredCount > 0`). An empty tick (zero discovered candidates) emits zero
lines — the accepted empty-tick blindspot is intentionally unchanged; there is
no `empty` outcome. Serialized size: ≤ 512B budget; measured 254B (`no_op`),
254B (`acted`), 264B (`partial_failure`) per complete pino line (utf8,
production logger shape, trailing newline excluded), against 157B for the
former summary line — the per-tick byte delta on previously-emitted ticks is
+97B (acted) / +107B (partial_failure).

Sink isolation: a synchronous log-sink throw at any of the scanner's three
emission points — the settlement line, the per-candidate error line, and the
tick-level error line — is swallowed at the emit point and never reclassified
as scan evidence: it does not abort the remaining candidates of the tick, does
not count as a tick throw (`consecutiveThrowTicks` → `operability.tick_failure`
would fire on a healthy scanner), and never escapes the tick body as an
unhandled rejection. Losing that line is the accepted cost — the sink that
just threw is not a channel to report the loss on. The in-process failure
evidence remains the counted candidate failure (`failedCount` /
`consecutiveFailedTicks`) and the settled tick counters — process-local
diagnostics reset on restart, not durable facts. A genuine scan error still
counts as a tick throw (`consecutiveThrowTicks`) regardless of whether its
error line could be written.

E-2 at #1000 closeout: the same-SHA harness observed approximately
1.9–2.7 µs per emitted settlement in a synthetic scanner workload. The
pre-registered comparison remains INCONCLUSIVE. The measurement covers
emission, serialization and the test sink. It excludes the full scan and
production workload. V1 accepts the tested event-rate and byte bounds;
full-path CPU verification is deferred. Production frequency and request
p99 remain unmeasured for this change.

> Implementation status: scanIntervalMs, lastScanAt, disruptedCount,
> failedCount, incidentReconciliationFailedCount and consecutiveFailedTicks are
> surfaced via `/system/diagnostics` from the `heartbeatMetrics` /
> `deadlineScannerMetrics` objects. Failed auto-submits are additionally logged
> via `logger.error` (deadlineScanner.ts:422-432), carrying the same `tickId`
> as their tick's settlement line (#1009). The heartbeat incident
> reconciliation counters (`incidentCreatedCount` / `incidentConflictCount`)
> are surfaced the same read-only way through the existing diagnostics
> response (#1004) — they are host-level, process-local counters, never a
> tenant-scoped incident report. No structured-job-log table exists; this is
> intentional for Phase 2 (no queue/worker). Redis diagnostics are also
> surfaced in diagnostics (`redisStatus`).

## Email error privacy (#1012 / E11 — closed-field policy)

#1012 (E11: W12 error-text privacy sinks) landed via PR #1016 (merge commit
`e5287bc9`): a single privacy-policy owner,
`apps/api/src/email/sanitizeError.ts`, sits in front of every surface that
persists, logs, or serves an email-worker error — `SmtpEmailSender` wrapping,
outbox `lastError` persistence plus the dead-letter log line, both host
transports, `/email/test` responses, and the diagnostics read-side
projection. Behavior witnesses:
`apps/api/src/email/sanitizeError.witness.test.ts`,
`apps/api/src/email/senders.witness.test.ts`,
`apps/api/src/email/outboxService.witness.test.ts`,
`apps/api/src/workers/emailDeliveryWorker.witness.test.ts`,
`apps/api/src/routes/system.emailPrivacy.witness.test.ts`.

### Closed-field classification

Classification never reads free text: raw `message`, `name`, `stack`,
`response`, and `String(err)` are structurally unreachable
(`classifyEmailError`, `sanitizeError.ts:239-253`). The only retainable
inputs are closed fields:

- `code` must hit a fixed allowlist — 16 SMTP transport codes (`EAUTH`,
  `ETIMEDOUT`, `EENVELOPE`, …) plus 18 PostgreSQL SQLSTATEs
  (`sanitizeError.ts:50-87`); a correctly-shaped value outside the closed
  sets is rejected, not passed through;
- an integer SMTP `responseCode` within 400–599;
- the `cause` chain, inspected through the same closed-field reads only and
  depth-bounded at 2 (the #1016 bounded nested-cause fix): circular chains,
  throwing getters, and deeper codes degrade to `internal_error`.

Classification never throws; hostile shapes (throwing getters, `toString` /
`toJSON` tricks) degrade to the fixed `internal_error` category. The output
is always the canonical safe string — `email_error:<category>` plus optional
` code=<allowlisted>` and ` rc=<int 400-599>`, e.g.
`email_error:smtp_auth_failed code=EAUTH rc=535` — the ONLY shape new
`lastError` writes and log emissions produce
(`formatEmailErrorClassification`). The seven categories:
`smtp_auth_failed`, `smtp_connection_failed`, `smtp_recipient_rejected`,
`smtp_send_failed`, `db_connection_failed`, `db_error`, `internal_error`.
`smtp_recipient_rejected` never carries `code`/`rc`: a provider-rejected
recipient keeps delivery-failure semantics without the echoed address
(`senders.ts:160-173`). `EmailSendError` is constructible only from a
classification, so its `message` is always the safe rendering
(`sanitizeError.ts:291-299`).

### Two hosts, one source policy

- **API process (in-process outbox loop)** — the loop's log function routes
  into `fastify.log`, i.e. the production Pino logger
  (`apps/api/src/plugins/emailOutboxLoop.ts:46-55`). The email error enters
  Pino as an already-sanitized `error` string field, not through the `err`
  serializer channel; the line's safety comes from the source policy, not
  from Pino redaction.
- **Standalone worker (`worker:email` entry, `apps/api/package.json:27-28`)** —
  a self-contained logger writes `JSON.stringify({ts, level, worker, msg,
  ...meta})` to `process.stderr` (error level) / `process.stdout` (all other
  levels) (`apps/api/src/workers/emailDeliveryWorker.ts:50-63`) — no Pino, no
  serializers, no redact list. The entry remains in the tree although the
  in-process loop is the default deployment topology.

Both hosts import the same `sanitizeEmailError`; the transports do no
scrubbing of their own. On poll failure each host derives ONE safe
representation that feeds BOTH exits — the log line and the persisted
heartbeat — so the two cannot disagree (`emailOutboxLoop.ts:144-150`,
`emailDeliveryWorker.ts:296-315`).

### Persisted values

`worker_heartbeats.last_error` is a storage passthrough: write-side safety
is owned by the email policy (every current writer passes only
`sanitizeEmailError` output, the fixed `bootstrap_pending` label, or `null`),
and readers must treat any stored value as untrusted input — history written
by older workers is covered by the read-side projection below, not by
rewrites (`packages/db/src/repository/workerHeartbeatRepo.ts` OWNERSHIP).
Likewise `email_outbox.last_error`: `markRetryWait` / `markDead` receive the
already-sanitized string from their only caller
(`apps/api/src/email/outboxService.ts:122-125`), and the dead-letter error
line carries only `emailId` / `attemptCount` / `lastError`
(`outboxService.ts:144-151`).

### Read-side projection (historical values)

`projectStoredEmailError` (`sanitizeError.ts:387-392`) is the only sanctioned
way a stored email error re-crosses an HTTP boundary:

| stored value | projected |
| --- | --- |
| `null` | `null` (no-current-error contract untouched) |
| `bootstrap_pending: initial organization not initialized` | passed through |
| canonical safe string (full-grammar match, closed sets, writer-producible `(category, code, rc)` pairing, byte-identical re-render) | passed through |
| everything else — pre-policy free text, malformed values, trailing garbage | `email_error:undisclosed` |

The only HTTP consumer is the diagnostics `emailStatus.worker.lastError`
projection (`apps/api/src/routes/system.ts:124`). Health derivation reads
the RAW null/non-null distinction (`system.ts:128`), so the projection can
never cosmetically mask a problem heartbeat as healthy. Read-side
protection does NOT physically purge historical bytes from the database; it
only stops their disclosure — retention/cleanup is #1013's scope.

### Where the operational guidance lives

This section is the behavior contract. The operator-facing guidance for the
three guarantees is NOT duplicated here:

- process output and `/email/test` responses while configuring SMTP —
  `docs/operations/email-config.md`;
- persisted values (heartbeat/outbox) and historical-data reading via
  diagnostics, in deployment-topology context —
  `docs/deployment/mvp-deployment-runbook.md` §8 (Email outbox loop).

### E10 note: audit actions stay RESERVED

The `email.send_failed` / `email.send_retried` audit actions remain RESERVED
and unwired: #1011 closed OMIT / keep-RESERVED (Owner ruling
`issues/1011#issuecomment-6960999077`; NOT_PLANNED close
`#issuecomment-6979452290`, whose optional contract note rides with the
#1000 doc closeout). The optional `auditEmitter` callback is retained in
`outboxService.ts:50-56` but neither production host wires it
(`emailOutboxLoop.ts`, `emailDeliveryWorker.ts` pass no such dependency).
Outbox rows, the diagnostics projection, and the log lines above are the
ONLY operational evidence for email failure/retry; the failed-attempt
sequence history is an accepted blindspot. Re-evaluate only when a
compliance/forensic consumer appears or an `audit_logs` retention decision
is scoped (per the #1011 ruling).

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
| Candidate submit outcome (#1007) | Done: one commit-authoritative `attempt.submit.completed` per committed submit execution (five-value outcome) | V1 accepts the best-effort emission and collection limits described above | — |
| DB transaction retry correlation (#1006) | Done for the answer-save call site (closed `correlation` on retry WARN) | other call sites stay opt-in; terminal outcome is a log-join inference only | — |
| Admin command outcome events (#1008) | Done for force_submit / time_grant (completed + denied; V1 accepts the shipped log contract) | W07 CPU/p99 remains INCONCLUSIVE; other admin routes are outside this scope | — |
| Anonymous 401 reason diagnostics (#1005) | DEFER — docs-only (§Authentication and rate-limit observability: unified-surface rationale, jq recipes, WARN limitation, 429 boundary) | No reason channel; production 401 rate/reason distribution NOT_MEASURED (no E-2 sampling yet); re-evaluate on the four triggers | DEFER |
| requestId in error envelope | Done | — | — |
| actorId/role/orgId in business logs | Available via ctx; included in audit + errors | Standardize in business log statements | SHOULD FIX (incremental) |
| State transition audit rows | Done (action/target/metadata/createdAt) | Standardize `metadata.stateBefore/stateAfter/source` | SHOULD FIX (incremental) |
| Background job diagnostics | Done via `/system/diagnostics` + scannerMetrics | — | — |
| Email error privacy (#1012 / E11) | Done via PR #1016 — single closed-field policy owner; classification, dual-host exits, persisted safe values, read-side projection (§Email error privacy, witness tests in `apps/api`) | — | — |
| Redis diagnostics | Done (`redisStatus` in diagnostics, Phase C) | — | — |
| Pino redaction (creds/tokens/cookies/auth/standardAnswer) | Done | — | — |
| No answer-content / full-body logging | Policy (manual discipline) | Add a lint/test guard if abuse appears | DEFER |
| Distributed tracing (OTel) | Not present | Out of scope: ADR-028 REJECTED (2026-11-16); future direction is native-facility enhancement per PROPOSED ADR-029 | Revisit only via an accepted ADR |
| Centralized metrics (Prometheus) | Not present | Out of Phase 2 scope | PHASE 3+ |
