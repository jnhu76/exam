# Implementation Plan: J5 Recovery Center — Backend Closeout + Read Model + UI

## Overview

After PR #253 merge, the Recovery system has two working read-model endpoints (queue + incident aggregate) but lacks:
1. A formal closeout of the J5-I1A1/A2 sub-slices (parent J5-I1A stays IN PROGRESS until A3 is done)
2. A formal contract amendment to J5-R0 for the new A3 slice
3. An Attempt Operations Context read projection (the "full per-Attempt ledger" that the incident aggregate explicitly delegates)
4. Any frontend UI for the Recovery Center

This plan covers four sequential phases: closeout + contract amendment, the missing backend read model, a strict A2 field audit before UI, and a four-slice read-only UI.

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| J5-I1A3 as a distinct backend slice, not hidden inside I1B | The Attempt Operations Context is a backend API contract. Mixing it into "UI-only" I1B violates the backend-first principle and makes the API contract invisible to review. |
| Single REPEATABLE READ snapshot for Attempt Operations | Matches the pattern established by J5-I1A1 (queue) and J5-I1A2 (incident aggregate). Consistent snapshot prevents race conditions between reading attempt state, interruptions, and adjustments. |
| `GET /admin/recovery/attempts/:attemptId` as the endpoint | Attempt-scoped, mirrors the incident aggregate pattern. The existing `GET /admin/attempts/:attemptId/timeline` is audit-log-only and cannot be extended to include interruption episodes and adjustment ledger without breaking its contract. |
| Wire schemas in `packages/contracts`, repo internal types separate | Prevents `packages/db → apps/api` dependency. Route does DTO projection from repo type to wire type. |
| `allowedActions` returns real eligibility, not empty | Empty array is a lie. Compute from `caller capability ∩ Attempt state ∩ resource scope`. I1B pages simply don't render action buttons — cleaner than showing disabled badges. |
| UI split into four PRs (I1B1–I1B4) | Each PR delivers a navigable, testable feature slice. Avoids a giant UI PR that is hard to review and risky to merge. |
| Queue cursor in component state, filters in URL | Opaque keyset cursor is a transient pagination boundary, not stable business state. URL carries filters only. |

## Dependency Graph

```
J5-I1A Closeout (Task 1) ─── keeps I1A IN PROGRESS
    │
    ▼
J5-R0 Amendment (Task 2) ─── formally adds A3 to accepted contract
    │
    ▼
J5-I1A3 Contracts + Repo (Task 3)
    │
    ▼
J5-I1A3 API Route (Task 4)
    │
    ▼
J5-I1A Closeout (Task 4 closeout) ─── I1A3 CLOSED, I1A CLOSED, I1B NEXT
    │
    ├──► J5-I1B1 Queue UI (Task 5/6 combined, consumes existing queue API)
    │
    ├──► A2 Field Audit (Task 7) ─── must precede Incident Detail UI
    │
    ├──► J5-I1B2 Incident Detail UI (Task 8, consumes existing A2 API)
    │
    ├──► J5-I1B3 Attempt Operations UI (Task 9, consumes new A3 API)
    │
    └──► J5-I1B4 Exam Recovery Detail (Task 10, or formally deferred)
              │
              ▼
         J5-I1C0 Force-submit/misconduct operationId (future)
              │
              ▼
         J5-I1C1 Operations UI (future)
```

---

## Phase 1: J5-I1A Closeout + Contract Amendment

### Task 1: J5-I1A1/A2 Closeout Documentation

**Description:** Create a documentation PR that formally closes J5-I1A1 and J5-I1A2, sets J5-I1A3 as NEXT, but keeps J5-I1A itself IN PROGRESS (it closes only after A3 is done).

**Acceptance criteria:**
- [ ] `docs/audits/J5-I1A-RECOVERY-READ-MODELS-CLOSEOUT.md` created
- [ ] Closeout doc records: queue endpoint (PR #252), incident aggregate endpoint (PR #253), authorization amendment, consistent snapshot, action referent validation, and remaining gap (Attempt Operations Context)
- [ ] `docs/roadmap/recovery-operations-jobs.md` updated:
  - J5-I1A1 → CLOSED, PR #252
  - J5-I1A2 → CLOSED, PR #253
  - J5-I1A3 → NEXT
  - J5-I1A → IN PROGRESS (stays open until A3 is done)
- [ ] `docs/roadmap/current.md` updated: J5-I1A2 no longer IN REVIEW
- [ ] No code changes — documentation only

**Verification:**
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] Closeout doc is accurate against master state

**Dependencies:** None (PR #253 already merged)

**Files likely touched:**
- `docs/audits/J5-I1A-RECOVERY-READ-MODELS-CLOSEOUT.md` (new)
- `docs/roadmap/recovery-operations-jobs.md`
- `docs/roadmap/current.md`

**Estimated scope:** XS (3 files, documentation only)

---

### Task 2: Amend J5-R0 for I1A3

**Description:** Formally amend the accepted J5-R0 contract to include the new A3 slice. This prevents the agent from inventing the read model based on implementation convenience. Freezes the endpoint, exact projection fields, authorization, tenant/error mapping, ordering, snapshot semantics, and allowedActions semantics.

**Acceptance criteria:**
- [ ] J5-R0 contract document amended with I1A3 section
- [ ] Frozen: `GET /admin/recovery/attempts/:attemptId`
- [ ] Frozen: authorization gate (`incident.recovery.view`, Admin-only)
- [ ] Frozen: tenant/error mapping (missing/cross-org → 404, broken relationship → 503)
- [ ] Frozen: exact projection fields (see Task 3 for field list)
- [ ] Frozen: ordering rules (interruption episodes by `createdAt` asc, events within episode by `eventSequence` asc, adjustments by `createdAt` asc, timeline by `createdAt` asc)
- [ ] Frozen: snapshot semantics (single REPEATABLE READ, `snapshotAt` from `transaction_timestamp()`)
- [ ] Frozen: `allowedActions` semantics (real eligibility from `caller capability ∩ Attempt state ∩ resource scope`, not empty array)
- [ ] Frozen: J5-I1A3 slice definition and dependency on J5-I1A

**Verification:**
- [ ] Contract document is self-consistent
- [ ] No ambiguity in field definitions or ordering

**Dependencies:** Task 1

**Files likely touched:**
- `docs/audits/j5-r0-admin-recovery-center-contract.md` (or wherever J5-R0 is recorded)

**Estimated scope:** S (1-2 files, contract amendment)

---

## Phase 2: J5-I1A3 — Attempt Operations Read Model

### Task 3: A3 contracts + repository method

**Description:** Define the wire schemas in `packages/contracts/src/recovery.ts`, the repository internal type in `packages/db/src/repository/recoveryRepo.ts`, and implement `getAttemptOperationsContext(ctx, attemptId)`. Integration tests written first (TDD).

**Acceptance criteria:**

Wire contract (`packages/contracts/src/recovery.ts`):
- [ ] `AttemptOperationsContextSchema` Zod schema defined
- [ ] `AttemptOperationsContext` TypeScript type inferred and exported
- [ ] No dependency on `apps/api` — schemas live in contracts package

Attempt field set (frozen in J5-R0 amendment):
```ts
attempt: {
  id;
  examId;
  candidateId;
  attemptNo;
  status;
  startedAt;
  deadlineAt;           // raw Attempt deadline
  effectiveDeadlineAt;  // min(exam.closeAt, deadlineAt)
  submittedAt;
  gradedAt;
  lastActivityAt;
  misconduct;
}
```

- [ ] `examSummary`: `{ id, title, status, closeAt }`
- [ ] `candidateSummary`: `{ id, displayName }` — resolved from CandidateProfile, fallback to User
- [ ] `interruptionEpisodes`: array of `{ interruption: AttemptInterruption, events: AttemptInterruptionEvent[] }`, sorted by `interruption.createdAt` asc, events within each episode sorted by `eventSequence` asc
- [ ] `timeAdjustments`: full per-attempt ledger (`AttemptTimeAdjustment[]`), sorted by `createdAt` asc. Includes `id`, `operationId`, `attemptId`, `interruptionId`, `incidentId`, `policy`, `source`, `beforeDeadline`, `afterDeadline`, `addedSeconds`, `eligibleSeconds`, `reasonCode`, `reasonText`, `actorId`, `createdAt`
- [ ] `timeline`: audit log entries sorted by `createdAt` asc (same shape as existing timeline endpoint)
- [ ] `relatedIncidents`: minimal navigation stubs `{ id, status, severity, title }[]`, deduplicated, from both attempt memberships and action links
- [ ] `allowedActions`: real eligibility array computed from `caller capability ∩ Attempt state ∩ resource scope` (may include `time_grant`, `force_submit`, `misconduct_mark` when I1C0 adds them; initially based on status-derived candidates + caller permissions)
- [ ] `snapshotAt`: PostgreSQL `transaction_timestamp()`

Repository method:
- [ ] `getAttemptOperationsContext(ctx, attemptId)` added to `createRecoveryRepo`
- [ ] Single REPEATABLE READ read-only transaction
- [ ] Batch-reads all related data (no N+1)
- [ ] Validates attempt exists and belongs to caller's organization → 404 on missing/cross-org
- [ ] Validates parent relationships (exam, enrollment, candidate exist) → 503 on broken chain
- [ ] CandidateProfile → User resolution: if same-org CandidateProfile is missing or User is deleted, surface as 503 (fail-closed, not partial projection)
- [ ] Computes `effectiveDeadlineAt` using canonical `computeEffectiveDeadline(exam, attempt)`
- [ ] Fail-closed: any broken parent or relationship → 503, never partial projection

Integration tests:
- [ ] Happy path: attempt with episodes, adjustments, timeline entries, related incidents
- [ ] Attempt with no interruptions or adjustments (empty arrays)
- [ ] Missing attempt → 404
- [ ] Cross-org attempt → 404
- [ ] Broken exam relationship → 503
- [ ] Broken candidate profile → 503
- [ ] Multiple interruption episodes with nested events ordered correctly
- [ ] Multiple time adjustments ordered correctly
- [ ] Related incidents deduplicated correctly

**Verification:**
- [ ] `pnpm test` passes (integration tests)
- [ ] `pnpm typecheck` passes

**Dependencies:** Task 2 (contract must be frozen first)

**Files likely touched:**
- `packages/contracts/src/recovery.ts` (new or extended)
- `packages/db/src/repository/recoveryRepo.ts` (add method + internal type)
- `packages/db/src/repository/recoveryRepo.test.ts` (add integration tests)

**Estimated scope:** L (5-8 files)

---

### Task 4: A3 API route + route registry

**Description:** Wire the repository method into a new Fastify route handler. Use the authoritative `AttemptIdParamsSchema` for params parsing — do not define `z.string().uuid()` inline.

**Acceptance criteria:**
- [ ] Route `GET /admin/recovery/attempts/:attemptId` added to `apps/api/src/routes/incidents.admin.ts`
- [ ] Authorization: `Permission.IncidentRecoveryView` (Admin-only, same as other recovery endpoints)
- [ ] Params parsed with authoritative `AttemptIdParamsSchema` — no inline `z.string().uuid()`
- [ ] Calls `recoveryRepo.getAttemptOperationsContext(ctx, attemptId)`
- [ ] DTO projection from repo internal type to wire `AttemptOperationsContextSchema`
- [ ] Returns 404 for missing/cross-org, 503 for broken relationships
- [ ] Response validated against `AttemptOperationsContextSchema`
- [ ] Route registered in OpenAPI/Swagger
- [ ] Route capability entry updated if needed

**Verification:**
- [ ] API integration tests pass
- [ ] Test cases: happy path, 404, 403 (non-admin), 503 (broken relationship)
- [ ] `pnpm verify` passes

**Dependencies:** Task 3 (repo method must exist)

**Files likely touched:**
- `apps/api/src/routes/incidents.admin.ts` (add route handler)
- `apps/api/src/routes/recovery.admin.test.ts` (add route tests)

**Estimated scope:** M (3-5 files)

---

### Task 4 closeout: J5-I1A final closure

**Description:** After Task 4 is merged, close out J5-I1A entirely and hand off to J5-I1B.

**Acceptance criteria:**
- [ ] `docs/roadmap/recovery-operations-jobs.md` updated:
  - J5-I1A3 → CLOSED
  - J5-I1A → CLOSED
  - J5-I1B → NEXT
- [ ] `docs/roadmap/current.md` updated to reflect I1B as next

**Verification:**
- [ ] Roadmap is self-consistent (no IN PROGRESS parent with all children CLOSED)

**Dependencies:** Task 4 merged

**Files likely touched:**
- `docs/roadmap/recovery-operations-jobs.md`
- `docs/roadmap/current.md`

**Estimated scope:** XS (2 files, docs only)

---

### Checkpoint: After Task 4 closeout
- [ ] All tests pass: `pnpm test`
- [ ] `pnpm verify` passes
- [ ] Three recovery read-model endpoints complete: queue, incident aggregate, attempt operations
- [ ] J5-I1A fully CLOSED, J5-I1B NEXT
- [ ] Ready for UI work

---

## Phase 3: A2 Field Audit

### Task 7: Strict A2 wire field mapping

**Description:** Before building any Incident Detail UI, audit the exact fields returned by `GET /admin/recovery/incidents/:incidentId` against what the UI needs to display. Any gap must be resolved as an additive A2 projection PR — not by opportunistically expanding the endpoint inside a UI task.

**Acceptance criteria:**
- [ ] Mapping table produced covering every UI field in Task 8 against the A2 wire contract
- [ ] Fields confirmed present in A2 wire: candidate identifier, attempt score, action actor, action operationId, adjustment policy/source/before/after deadline/actor
- [ ] If any field is missing: create an additive A2 projection PR (Task 7a) before Task 8
- [ ] Principle enforced: UI does not self-derive, UI does not multi-fetch for one section, UI does not assume repo fields equal wire fields

**Verification:**
- [ ] Mapping table is complete and reviewed
- [ ] Any additive A2 PR passes `pnpm verify`

**Dependencies:** Task 1 (A2 endpoint must be on master)

**Files likely touched:**
- `docs/audits/J5-I1B2-A2-FIELD-MAPPING.md` (new, or inline in plan)
- Possibly `apps/api/src/routes/incidents.admin.ts` and `packages/db/src/repository/recoveryRepo.ts` if additive A2 PR is needed

**Estimated scope:** S-M (1-5 files depending on gaps)

---

## Phase 4: J5-I1B — Read-only Admin Recovery Center UI

### Task 5/6 combined: J5-I1B1 — Recovery Queue infrastructure + Queue page

**Description:** Implement the Recovery Queue page at `/admin/recovery` in a single PR. This includes all frontend infrastructure (routes, sidebar, capabilities, i18n) AND the functional queue page. No empty shell PR.

**Acceptance criteria:**

Infrastructure:
- [ ] Route constants added to `apps/web/src/lib/routes.ts`: `recovery`, `recoveryIncident`, `recoveryAttempt`
- [ ] Routes registered in `apps/web/src/App.tsx` under `/admin` with `AdminLayout`
- [ ] Page titles added to `apps/web/src/lib/pageMeta.ts`
- [ ] Route capability entries added to `apps/web/src/lib/adminRouteCapabilities.ts` with `Permission.IncidentRecoveryView`
- [ ] Sidebar navigation entry added to `apps/web/src/components/layout/AppSidebar.tsx` (new "Recovery" group, Admin-only, with `visible` gate)
- [ ] Container role regex in `AdminLayout.tsx` updated if needed
- [ ] Status meta entries added to `apps/web/src/lib/statusMeta.ts` for any missing incident statuses
- [ ] i18n translation keys added for all three pages (not just queue)

Queue page:
- [ ] `RecoveryQueuePage.tsx` created in `apps/web/src/pages/admin/`
- [ ] Consumes `GET /api/admin/recovery/incidents` with query params for filters
- [ ] Server-side filtering by: status, severity, exam, candidate, date range
- [ ] **Filters in URL query state; cursor in component state** (not URL)
- [ ] Keyset cursor pagination ("load more" pattern)
- [ ] Table columns: incident status (StatusBadge), severity, exam title, candidate name, attempt status, linked counts, active proctors, created time
- [ ] Clicking a row navigates to `/admin/recovery/incidents/:id`
- [ ] Loading state: skeleton/shimmer
- [ ] Empty state: clear message when no incidents match filters
- [ ] Error state: 400, 403, 503
- [ ] Permission-denied state: distinct message when user lacks `IncidentRecoveryView`
- [ ] **Polling semantics:**
  - Visible tab: 30-second polling interval
  - Hidden tab: pause polling
  - Re-visible/focus: immediate refresh
  - Single-flight: no overlapping requests (abort previous)
  - On poll: re-fetch from page 1, reset accumulated pages (do not merge new page 1 into old cursor chain)
- [ ] Responsive: table on desktop, card list on mobile
- [ ] All strings via i18n `t()` calls
- [ ] Page test file with component tests

**Verification:**
- [ ] `pnpm lint:eslint` passes
- [ ] `pnpm test` passes
- [ ] Manual: queue loads with demo data, filters work, pagination works, polling refreshes, row click navigates

**Dependencies:** Task 1 (queue API already exists)

**Files likely touched:**
- `apps/web/src/lib/routes.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/pageMeta.ts`
- `apps/web/src/lib/adminRouteCapabilities.ts`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/lib/statusMeta.ts`
- `apps/web/src/pages/admin/RecoveryQueuePage.tsx` (new)
- `apps/web/src/pages/admin/RecoveryQueuePage.test.tsx` (new)
- i18n translation files

**Estimated scope:** L (8+ files, but single cohesive PR)

---

### Task 8: J5-I1B2 — Recovery Incident Detail page

**Description:** Implement the Recovery Incident Detail page at `/admin/recovery/incidents/:incidentId`. Only fields confirmed present in A2 wire contract (Task 7 mapping) are displayed.

**Acceptance criteria:**
- [ ] `RecoveryIncidentDetailPage.tsx` created in `apps/web/src/pages/admin/`
- [ ] Consumes `GET /api/admin/recovery/incidents/:incidentId`
- [ ] **Only displays fields confirmed in A2 wire contract** (Task 7 mapping must be complete first)
- [ ] Sections displayed:
  - Incident header: status (StatusBadge), severity, type, created time
  - Exam summary: title, status, closeAt
  - Candidate summary: name (from A2 `candidateSummaries`)
  - Attempt summaries: status, effectiveDeadlineAt, score (from A2 `attemptSummaries`)
  - Events/notes: chronological list with actor, timestamp, content
  - Action links: actionType, actor, operationId, linked attempt (from A2 `actions`)
  - Attempt memberships: relationshipType, attempt status
  - Interruption links: attempt, interruption, events
  - Time adjustment summaries (incident-scoped only): policy, source, before/after deadline, added seconds
  - Audit references: action, actor, timestamp
  - **No action buttons or disabled badges** — read-only phase, action area simply not rendered
- [ ] Snapshot indicator: shows `snapshotAt` timestamp, stale warning if older than threshold
- [ ] Loading / empty / error / permission-denied states
- [ ] Navigation links to Attempt Operations Context (Task 9)
- [ ] Responsive layout: stacked sections on mobile, grid on desktop
- [ ] All strings via i18n
- [ ] Page test file

**Verification:**
- [ ] `pnpm lint:eslint` passes
- [ ] `pnpm test` passes
- [ ] Manual: incident detail loads, all sections render correctly, no action buttons rendered

**Dependencies:** Task 5/6 (infrastructure), Task 7 (field mapping must be complete)

**Files likely touched:**
- `apps/web/src/pages/admin/RecoveryIncidentDetailPage.tsx` (new)
- `apps/web/src/pages/admin/RecoveryIncidentDetailPage.test.tsx` (new)
- i18n translation files

**Estimated scope:** L (5-8 files)

---

### Task 9: J5-I1B3 — Attempt Operations Context page

**Description:** Implement the Attempt Operations Context page at `/admin/recovery/attempts/:attemptId`. This is the richest read-only projection, consuming the new A3 endpoint.

**Acceptance criteria:**
- [ ] `RecoveryAttemptDetailPage.tsx` created in `apps/web/src/pages/admin/`
- [ ] Consumes `GET /api/admin/recovery/attempts/:attemptId` (the new A3 endpoint from Task 4)
- [ ] Sections displayed:
  - Attempt header: status (StatusBadge), exam, candidate, attempt number, started/submitted/graded times
  - Effective deadline: computed effectiveDeadlineAt, with visual indicator if different from original deadlineAt
  - Misconduct flag: prominent display if set
  - Interruption episodes: chronological list, each with nested events (detected/restored/terminalized), policy, eligible/added seconds, time adjustment link
  - Time-adjustment ledger: full per-attempt table with policy, source, before/after deadline, added seconds, reason, actor, linked incident (if any)
  - Timeline: audit log entries
  - Related incidents: navigation stubs linking to incident detail pages
  - **No action buttons or disabled badges** — action area not rendered
- [ ] Clear visual distinction between this full per-attempt ledger and the incident aggregate's incident-scoped `timeAdjustmentSummaries`
- [ ] Loading / empty / error / permission-denied states
- [ ] Snapshot indicator
- [ ] Cross-navigation: links to incident detail, exam detail
- [ ] Responsive layout
- [ ] All strings via i18n
- [ ] Page test file

**Verification:**
- [ ] `pnpm lint:eslint` passes
- [ ] `pnpm test` passes
- [ ] Manual: attempt detail loads, interruption episodes display correctly, time-adjustment ledger shows full history

**Dependencies:** Task 4 (A3 API endpoint), Task 5/6 (infrastructure)

**Files likely touched:**
- `apps/web/src/pages/admin/RecoveryAttemptDetailPage.tsx` (new)
- `apps/web/src/pages/admin/RecoveryAttemptDetailPage.test.tsx` (new)
- i18n translation files

**Estimated scope:** L (5-8 files)

---

### Task 10: J5-I1B4 — Exam Recovery Detail page

**Description:** Implement the Exam Recovery Detail page at `/admin/recovery/exams/:examId`. This is the last slice of I1B. First evaluate whether existing APIs (Exam read + Recovery Queue examId filter + Proctor assignment list) are sufficient, or if a new aggregate endpoint is needed.

**Acceptance criteria:**
- [ ] Decision made: compose from existing APIs vs. new aggregate endpoint
  - If compose: document the multi-fetch approach and confirm no snapshot consistency requirement
  - If new aggregate: define `GET /admin/recovery/exams/:examId` contract, implement repo + route
- [ ] `RecoveryExamDetailPage.tsx` created in `apps/web/src/pages/admin/`
- [ ] Sections displayed:
  - Exam summary: title, status, closeAt, timing mode
  - Incident counts by status/severity
  - Recent incidents list (linked to incident detail)
  - Active proctors (if available from existing APIs)
  - Attempt status distribution (if available)
- [ ] Loading / empty / error / permission-denied states
- [ ] Navigation links to queue (filtered by exam), incident detail
- [ ] Responsive layout
- [ ] All strings via i18n
- [ ] Page test file

**Verification:**
- [ ] `pnpm lint:eslint` passes
- [ ] `pnpm test` passes
- [ ] Manual: exam recovery detail loads with correct data

**Dependencies:** Task 5/6 (infrastructure), Task 7 (field audit may reveal gaps)

**Files likely touched:**
- `apps/web/src/pages/admin/RecoveryExamDetailPage.tsx` (new)
- `apps/web/src/pages/admin/RecoveryExamDetailPage.test.tsx` (new)
- Possibly `apps/api/src/routes/incidents.admin.ts` and `packages/db/src/repository/recoveryRepo.ts` if new aggregate needed
- i18n translation files

**Estimated scope:** M-L (3-8 files depending on aggregate decision)

---

### Checkpoint: After Task 10
- [ ] All tests pass: `pnpm test`
- [ ] `pnpm verify` passes
- [ ] Four Recovery UI pages navigable: Queue → Exam Detail → Incident Detail → Attempt Detail
- [ ] Cross-navigation links work between all pages
- [ ] All states (loading, empty, error, permission-denied) handled
- [ ] Responsive on mobile and desktop
- [ ] J5-I1B ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Attempt Operations Context repo method is complex (multi-table, nested assembly) | High | Follow the established pattern from `getIncidentAggregate`. Write integration tests first (TDD). Break into smaller helper functions. |
| A2 field gaps discovered in Task 7 | Medium | Create additive A2 PR immediately. Do not defer to UI task. Principle: UI never self-derives. |
| UI pages are large (especially Incident Detail and Attempt Detail) | Medium | Extract section components into `components/shared/recovery/` directory. Each section is a small, testable component. |
| i18n keys proliferation across four pages | Low | Define a consistent key namespace (`admin.recovery.*`) upfront. Use a translation key spreadsheet before coding. |
| Exam Recovery Detail may need a new aggregate | Low | Evaluate composition first. Only add aggregate if snapshot consistency is required. |
| Queue polling interacts with pagination state | Medium | Clarified: poll resets to page 1, does not merge into cursor chain. Documented in Task 5/6. |

## Open Questions

1. **Exam Recovery Detail composition vs. aggregate**: Task 10 will evaluate. If existing APIs are sufficient (exam read + queue filter + assignment list), no new endpoint needed. If snapshot consistency is required, add aggregate.
2. **`allowedActions` initial values**: For A3, compute real eligibility. Initially may return empty array if no commands are eligible for the given attempt state. This is different from "returning empty because UI is read-only" — it means "server computed and found no eligible actions for this state."
