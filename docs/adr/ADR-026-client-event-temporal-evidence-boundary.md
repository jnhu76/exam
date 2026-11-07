# ADR-026 — Client Event Temporal Evidence Boundary

## Status

- Status: **ACCEPTED** — the project Owner explicitly decided on 2026-11-07
  (EXAM #860/#874 implementation authorization, §0.2) to keep client
  `occurredAt` as an advisory claim with server `receivedAt` as the temporal
  authority, and to formally record the no-time-window policy.
- Date: 2026-11-07
- Decision owners: project (explicit Owner decision, #874)
- Supersedes: none within the ADR corpus.
  `SUPERSEDES_RESEARCH_RECOMMENDATION=TIME_WINDOW_NO_GO` — the #874 research
  recommendation is hereby adopted as binding policy rather than superseded.
- Related: ADR-006 (exam time authority), ADR-018 (maintainer window D7),
  ADR-025 (client telemetry requestId unverified), #874, #903, #800

## Context

`client_events` stores monitoring evidence reported by exam clients. Each
row carries a client-claimed `occurredAt` and a server-stamped `receivedAt`.
The #874 recheck proved two independent failure classes:

- Extreme but storable client dates (e.g. year 1900 or year 0001) decoded to
  wrong years or `Invalid Date` and could fail the whole investigation
  timeline read.
- Year 0000 is not representable as a PostgreSQL timestamp; an ingest batch
  containing such an event failed atomically, poisoning the valid events
  behind it.

## Decision

1. **`occurredAt` is an advisory client claim, never a time authority.** It
   must not decide deadline, save, submit, grading, or authorization, and
   display logic must not upgrade it to authority. Exam-domain time remains
   governed exclusively by [ADR-006](ADR-006-exam-time-authority.md); this
   ADR does not amend ADR-006, does not introduce a second clock, and does
   not change `fastify.now()`.
2. **`receivedAt` is the authoritative time** for client-event ordering,
   pagination, and retention. It is stamped from the server's adopted clock
   API (`fastify.now()`), consistent with ADR-006's one-capture-per-operation
   rule.
3. **No client-time rejection window.** The server must not add a
   `now ± N` acceptance window that rejects events by comparing client
   `occurredAt` to server time, and must not silently substitute
   `receivedAt` for a client-claimed `occurredAt` in API output or UI.
   Client-claimed time must stay labeled as a claim.
4. **Extreme-date reads must be total.** Timeline reads project
   `occurred_at` as UTC ISO text
   (`to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`)
   so a stored year decodes exactly once, preserves microseconds, and can
   never surface as `Invalid Date` or a silently wrong year. This projection
   is a deliberate string-representation boundary: BC years, year 0000, and
   `infinity` are outside the representable contract; observing one blocks
   any "fully repaired" claim until an explicit representation policy is
   decided.
5. **Non-representable timestamps are rejected atomically per batch.** An
   ingest batch containing such an event fails with a 400 and persists zero
   rows; the remaining valid events stay retryable and isolated.
6. **Poison-batch recovery is classified server-side.** Clients recover from
   a rejected batch only through the server's event classification
   (acknowledge / reject / retry), bounded by `eventId` idempotency and
   bounded retries for stale pages. The server's classification is
   authoritative; the client never decides deletion of events.
7. **Historical client-event rows are immutable:** no rewrite of stored
   `occurredAt`/`receivedAt` values.

## Relationships

- **related** — [ADR-006](ADR-006-exam-time-authority.md): ADR-006 owns exam
  business time and remains untouched; this ADR owns client-event evidence
  time and defers to ADR-006 for any exam-domain use of time.
- **related** — [ADR-018](ADR-018-operational-observability-window.md): if
  client-event temporal evidence is ever surfaced through the maintainer
  window, D7 requires that surface decision to be recorded separately.
- **related** — [ADR-025](ADR-025-http-request-correlation-identity.md):
  client telemetry `metadata.requestId` stays an unverified claim.
- **amends nothing.**

## Normative touchpoints

The as-built authority recorded here lives in the client-event repository
(read projection and batch validation), the client-event API contract, and
[`docs/architecture/exam-system/security-model.md`](../architecture/exam-system/security-model.md)
INV-CE-001..004 (server-owned `receivedAt` ordering). Contract and example
updates ship with the implementation changes and are verified against this
ADR at integration.
