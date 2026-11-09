# ADR-025 — HTTP Request Correlation Identity

## Status

- Status: **ACCEPTED** — the project Owner explicitly decided on 2026-11-07
  (EXAM #860/#874 implementation authorization, §0.1) to adopt a
  server-generated UUIDv4 as the HTTP request correlation id. Per the ADR
  authority precedence, this record is merged before the implementation PRs
  it authorizes.
- Date: 2026-11-07
- Decision owners: project (explicit Owner decision, #860)
- Supersedes: none within the ADR corpus.
  `SUPERSEDES_RESEARCH_RECOMMENDATION=KEEP_DEFAULT_OPTION_B` — the #860
  research phase recommended keeping the Fastify default generator. That was
  a research recommendation, not an Accepted ADR; no ADR is overturned by
  this document.
- Related: ADR-005 (binding error-envelope shape), ADR-018 (correlation keys
  in the maintainer window), ADR-020 (HTTP surface authority), ADR-026
  (client-event temporal evidence boundary), #860, #800

## Context

The Fastify default request-id generator is a per-process counter producing
`req-<base36>`. Across API process restarts — and across future multiple API
processes — it reuses identifiers and eventually wraps around, so the same
`requestId` can designate unrelated requests. The #860 decision gate asked
for stable cross-process/restart correlation for log gathering and fault
investigation. Logs are stdout-captured pino JSON (single-instance LAN
deployment); there is no central log store, and none is introduced here.

## Decision

1. **Server-generated UUIDv4 is the HTTP request correlation id.** The single
   production configuration entry is `genReqId: () => randomUUID()` in
   `apps/api/src/server.ts`, using Node's built-in `node:crypto`. No new
   runtime dependency, no central ID service, no instance registry, and no
   distributed-tracing runtime are introduced.
2. **Client-supplied request-id headers are never adopted.**
   `requestIdHeader: false` is part of the same production configuration; no
   client header can override or seed the server id. The production-boot
   guard and client-claim labeling are enforced by tests and the
   observability contract.
3. **Identity correspondence is a binding invariant:** pino `reqId`, the
   error envelope `error.requestId` (envelope shape owned by ADR-005), and
   the HTTP audit writer's `metadata.requestId` carry the same
   server-generated value within one request.
4. **requestId is an HTTP correlation id, not a business identity.** It does
   not replace `operationId`, `eventId`, `clientSeq`, or any domain
   identifier, and it is not proof of authorization or of message origin.
   System operations keep `metadata.operationId` distinct from the HTTP
   `metadata.requestId`.
5. **Client telemetry `metadata.requestId` remains an unverified client
   claim**, even when the value is a syntactically valid UUIDv4.
6. **Historical `req-*` values are immutable:** no migration and no rewrite
   of historical logs, audit rows, or audit-CSV exports. Readers must treat
   both `req-*` and UUIDv4 values as opaque correlation strings.

### Explicit boundaries

- UUIDv4 provides probabilistic uniqueness, not mathematical uniqueness.
- Adopting UUIDv4 is **not** a declaration of multi-instance runtime support;
  scanner ownership/coordination remains a separate blocker.
- No generic observability/tracing framework is adopted by this decision
  (Observability Contract non-goals remain in force).

## Addendum — 2026-11-08, #865 (scope 865-C): `x-request-id` response header

> **Status: ACCEPTED (amended)** — recorded human decision: the 2026-11-08
> final-remediation authorization reopened #865 under its own reopen clause
> and scoped this fourth carrier (865-C). Form follows the ADR-010/ADR-019
> amendment precedent; decisions 1–6 above are unchanged and nothing is
> superseded.

This addendum extends the identity correspondence invariant with a fourth
carrier. It does not supersede any part of the Decision above: the id remains
the single server-generated UUIDv4 from decision 1, `requestIdHeader: false`
(decision 2) is unchanged, and decisions 4–6 (not a business identity,
telemetry claims unverified, historical values immutable) apply unchanged.

- **Carrier.** One root-scope `onRequest` hook
  (`apps/api/src/plugins/requestIdHeader.ts`, registered in `server.ts`
  before any scope) stamps `x-request-id: request.id` on every
  Fastify-managed response. No second randomUUID call exists; the header
  value IS the id from decision 1. With it, the invariant of decision 3
  becomes four-way within one request: response header == pino `reqId` ==
  error envelope `error.requestId` (when an envelope exists — errors only)
  == HTTP audit `metadata.requestId` (where an audit row exists).
- **Why a fourth carrier.** The envelope only exists on error responses;
  success responses previously exposed no request id to the caller, so
  2xx-side correlation relied on client-claimed telemetry ids. The header
  closes that gap with the server-owned value. Web consumption is opt-in
  (`api.getWithMeta`/`api.postWithMeta`); CORS exposes the header only to
  the configured web origin.
- **Documented non-carriable boundary.** Responses that are never sent —
  connection destroyed mid-request, socket-level HTTP framing failures,
  Node-level request/keepAlive timeouts — cannot carry the header; this is a
  transport boundary, not a correlation break (the server's log lines for
  such requests are keyed by the same id).
- **Still not a credential.** A client reading the header gains correlation
  only; it authenticates nothing, and a requestId presented in later client
  telemetry remains an unverified claim (decision 5).

## Addendum — 2026-11-09, #923 (scope 864-C): client-telemetry requestId shape gate

> **Status: RECORDED (informational).** This note documents an existing #923
> implementation detail in the terms of decisions 4–6. It amends nothing,
> supersedes nothing, and introduces no new product behavior.

- **Authority location.** The single shape gate is
  `REQUEST_ID_UUID_SHAPE` in `apps/api/src/lib/proctorMonitoringService.ts`,
  applied in `projectSafeMetadata`. It governs only the allowlisted
  `metadata.requestId` that client-event telemetry contributes to the admin
  monitoring timeline: a claim that is not a well-formed UUID string is
  dropped from that projection (default-deny), not stored or returned.
- **Shape is not identity (decisions 4–5).** Passing the gate does not make
  the value a server-generated id, a business identity, or proof of message
  origin. It stays an unverified client claim under decision 5; the gate
  narrows what is *rendered*, not what is *trusted*. No authorization or
  SaveAnswer production path reads client-claimed telemetry `requestId`.
- **Legacy `req-*` treatment (decision 6).** Decision 6 covers stored history
  — logs, audit rows and audit-CSV exports — which is immutable and read as
  opaque correlation strings; `docs/contracts/observability.md` already states
  "do not rewrite them or infer provenance solely from ID shape", and the
  runbook keeps a legacy `req-<base36>` example. The shape gate is a separate
  rule on a separate surface: the live projection of a value the client
  supplies now, not a rewrite of anything stored. Dropping a legacy-shaped
  claim from the timeline migrates or mutates no historical row.
- **Decision 6 is not narrowed.** The two rules act on different surfaces
  (stored history vs. live projection), so this note records no contradiction
  and does not narrow, amend, or supersede decision 6. Narrowing decision 6 to
  reclassify historical values by shape would require its own superseding
  decision under the authority precedence; that question is left open here.

## Costs

- Log and audit id volume grows (UUID string vs a short counter) — accepted
  at LAN single-instance scale; the runbook filters by equality, so the
  format change does not break operator workflows.
- `randomUUID()` per request is negligible relative to request handling.

## Consequences and reconsideration triggers

Revisit this decision only when one of the following becomes an accepted
work item:

- a real multi-instance deployment decision (correlation would then also
  need instance identity alongside requestId);
- cross-service trace propagation (OTel-class) is accepted, which today is
  out of scope by the Observability Contract non-goals;
- log volume or id-collision becomes a measurable operational problem.

## Relationships

- **related** — [ADR-005](ADR-005-exam-operation-state-baseline.md): the
  error envelope shape `{ code, message, requestId, details }` is unchanged;
  only the id value format changes.
- **related** — [ADR-018](ADR-018-operational-observability-window.md): D4
  names `requestId` as a correlation key; D7 governs any future window
  surface built on it.
- **related** — [ADR-020](ADR-020-http-surface-routing-authority.md): the id
  lives at the `/api` Fastify surface; ADR-020's logging/telemetry exception
  is where request context may appear, and ADR-020 claims no authority over
  id generation.
- **related** — [ADR-026](ADR-026-client-event-temporal-evidence-boundary.md):
  client telemetry `metadata.requestId` stays an unverified claim.
- **related** — [ADR-006](ADR-006-exam-time-authority.md): unaffected; the
  correlation id is not a time source and the generator reads no clock.
- **amends nothing.**

## Normative touchpoints

This ADR is the authority for the requestId wording in
`docs/contracts/observability.md` (request-trace row and correlation
semantics), `docs/contracts/api-contract.md` (error-envelope field and the
`x-request-id` header row), `docs/contracts/api-reference.md` (error-response
example), the deployment runbook's log-lookup examples
(`docs/deployment/mvp-deployment-runbook.md`), and the save-failure correlation
runbook (`docs/operations/save-failure-evidence.md`). These files state the
current UUIDv4 id, the #865 `x-request-id` carrier where it applies, and the
decision-6 rule for historical `req-*` values, and are consistent with this
ADR. If a future change makes one of them diverge, this ADR remains the
authority per the authority precedence.
