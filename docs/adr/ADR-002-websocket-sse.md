# ADR-002 — WebSocket / SSE for Real-Time Updates

## Status

Deferred

> **Current authority note (2026-09-05):** this ADR's Phase 2 role/organization
> wording predates the accepted scoped-RBAC decisions in ADR-010 and ADR-015.
> Any future real-time adoption MUST use the then-current accepted
> capability/resource-scope authorization contract. In particular, Proctor
> access is exam-assignment-scoped; organization membership or a coarse role
> check alone is not sufficient authority.

## Context

Phase 2 introduces a proctor workflow (P2C). The proctor dashboard (P2C-J5) needs to show candidate status — active / disrupted / submitted / graded, remaining time, and connection state — and must reflect admin interventions (force-submit P2C-J2, extend-time P2C-J3, misconduct flag P2C-J4).

The Answer Save Protocol (SPEC §3.5) is HTTP-only: answers are saved to the server on every change via a versioned, idempotent POST. SPEC is explicit that answer saving must **not** depend on WebSocket as the only channel. So WebSocket/SSE is never a correctness requirement for the core exam loop — it is purely a latency/UX concern for the proctor dashboard and any future server-push UI.

Discovery (`docs/archive/phase2-archive/phase2/discovery/06-phase2-gap-analysis.md`) notes that real-time status / candidate status cards / event stream are **missing** today, and that HTTP polling is an acceptable Phase 2 solution. The Phase 2 plan (`docs/archive/phase2-archive/phase2/phase2.plan.md` §7 P2C) and the P2C-J5 job card mandate **HTTP polling first, no WebSocket dependency**: the dashboard polls `GET /api/admin/exams/:id/candidates/status` at a configurable interval (default 5s) and refreshes on the next poll after an admin action.

Therefore the only candidate pain point for WebSocket/SSE is proctor dashboard real-time feel. That pain has not been demonstrated; polling at 5s is the baseline.

## Decision

**Use HTTP polling first. Defer WebSocket/SSE until polling proves insufficient.**

Phase 2 ships the proctor dashboard on HTTP polling. No WebSocket or SSE endpoint is added in Phase 2. WebSocket/SSE may be revisited **only** when a documented Trigger for Adoption is met, through a follow-up decision recorded against this ADR.

The core exam loop (answer save, heartbeat, submit, grading) remains HTTP-only and continues to work identically with or without any real-time transport.

## Triggers for Adoption

WebSocket/SSE becomes a candidate **only** when at least one of the following is concretely demonstrated, not anticipated:

| Trigger | Why real-time | Discovery ref |
| ------- | ------------- | ------------- |
| Polling dashboard is not real-time enough | 5s (or slower) polling creates UX where admin actions or candidate state changes appear stale and operations staff report it as unacceptable. | 06 P1-1 |
| Proctor status latency is operationally unacceptable | Disrupted/expired candidates are acted on too late because the dashboard lags the server by a polling interval. | 06 P1-1 |
| Server-push of candidate state is required | A workflow explicitly needs the server to push (not the client to ask) — e.g. immediate force-submit propagation to candidate clients. | 06 P1-1 |

Each trigger must be evidenced by real operational feedback or a measured latency problem, not by "real-time sounds better."

## Non-Goals

- WebSocket/SSE for answer saving. The Answer Save Protocol is HTTP POST; it stays HTTP POST. A real-time channel must never become the only path to save an answer.
- WebSocket/SSE for exam correctness (timer, deadline, state transitions). The server is the time authority; the client countdown is cosmetic. Real-time push does not change that.
- A generic push platform. Real-time, if adopted, targets the proctor dashboard (and possibly candidate-side intervention propagation), not every page.
- A Phase 2 dependency. Polling is the Phase 2 default.

## WebSocket vs SSE Trade-off

If a trigger is met, the choice between WebSocket and SSE should be made with these constraints:

| Dimension | WebSocket | SSE (Server-Sent Events) |
| --------- | --------- | ------------------------ |
| Direction | Bidirectional (client ↔ server) | Server → client only |
| Use case fit | If the client must push to the server over the same channel (rare here — answer save stays HTTP) | If the need is purely server-push of proctor/candidate events (likely fit) |
| Reconnection | Must be implemented manually | Built-in browser reconnect with `Last-Event-ID` |
| Message framing | Binary or text frames | Text only (UTF-8) |
| Proxy/LAN behavior | Some LAN proxies/WebTerminals handle Upgrade poorly | Plain HTTP, friendlier to LAN proxies |
| Complexity | Higher (connection lifecycle, subprotocol, back-pressure) | Lower for one-way push |

**Working assumption (to be confirmed at adoption):** the dominant need is server-push to the proctor dashboard (one-way), for which **SSE is the lighter default**. WebSocket is justified only if a genuinely bidirectional low-latency channel is required (e.g. live lockstep between candidate client and server). This assumption must be revisited in the follow-up decision; it is not a Phase 2 commitment.

## Minimal Viable Adoption

If a trigger is met:

1. **Start with SSE for server-push** to the proctor dashboard unless a bidirectional need is proven. Keep answer save on HTTP POST.
2. **One endpoint, one direction.** Do not build a generic pub/sub bus. Ship exactly the proctor dashboard event stream.
3. **PostgreSQL stays source of truth.** Events are derived from existing DB state (attempt status, audit events). The real-time channel is a projection, not a store.
4. **Polling stays as fallback.** The polling API must remain so that dashboards degrade gracefully when the real-time connection is unavailable. This also keeps the dashboard testable without a persistent connection.
5. **Config-gated, default off.** Real-time is enabled by an explicit flag; polling remains the default.
6. **Operations runbook.** Document connection limits, idle timeout, reconnect behavior, and auth (below) before enabling.
7. **Re-audit authorization at adoption time.** The stream MUST reuse the current accepted capability and resource-scope authority. Do not copy the historical Phase 2 Admin/organization assumptions into a new transport.

## Operational Burden

- **Long-lived connections** change the server's connection model. Fastify must handle many idle keep-alive sockets; connection limits, timeouts, and reverse-proxy buffering must be reconfigured.
- **Stateful server affinity** becomes relevant under multi-instance (ties into ADR-001). A single instance does not need affinity; multi-instance does.
- **Reconnection / replay** logic must be designed (resumable event stream, last-event-id, bounded replay buffer).
- **New failure surface** — dropped connections, half-open sockets, proxy timeouts — that polling does not have.
- **Observability** — connection count, reconnect rate, event lag must be monitored.
- **Test complexity** — polling E2E is straightforward; persistent-connection E2E is flaky if not deterministic.

## Failure Modes

- **Connection drops / half-open.** The dashboard must fall back to polling and show a "reconnecting" state. No data is lost because the source of truth is PostgreSQL and the polling API still works.
- **Server restart during a live exam.** Reconnect + replay must recover; if replay is bounded or unavailable, polling catches up on the next interval. Answer save and submit are unaffected (HTTP).
- **Event lag / out-of-order delivery.** Each event must carry enough identity (attemptId, version, timestamp) that the client can discard stale or duplicate events. The client must reconcile against the polling snapshot, not trust push blindly.
- **Resource exhaustion** — too many open connections. Mitigated by connection caps and by keeping polling as the default.

## Security Considerations

- **Authentication.** The real-time channel authenticates with the same session cookie / JWT as HTTP routes. No separate token scheme. Unauthenticated connections are rejected on connect.
- **Reconnection.** Use the transport's built-in reconnect (SSE `Last-Event-ID`) or a documented client-side backoff (WebSocket). Reconnect must re-authenticate.
- **Permission / RBAC.** The real-time channel MUST reuse the same accepted capability and resource-scope authorization model as the corresponding HTTP projection. Authorization is not a coarse `role + organizationId` gate. A Proctor stream is limited to exams for which the actor has the required capability **and** the current Proctor→Exam assignment scope (ADR-010 / ADR-015); other roles follow their current accepted authority contract. Authorization must be revalidated whenever events are emitted or entitlement/scope may have changed, so a long-lived connection cannot preserve authority that has been revoked mid-session.
- **Audit.** State-changing actions (force-submit, extend-time, misconduct) are audited via the existing audit log through their HTTP command functions, exactly as in Phase 2 polling. The real-time channel is a notification transport; it does not carry authority to mutate state. No second mutation path.

## Rollback Plan

1. Disable the real-time feature flag. The proctor dashboard falls back to the existing polling API, which remains the default and is fully functional.
2. No data reconciliation is needed — events were projections of PostgreSQL state, never the truth.
3. Remove the real-time endpoint and any client subscription code.
4. Update this ADR to record why adoption was rolled back.

Rollback is safe because polling is the baseline and the design rule (real-time = projection only) guarantees HTTP polling can stand alone.

## Phase 2 Decision

**Use HTTP polling first. Defer WebSocket/SSE until polling proves insufficient.**

- The P2C-J5 proctor dashboard ships on HTTP polling (default 5s).
- No WebSocket/SSE endpoint is added in Phase 2.
- Any future adoption requires (a) a documented, measured trigger from the table above, (b) a minimal server-push rollout (SSE preferred), and (c) an update to this ADR.
- Answer Save Protocol and exam correctness stay HTTP-only regardless of any future real-time adoption.
