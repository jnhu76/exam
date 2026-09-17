# EXAM-547 — Fresh adversarial review record

Per the #547 brief §33: after implementation, a FRESH-CONTEXT reviewer (no
prior involvement) was given only Issue #547, the #552 Phase-B section,
ADR-018, the full diff `13457f9b..HEAD`, the 00–03 evidence docs, the tests,
and the PR body. Its 15 attack points, verdicts, and the fix loop:

## Round 1 (on commit `2c9b3353`)

12/15 PASS outright (liveness/readiness separation incl. machine-locked
compose gate; no CPU/memory in readiness; single derivation; truthful
"not a traffic block"; no amplification; Redis classification verified
against the real fail-closed authority; no false startup stall; no storm /
asymmetric recovery; no durable alert state; no restart-hiding; no platform
creep; unattended recovery; sleep-free tests).

Findings:

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | **MAJOR** | `evaluateOperabilityTick` (the alert-emission glue: stalled flag → per-component tracker → `operability.background_loop` fields) had ZERO test references — a swapped tracker or inverted flag would fail no test; `03-alert-contract.md` claimed unit-test pinning that did not exist; readiness-gate.sh D4 header over-titled what it proves. | **FIXED (same pass).** Direct unit suite added: full catalogue pinned end-to-end (readiness database/redis unavailable+recovered; heartbeat/deadline_scanner stalled+recovered with exact event/component/state/level; no-swapped-wiring assertions; S4 no-storm; per-fact bounding with concurrent facts). D4 header re-scoped to what it actually proves (readiness transitions emitted by the monitor's own tick). Contract doc moved to its canonical home `docs/operations/active-alerting.md` (research tree kept as evidence pointer) — its pinning claim is now true. |
| F2 | MINOR | Runbook §7 still labeled `/api/system/health` "Readiness" and still claimed the compose healthcheck polls `/api/health`; docker-troubleshooting.md likewise. Two truth sources for the layer model inside PR-touched docs. | **FIXED (same pass).** Runbook §7 rewritten to the three-layer table (`/api/ready` as the Compose gate); troubleshooting paragraph updated to the readiness-gate probe. |
| F3 | MINOR | `REDIS_MODE=required` + Redis unusable: the limiter fails closed BEFORE the readiness handler, so the 503 body is the API error envelope, not `{status:"not_ready"}` — the docs' body claim was not universally true and the path was untested. | **FIXED (same pass) — and escalated to a real defect:** the route's `503: readyResponseSchema` made Fastify serialize-REJECT the envelope → the wire answer was `500 FST_ERR_RESPONSE_SERIALIZATION`, masking the outage class. Fix: 503 schema is now a UNION (gate body ∪ error envelope) — the fail-closed answer is a truthful 503 `RATE_LIMIT_UNAVAILABLE`, OpenAPI documents both shapes, and a regression test pins `503 + error.code=RATE_LIMIT_UNAVAILABLE`. Docs scope the two shapes (operations README readiness row; 01-semantics §3). |

Reviewer NOTEs also addressed: alert-contract canonical home (moved to
`docs/operations/active-alerting.md`); PR-body placeholders filled. NOTEs
accepted as documented boundaries (not fixed, by design): a fully dead event
loop cannot self-report (inherent); multi-IP pool-saturation flap is bounded
and documented; `curl /api/health` in upgrade-and-uninstall.md is a liveness
smoke check and stays.

## Verification of the fix loop

Focused rerun: readiness/monitor/scanner/system suites 82→ plus the new
catalogue tests — all green (38 in the two touched files, 2739 across the API
suite). `pnpm verify:static` PASS (incl. regenerated OpenAPI golden and the
route-conformance locks). Full API suite: **2739 passed**. Exact-head CI on
the fix commit: see PR body.

## Round 2 (on fix commit `b69dfbb1`)

Focused fresh re-review of the fix delta only. Verdicts:

- **F1 — FIXED_VERIFIED.** The reviewer executed the new suite (32/32) and
  mutation-attacked it: swapping the heartbeat/deadline tracker wiring fails
  4 tests; inverting the stalled/redis gates is caught by the healthy-empty
  and component-isolation assertions. Contract-doc claims audited TRUE field
  by field against the tests.
- **F2 — FIXED_VERIFIED.** Runbook §7 and docker-troubleshooting now match
  the real compose healthcheck; remaining `/api/health` claims live only in
  archive/ and the historical research docs.
- **F3 — FIXED_VERIFIED (mutation-proven).** The reviewer reverted the 503
  schema to the narrow form and the regression test reproduced the exact
  `expected 500 to be 503` defect; union membership mechanically verified
  end-to-end (error envelope shape, requestId format, details optionality,
  zod safeParse serializer); OpenAPI golden correctly became `anyOf`.

No MAJOR findings. Two new MINORs were found and swept in commit
`swept MINOR round-2` (N1: intermediate-design text claiming the route
"declares ONLY its 200 body" — false under the shipped union — corrected in
readiness.test.ts and this task's 01-semantics authority doc; N2: the
full-catalogue pinning claim made literally true — direct
redis/deadline_scanner RECOVERED assertions and full state/level on the
hung-deadline test added — and the pinning comment now names
`docs/operations/active-alerting.md`).

**Round-2 verdict line: VERDICT: 0_MAJOR.**
