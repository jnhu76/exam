# J5-I1A Recovery Read Models — Closeout

> Status: **CLOSED** (I1A1 + I1A2 + I1A3 all closed)
> Date: 2026-08-04
> Supersedes: J5-R0 §12 decomposition (I1A1 + I1A2 only; I1A3 added by this closeout)

---

## 1. Summary

J5-I1A delivered the three organization-wide Admin read-model endpoints for the
Recovery Center. The third endpoint (Attempt Operations Context) was identified
during I1A2 review, formally amended into the J5-R0 contract (§6.4), and closed
as J5-I1A3.

### Closed sub-slices

| Slice | Endpoint | PR | Status |
|-------|----------|-----|--------|
| J5-I1A1 | `GET /admin/recovery/incidents` (Recovery Incident Queue) | #252 | CLOSED |
| J5-I1A2 | `GET /admin/recovery/incidents/:incidentId` (Recovery Incident Aggregate Detail) | #253 | CLOSED |
| J5-I1A3 | `GET /admin/recovery/attempts/:attemptId` (Attempt Operations Context) | #254 | CLOSED |

**J5-I1A is CLOSED.** J5-I1B (Recovery Center frontend) is NEXT.

---

## 2. What was delivered

### 2.1 J5-I1A1 — Recovery Incident Queue (PR #252)

- **Route:** `GET /admin/recovery/incidents`
- **Authorization:** `incident.recovery.view` (Admin-only, flat gate)
- **Snapshot:** single REPEATABLE READ read-only transaction
- **Pagination:** keyset cursor (`<createdAtISO>|<id>`, opaque, microsecond precision)
- **Filters:** status, severity, examId, candidateId, type, date range, assigned proctor
- **Enrichment:** batch-per-page (no N+1): exams, memberships, attempts, candidates, proctors
- **Fail-closed:** broken parent chain → 503 `AUTHZ_UNAVAILABLE`
- **Integration tests:** `packages/db/src/repository/recoveryRepo.test.ts`

### 2.2 J5-I1A2 — Recovery Incident Aggregate Detail (PR #253)

- **Route:** `GET /admin/recovery/incidents/:incidentId`
- **Authorization:** `incident.recovery.view` (Admin-only, flat gate)
- **Snapshot:** single REPEATABLE READ read-only transaction (`snapshotAt` from `transaction_timestamp()`)
- **Scope:** organization-wide Admin read model (scope Organization, resolver organization)
- **Returns:** incident, events, notes, actions, attempt memberships, interruption links,
  exam/attempt/candidate summaries, time adjustment summaries (incident-scoped only),
  audit references, `allowedActions` (per-caller intersection), `snapshotAt`
- **Fail-closed:** broken relationship → 503; missing/cross-org → 404
- **Integration tests:** `packages/db/src/repository/recoveryRepo.test.ts`, `apps/api/src/routes/recovery.admin.test.ts`

### 2.3 J5-I1A3 — Attempt Operations Context (PR #254)

- **Route:** `GET /admin/recovery/attempts/:attemptId`
- **Authorization:** `incident.recovery.view` (Admin-only, flat gate)
- **Snapshot:** single REPEATABLE READ read-only transaction (`snapshotAt` from `transaction_timestamp()`)
- **Scope:** organization-wide Admin read model (scope Organization, resolver organization)
- **Returns:** attempt (with route-computed `effectiveDeadlineAt`), exam summary,
  candidate summary, interruption episodes (events ordered by `occurredAt` — no
  `event_sequence` column), the FULL per-Attempt time-adjustment ledger,
  attempt audit timeline, related-incident navigation stubs (deduped, most
  recently linked first), `allowedActions` (per-caller intersection of status
  candidates ∩ capabilities), `snapshotAt`
- **Fail-closed:** broken parent/relationship/referent chain → 503; missing/cross-org → 404
- **Integration tests:** `packages/db/src/repository/recoveryRepo.test.ts`, `apps/api/src/routes/recovery.admin.test.ts`

### 2.4 Authorization amendment (J5-I1A2 / PR #253)

The aggregate detail read changed from `scope Exam + incident resolver` to
`scope Organization + organization resolver + repository-owned fail-closed graph
validation`. Reason: ADR-010 §3.9 freezes `broken_parent_chain` as 403, while
this Admin audit/read surface requires corrupted-graph conditions to surface as
503 AUTHZ_UNAVAILABLE. I1A3 inherits the same shape.

### 2.5 timeAdjustmentSummaries vs. the full ledger (I1A2 + I1A3)

`timeAdjustmentSummaries` (I1A2) contains exactly the `attempt_time_adjustments`
rows referenced by THIS Incident's `time_grant` action identities (ADR-014 §7:
`action_id` is the polymorphic referent). It is **NOT** the complete adjustment
ledger of every referenced Attempt — the full per-Attempt ledger belongs to
Attempt Operations Context (I1A3, `timeAdjustments`). The two projections must
never be conflated (contract §6.4 boundary).

---

## 3. What is NOT yet delivered

### 3.1 Exam Recovery Detail (J5-I1B scope)

The J5-R0 contract's §3.1 lists `/admin/exams/:examId/recovery` as an MVP
entry point. This is in the J5-I1B (UI) scope, not I1A. Whether it requires a
new aggregate endpoint or can compose from existing APIs (Exam read + Queue
examId filter + Proctor assignment list) is a J5-I1B design decision (I1B4).

---

## 4. Hand-off to J5-I1B

Next agent task:

```text
J5-I1B — Recovery Center frontend
feat(recovery): Recovery Center UI (queue, incident detail, attempt operations, exam detail)
```

This must:
- J5-I1B1: Recovery Queue page + navigation infrastructure (ONE PR — no empty shell)
- J5-I1B2: Incident Detail page (only A2-confirmed fields; no action buttons in read-only phase)
- J5-I1B3: Attempt Operations page (consumes the A3 endpoint)
- J5-I1B4: Exam Recovery Detail (compose vs. new aggregate decision)

---

## 5. Files touched by I1A1 + I1A2 + I1A3

### New/modified source files

- `apps/api/src/routes/incidents.admin.ts` — queue, aggregate, and attempt-operations routes + Zod schemas
- `packages/db/src/repository/recoveryRepo.ts` — `listIncidentQueue`, `getIncidentAggregate`, `getAttemptOperationsContext`
- `packages/authz/src/catalog.ts` — `incident.recovery.view` permission
- `packages/contracts/src/recovery.ts` — `AttemptOperationsContextSchema` + wire DTOs (I1A3)
- `apps/api/src/authz/routeRegistry.ts` — three Recovery Center registry entries

### Test files

- `packages/db/src/repository/recoveryRepo.test.ts` — integration tests
- `apps/api/src/routes/recovery.admin.test.ts` — route integration tests

### Documentation

- `docs/roadmap/j5-r0-admin-recovery-center-contract.md` — amended (§6.1, §6.3, §6.4)
- This closeout document
