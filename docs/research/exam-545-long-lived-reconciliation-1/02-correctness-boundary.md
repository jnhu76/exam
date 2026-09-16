# #545 Correctness boundary — which historical episodes must stay discoverable

FROZEN AUTHORITY (#304 / PR #537, unchanged): a heartbeat-detected episode stays reconcilable
until its episode-derived System create operation has durably committed in the
`exam_incident_events_org_operation_unique` arbiter WITH `commandType =
createSystemIncidentFromHeartbeatEpisode` AND the episode's full canonical payload
(`isMatchingCommittedOperation`). Nothing else is completion.

```text
RECONCILABLE(ep) ≡
  ep is a committed heartbeat-detected episode of the organization
  AND NOT isMatchingCommittedOperation(
        arbiter[systemIncidentOperationId(ep.interruptionId)],
        SYSTEM_INCIDENT_CREATE_COMMAND,
        canonicalPayload(ep))
```

## Classification

| Class | Shape | Durable fact that proves state | Exclude from discovery? |
| --- | --- | --- | --- |
| C1 | newly detected, no committed op | detected event; no arbiter row under derived opId | **NO** — live work |
| C2 | old + matching committed System op | arbiter row: derived opId + command + full payload match | only via the **full** matching predicate |
| C3 | old, delivery failed before, no committed op | failures are count+log only (stateless design); detected event + absent arbiter row | **NO** — still live (#304 stateless retry) |
| C4 | old, derived opId occupied by a different command/payload | arbiter row: opId hit, command or payload mismatch | **NO** — must surface `IdempotencyConflictError` every cycle, never silently skip |
| C5 | old + human incident (and/or human link) exists, System op missing | human incident row / link row; no arbiter row under derived opId | **NO** — `FIELD/LINK EXISTS ≠ SYSTEM COMMAND COMPLETED` (#304) |
| C6 | old + attempt terminal, System op missing | attempt status | **NO** — attempt state is not completion authority |
| C7 | old + interruption restored/terminalized, System op missing | outcome event row | **NO** — outcome events are episode lifecycle, not completion authority |

**Age alone is never a proof**: `occurred_at < horizon` excludes C3/C4/C5/C6/C7 episodes whose
System command never committed — a falsification of the durable-delivery contract. Any
timestamp-horizon discovery bound is therefore outside #545's correctness boundary.

## Can the candidate set be computed in SQL (Option C)?

To exclude C2 in SQL the predicate must be equivalent to the full
`isMatchingCommittedOperation`. The candidate forms fail:

1. **Anti-join on `payload->>'interruptionId'` (+ commandType).** Matches C2 but also matches a
   row that committed under the same interruptionId with a mismatching payload or a
   non-derived operationId — exactly the C4 shape if produced by any non-engine write. It
   promotes a payload field to completion proof — a weaker surrogate of the arbiter check
   (forbidden class).
2. **JSONB containment of the whole canonical payload.** Requires re-deriving the description
   string (`toISOString` formatting) and the UUID-v5 operationId inside SQL. That is a second
   implementation of the frozen operationId/payload derivation, in a second language — a
   dual-source-of-truth on the authority identity itself.
3. **`uuid-ossp.uuid_generate_v5(namespace, episode_id)`** — provably byte-equal to the TS
   derivation (RFC 4122 v5, SHA-1, same namespace bytes), but still needs (2)'s payload
   equality for full equivalence, adds an extension dependency, and duplicates the frozen
   derivation outside `packages/exam-engine`.

Conclusion: **no correctness-preserving SQL-side candidate reduction exists** that does not
either weaken the completion predicate or duplicate the frozen identity derivation. Discovery
must enumerate all committed heartbeat episodes of the org (the candidate set), and completion
must be classified against the arbiter with the full payload predicate (today: in JS).

## What CAN be bounded without touching semantics

- **Transport/protocol bound (Option D-partial, no semantic filter):** chunk the probe IN-list
  into fixed-size batches (full enumeration every cycle — no cursor, no starvation possible,
  stateless per #304). Removes the 65535-parameter bind cliff. DB work unchanged.
- **Index (Option B):** if the discovery plan is a seq scan / bad path at scale, a
  correctness-neutral composite/partial index can serve the existing predicate+ordering.
  Decision: only with EXPLAIN before/after evidence (01-query-plans.md).
- **KEEP_CURRENT (Option A):** legitimate if measured per-tick cost at semester-scale and
  beyond is bounded well under the 30 s tick budget for realistic org counts.

Rejected by evidence/contract: new cursor/progress state (Option E — second-authority risk,
default-rejected and unnecessary given D-partial), queue/Redis/scheduler (#554 territory),
time horizons (violates C3–C7), attempt-status or incident-existence filters (violates #304).
