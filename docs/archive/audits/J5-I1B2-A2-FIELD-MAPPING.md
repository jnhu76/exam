# J5-I1B2 — A2 Wire Field Mapping Audit

> Status: **COMPLETE** (gaps found → Task 7a additive A2 PR **delivered** in
> this branch, commit follows the J5-I1A3 commit)
> Date: 2026-08-04
> Audited endpoint: `GET /admin/recovery/incidents/:incidentId` (J5-I1A2, contract §6.3)
> UI task being gated: J5-I1B2 — Recovery Incident Detail page (Task 8)
> Rules enforced (plan §Task 7): UI does not self-derive; UI does not
> multi-fetch for one section; UI never assumes repo fields equal wire fields.

---

## 1. Wire source of truth

The authoritative wire is `RecoveryAggregateResponseSchema` in
`apps/api/src/routes/incidents.admin.ts` (the only place a response is built),
mirroring the J5-R0 contract §6.3 projection list. Field names below are the
exact JSON keys returned by the endpoint.

Wire surfaces:

| Surface | Wire fields |
|---------|-------------|
| `incident` | `id, examId, attemptId, candidateId, type, severity, status, occurredAt, description, resolutionSummary, resolvedAt, resolvedBy, reportedBy, version, createdAt, updatedAt` |
| `examSummary` | `id, title, status, closeAt` |
| `events[]` | `id, eventSequence, eventType, commandType, operationId, actorId, beforeVersion, afterVersion, payload, createdAt` |
| `notes[]` | `operationId, actorId, body, createdAt` |
| `actions[]` | `id, actionType, actionId, attemptId, actorId, operationId, linkedAt` |
| `attemptMemberships[]` | `id, attemptId, relationshipType, linkedAt, linkedBy, operationId` |
| `interruptionLinks[]` | `id, attemptId, interruptionId, linkedAt, linkedBy, operationId` |
| `candidateSummaries[]` | `id, displayName` |
| `attemptSummaries[]` | `id, candidateId, status, effectiveDeadlineAt` |
| `timeAdjustmentSummaries[]` | `id, attemptId, addedSeconds, reasonCode, operationId, createdAt` |
| `auditReferences[]` | `id, action, actorId, actorName, createdAt` |
| `allowedActions[]` | `investigate \| add_note \| change_severity \| resolve \| dismiss \| link_action \| link_attempt \| link_interruption` |
| `snapshotAt` | ISO timestamp |

---

## 2. Mapping table (every Task-8 UI field → wire)

| # | UI section (Task 8) | UI field | Wire path | Present? | Resolution |
|---|---------------------|----------|-----------|----------|------------|
| 1 | Incident header | status | `incident.status` | ✅ | `StatusBadge` via `statusMeta` |
| 2 | Incident header | severity | `incident.severity` | ✅ | — |
| 3 | Incident header | type | `incident.type` | ✅ | — |
| 4 | Incident header | created time | `incident.createdAt` | ✅ | — |
| 5 | Exam summary | title | `examSummary.title` | ✅ | — |
| 6 | Exam summary | status | `examSummary.status` | ✅ | — |
| 7 | Exam summary | closeAt | `examSummary.closeAt` | ✅ | display only |
| 8 | Candidate summary | name | `candidateSummaries[].displayName` | ✅ | resolved by repo (same-org user) |
| 9 | Candidate summary | identifier | `candidateSummaries[].id` | ✅ | navigation id |
| 10 | Attempt summaries | status | `attemptSummaries[].status` | ✅ | — |
| 11 | Attempt summaries | effectiveDeadlineAt | `attemptSummaries[].effectiveDeadlineAt` | ✅ | server-derived (§6.2) |
| 12 | Attempt summaries | **score** | `attemptSummaries[].score` | ❌ **GAP-1** | additive A2 projection (Task 7a); `examAttempts.score` exists, null until graded |
| 13 | Events/notes | actor | `events[].actorId` / `notes[].actorId` | ✅ (raw id) | display raw id — no name resolution in this surface (see NOTE-1) |
| 14 | Events/notes | timestamp | `events[].createdAt` / `notes[].createdAt` | ✅ | — |
| 15 | Events/notes | content | `events[].payload` (command payload) / `notes[].body` | ✅ | payload is `unknown` — render as structured rows, never raw JSON blob |
| 16 | Action links | actionType | `actions[].actionType` | ✅ | — |
| 17 | Action links | actor | `actions[].actorId` | ✅ | raw id (see NOTE-1) |
| 18 | Action links | operationId | `actions[].operationId` | ✅ | — |
| 19 | Action links | linked attempt | `actions[].attemptId` (+ `actionId` for force_submit) | ✅ | navigation to attempt ops page (Task 9) |
| 20 | Attempt memberships | relationshipType | `attemptMemberships[].relationshipType` | ✅ | — |
| 21 | Attempt memberships | attempt status | `attemptSummaries[].status` (membership attempts are summarized) | ✅ | join by attemptId |
| 22 | Interruption links | attempt | `interruptionLinks[].attemptId` | ✅ | navigation stub |
| 23 | Interruption links | interruption | `interruptionLinks[].interruptionId` | ✅ | navigation stub |
| 24 | Interruption links | **events** | *(no wire path — events are not projected)* | ❌ **DECISION-1** | not additive: links stay stubs; full episodes live on Attempt Operations page (Task 9, A3 endpoint) — cross-link, not multi-fetch within the section |
| 25 | Time adjustment summaries | policy | `timeAdjustmentSummaries[].policy` | ❌ **GAP-2** | additive A2 projection (Task 7a); column exists |
| 26 | Time adjustment summaries | source | `timeAdjustmentSummaries[].source` | ❌ **GAP-2** | additive A2 projection (Task 7a); column exists |
| 27 | Time adjustment summaries | beforeDeadline | `timeAdjustmentSummaries[].beforeDeadline` | ❌ **GAP-2** | additive A2 projection (Task 7a); column exists |
| 28 | Time adjustment summaries | afterDeadline | `timeAdjustmentSummaries[].afterDeadline` | ❌ **GAP-2** | additive A2 projection (Task 7a); column exists |
| 29 | Time adjustment summaries | actor | `timeAdjustmentSummaries[].actorId` | ❌ **GAP-2** | additive A2 projection (Task 7a); column exists |
| 30 | Time adjustment summaries | added seconds | `timeAdjustmentSummaries[].addedSeconds` | ✅ | — |
| 31 | Audit references | action | `auditReferences[].action` | ✅ | — |
| 32 | Audit references | actor | `auditReferences[].actorName` (fallback `actorId`) | ✅ | name resolved by repo |
| 33 | Audit references | timestamp | `auditReferences[].createdAt` | ✅ | — |
| 34 | Snapshot indicator | snapshotAt | `snapshotAt` | ✅ | stale threshold = client-side display concern only |
| 35 | Allowed actions | action area | `allowedActions[]` | ✅ | **not rendered** in read-only phase — empty `allowedActions` is a computed result, never a disabled-badge state (contract §6.4 note; plan Task 8: "no action buttons or disabled badges") |

---

## 3. Gap register

### GAP-1 — `attemptSummaries[].score` (BLOCKING Task 8)

Task 8's "Attempt summaries: status, effectiveDeadlineAt, score" requires the
attempt's final score. The A2 wire carries no score. `examAttempts.score`
(`total_score`, `doublePrecision`, **nullable** — null until graded) is the
authoritative column; the existing `GET /admin/attempts/:attemptId` wire
already exposes it (omitted when null).

**Resolution (Task 7a):** add `score: z.number().nullable()` to the wire
`attemptSummaries[].score`; repo selects `examAttempts.score`; route projects
it (null for ungraded). Mirrors the existing attempt-detail wire semantics.

### GAP-2 — `timeAdjustmentSummaries[].policy/source/beforeDeadline/afterDeadline/actorId` (BLOCKING Task 8)

Task 8's "Time adjustment summaries: policy, source, before/after deadline,
added seconds" plus the plan's confirmed-list "adjustment
policy/source/before/after deadline/actor" require five fields the wire does
not carry. All five columns exist on `attempt_time_adjustments` (policy
`InterruptionTimePolicy`, source enum, both deadlines, `actorId`).

**Resolution (Task 7a):** add the five fields to the wire
`timeAdjustmentSummaries[]`; repo selects them in the existing
action-identity-driven adjustment read (the projection stays incident-scoped —
the §6.1 boundary is unchanged); route projects them.

### DECISION-1 — `interruptionLinks[].events` (NOT additive; navigation)

Task 8 lists "Interruption links: attempt, interruption, events". The §6.3
wire freezes interruption links as stubs; events are deliberately the
Attempt Operations surface (§6.4). Adding events would duplicate the A3
projection inside the incident aggregate (N+1 per link) and blur the §6.3/§6.4
boundary.

**Decision:** the Incident Detail page renders interruption links as stubs
(interruptionId + attemptId + linkedAt + linkedBy) and cross-links to the
Attempt Operations page (Task 9) for the full episode/event view. This is
navigation, not multi-fetch within a section — compliant with the Task 7
principle.

### NOTE-1 — events/notes/actions carry raw `actorId`, no display name

`events[].actorId`, `notes[].actorId`, `actions[].actorId` are raw actor ids;
only `auditReferences[].actorName` is resolved. The incident header's
`reportedBy`/`resolvedBy` are also raw ids. The UI displays these as raw ids
in the read-only phase (a display-name resolution is a possible future
additive; it is NOT in the plan's confirmed-list and does not block Task 8).

---

## 4. Task 7a — additive A2 projection PR (delivered)

Per plan Task 7: gaps found → additive A2 PR **before** Task 8, never
opportunistically inside the UI task. DELIVERED in this branch (Task 7a):

| File | Change |
|------|--------|
| `packages/db/src/repository/recoveryRepo.ts` | attempt select now carries `score`; `IncidentAggregateAttemptSummary` gains `score: number \| null`; adjustment select carries `policy, source, beforeDeadline, afterDeadline, eligibleSeconds, reasonText, actorId`; `IncidentAggregateTimeAdjustmentSummary` gains the seven fields |
| `apps/api/src/routes/incidents.admin.ts` | `RecoveryAggregateAttemptSummarySchema` gains `score: z.number().nullable()`; `RecoveryAggregateTimeAdjustmentSchema` gains the seven fields; A2 handler projects them |
| `apps/api/src/routes/recovery.admin.test.ts` | aggregate happy-path asserts `score: null` for ungraded attempts; effective-deadline test seeds a graded attempt (`score: 91`) and asserts projection |
| `packages/db/src/repository/recoveryRepo.test.ts` | aggregate happy-path seeds a graded attempt (`score: 88.5`) and asserts projection; adjustment assertions cover policy/source/deadlines/actor |
| `apps/api/openapi.json` | regenerated |
| `docs/roadmap/j5-r0-admin-recovery-center-contract.md` | §6.3 amendment (attempt summary score; adjustment facts) |

Verification: `pnpm test` + `pnpm verify` green (run before commit).

---

## 5. Result

- **Task 8 is BLOCKED until Task 7a lands** (GAP-1, GAP-2).
- After Task 7a, every Task-8 UI field maps to a wire field; the page renders
  only confirmed fields, no action area, snapshot indicator from `snapshotAt`.
