# #545 Baseline — code reality audit (current master)

BASE_SHA / MASTER_SHA: `1da9d12816e1335e4cff1063897fad0f74bc1539` (re-verified; origin/master equal)
BRANCH: `hardening/545-long-lived-incident-reconciliation-1`
WORKTREE: `/home/hoo/Source/exam`
NODE: v24.15.0 · PNPM: 11.1.2 · PostgreSQL (experiment): 18.6 (repo test pin: `postgres:18.4-bookworm`, same major)

## Read path (Stage A)

```text
heartbeat plugin interval (HEARTBEAT_SCAN_INTERVAL_MS, default 30_000 ms; activeScan guard → no tick overlap)
  ↓ scanDatabaseForDisruptedAttempts        (list orgs → listInProgress per org → markDisrupted)
  ↓ reconcileSystemIncidentsAcrossOrgs      (same tick, after the scan)
      ↓ organizationRepo.list               (1 query, all orgs)
      ↓ per org: reconcileSystemIncidents   (apps/api/src/orchestrators/systemIncidentDelivery.ts)
          ↓ listHeartbeatDetectedEpisodes   (discovery, ALL history)
          ↓ systemIncidentOperationId()     (N × UUID-v5/SHA-1 in JS)
          ↓ listCommittedOperations         (batch probe, org + operation_id IN (…N))
          ↓ for each episode: isMatchingCommittedOperation → skip | deliver (pending only)
```

## Q0 discovery query — `listHeartbeatDetectedEpisodes`
(`packages/db/src/repository/attemptInterruptionEventRepo.ts:187`)

```sql
SELECT e.interruption_id, i.attempt_id, a.exam_id, a.candidate_id,
       e.occurred_at, e.observed_last_activity_at, e.timeout_seconds
FROM attempt_interruption_events e
JOIN attempt_interruptions i ON i.id = e.interruption_id AND i.organization_id = e.organization_id
JOIN exam_attempts a         ON a.id = i.attempt_id        AND a.organization_id = i.organization_id
WHERE e.organization_id = $1
  AND e.event_type = 'detected'
  AND e.detection_source = 'heartbeat_timeout'
ORDER BY e.occurred_at ASC, e.interruption_id ASC;
```

- **No LIMIT, no time horizon, no attempt-status scope, no completion scope.** A1 answer: it scans
  **all committed heartbeat-detected episodes of the org, all history** (heartbeat-detected only,
  org-scoped; `migration_backfill` detections are excluded by the `detection_source` predicate).
- Result: N rows fully materialized as JS objects (7 columns each, incl. description-free facts).

## Q0 probe query — `listCommittedOperations`
(`packages/db/src/repository/incidentRepo.ts:316`)

```sql
SELECT operation_id, command_type, payload
FROM exam_incident_events
WHERE organization_id = $1 AND operation_id IN ($2 … $N+1);
```

- Served by `exam_incident_events_org_operation_unique (organization_id, operation_id)` —
  the #304 arbiter unique. Plan verification: see 01-query-plans.md.
- Returns every hit WITH its full canonical payload (jsonb) — completion classification
  (`isMatchingCommittedOperation`: same commandType AND deep-equal payload) happens in JS.

## Indexes present at BASE (schema/pg.ts)

| Table | Index | Covers |
| --- | --- | --- |
| `attempt_interruption_events` | `…_detected_unique` UNIQUE `(interruption_id)` WHERE `event_type='detected'` (partial, no org column) | uniqueness only |
| `attempt_interruption_events` | `…_outcome_unique` UNIQUE `(interruption_id)` WHERE outcome events | uniqueness only |
| `attempt_interruption_events` | `…_org_attempt_created_idx` `(organization_id, attempt_id, created_at)` | org prefix only |
| `exam_incident_events` | `…_org_operation_unique` UNIQUE `(organization_id, operation_id)` | the probe ✓ |
| `exam_incident_events` | `…_incident_sequence_idx` `(incident_id, event_sequence)` | per-incident listing |
| `attempt_interruptions` | PK `(id)` + `…_org_attempt_id_unique` `(org, attempt_id, id)` | join ✓ |
| `exam_attempts` | PK `(id)` | join ✓ |

A2 answer: **no index directly supports** `(organization_id, event_type='detected',
detection_source='heartbeat_timeout') ORDER BY occurred_at` — only the org prefix of
`…_org_attempt_created_idx` applies. A3 answer: the probe is fully index-backed by the arbiter
unique (plan to be confirmed with EXPLAIN). A4 answer: yes — N episodes ⇒ N UUID-v5 SHA-1
derivations, an N-element IN list (N+1 bind parameters), N episode JS objects + M committed-op JS
objects each carrying a full jsonb payload.

## Application-side cost chain (per org per tick, steady state)

```text
DISCOVERY_CARDINALITY     = N (total historical heartbeat episodes of the org)
ARBITER_PROBE_CARDINALITY = N (every episode is probed, completed or not)
JS_MATERIALIZATION        = N episodes + M committed ops (M ≈ N after convergence)
FREQUENCY                 = once per org per 30 s tick (after the disruption scan)
MULTI-ORG                 = Σ over orgs, executed sequentially in one tick
```

## Driver / transport facts

- Driver: `postgres` (postgres.js) via Drizzle `inArray` → per-element bind parameters.
- PostgreSQL extended-protocol bind limit: **65535 parameters** ⇒ `inArray` with >65534
  elements fails the bind, the probe throws, `reconcileSystemIncidentsAcrossOrgs` catches at
  discovery level and **skips the whole org for the cycle** (logged error). History only grows,
  so past that episode count per org the reconciliation leg would fail every tick — a hard
  correctness cliff at extreme scale, distinct from the gradual cost growth.
  (Verified empirically: see 01-query-plans.md Q2-cliff.)

## Loop / pool interaction (§14)

- One tick = `orgs` × (1 discovery + 1 probe + per-pending delivery transactions), sequential
  per org; connections are checked out per query (no long-held transaction around the scan);
  delivery runs one short transaction per pending episode (`executeInTransaction`, RR).
- Tick overlap is prevented by the `activeScan` guard (`heartbeat.ts:296`), so a slow
  reconciliation delays the next scan rather than stacking.
- Migrations touching the audited tables: `0021_noisy_archangel` (interruption events),
  `0022_engine_policy_seam`, `0023_exam_incidents` (incident events + arbiter unique),
  `0027_converge_skipped_migrations`.

## Baseline doc comment (as-built disposition at BASE)

`listHeartbeatDetectedEpisodes` explicitly documents the O(history) read as the accepted
LAN-scale cost of stateless reconciliation, and defers bounded discovery to "its own explicit
authority decision" — exactly what #545 measures (this document + 02/03).
