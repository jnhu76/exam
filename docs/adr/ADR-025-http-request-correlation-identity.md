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
  error envelope `error.requestId` == HTTP audit `metadata.requestId`
  (where an audit row exists).
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
semantics), `docs/contracts/api-contract.md`, `docs/contracts/api-reference.md`,
and the deployment runbook's log-lookup examples. Those files currently
carry superseded default-generator wording or placeholder examples and are
updated by the in-flight implementation changes; until they merge, this ADR
outranks them per the authority precedence.
