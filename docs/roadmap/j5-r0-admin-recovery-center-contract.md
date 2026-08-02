# J5-R0 — Admin Recovery Center Contract

> Status: **IN REVIEW**
> Type: Documentation-only product/API/read-model contract
> Runtime changes: **none** (no schema, API, route, permission, preset, resolver,
> repository, migration, OpenAPI, or UI change is introduced by this document)
>
> Authority chain: this contract consumes — and is bounded by — the already
> accepted/runtime authorities ADR-013, ADR-014, ADR-015. It does not redefine
> any Incident, Attempt, assignment, or interruption state machine. Where it
> appears to differ from those ADRs, the ADRs win.
>
> Related: [`recovery-operations-jobs.md`](recovery-operations-jobs.md) §7 (J5
> planning sketch — superseded by this contract where they differ),
> [`ADR-014`](../adr/ADR-014-exam-incident-authority.md),
> [`ADR-015`](../adr/ADR-015-proctor-exam-scope-authority.md),
> [`../architecture/exam-system/incident-authority.md`](../architecture/exam-system/incident-authority.md),
> [`../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`](../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md).

---

## 1. Purpose

Freeze the first product boundary of the Admin Recovery Center so that the
later implementation slices (J5-I1A–I1D) no longer invent scope on the fly.

This contract pins down, against the current `master` reality:

- what counts as the Recovery Center in the first version;
- what an Admin can see in that first version;
- which existing APIs/commands can be reused unchanged;
- which read models genuinely do not exist yet and must be added;
- which operator actions may be launched from the UI;
- how `operationId`, retry, reload, and dangerous-action safety must work;
- what is explicitly deferred to later jobs (J7 / P7 / future system-incident
  work).

The framing principle:

```text
J5 is the productization of recovery authority that already exists on master.
J5 is NOT a new recovery domain and does NOT create a second Incident,
Attempt, or assignment state machine.
```

The Recovery Center is a read + operate surface over:

- the ADR-014 Incident aggregate (implemented by J3 — CLOSED, PR #242);
- the ADR-013 interruption episode / time-adjustment ledger (REC-I4-I1/I2/I3B2);
- the canonical Admin operator commands (time grant, force submit, misconduct
  mark);
- the ADR-015 Proctor→Exam assignment authority (implemented by J4-I1 — CLOSED,
  PR #250).

---

## 2. Master reality audit (basis of this contract)

This section records the verified current capability on `master` after the
J4-I1 merge (PR #250, merge commit `62f84407`, 2026-08-02). Every later section
is constrained by what is actually implemented here, not by what the planning
sketch in `recovery-operations-jobs.md` §7 wished for.

### 2.1 Reality table

| Capability | Current API/runtime (master) | Current UI (web) | Reusable for J5? | Gap |
| --- | --- | --- | --- | --- |
| Create Incident (Admin, exam-scoped) | `POST /admin/exams/:examId/incidents` (Admin-only, scoped) | none | yes, unchanged | UI |
| List Incidents by Exam | `GET /admin/exams/:examId/incidents` (`listByExam`, supports `statusFilter`) | none | yes, unchanged | no organization-wide queue; no `severity` / `type` / `candidateId` / `attemptId` / `assignedProctorUserId` / `createdFrom/To` / `unresolvedOnly` / cursor filters |
| Incident detail | `GET /admin/incidents/:incidentId` (returns incident + scope chain) | none | yes, unchanged | partial projection — see §6.5 |
| Incident events / notes / severity / resolve / dismiss | `POST /admin/incidents/:incidentId/{investigate,notes,severity,resolve,dismiss}` (Admin-only terminal judgment) | none | yes, unchanged | UI; reason optionality — see §6.7 |
| Link Incident action / attempt / interruption | `POST /admin/incidents/:incidentId/{actions,attempts,interruptions}` (Admin-only, scope-quadruple-validated) | none | yes, unchanged | UI |
| Attempt timeline | `GET /admin/attempts/:attemptId/timeline` (scoped+enforced) | none (no Recovery Center) | yes, unchanged | UI |
| Attempt force submit | `POST /admin/attempts/:attemptId/force-submit` (`admin_only`) | none | yes, unchanged | UI; reason |
| Attempt misconduct mark | `POST /admin/attempts/:attemptId/misconduct` (`admin_only`) | none | yes, unchanged | UI; reason; confirmation |
| Admin operator time grant (+ optional `incidentId` link) | `POST /admin/attempts/:attemptId/time-grants` (`requireScopedCapability(AttemptTimeGrant)`); atomic audit + action link | none in Recovery Center | yes, unchanged | UI; reload target |
| Proctor→Exam assignment management | `POST /admin/exams/:examId/proctors`, `GET /admin/exams/:examId/proctors` (keyset), `POST /admin/exams/:examId/proctors/:proctorUserId/revoke` (Admin-only) | none | yes, unchanged | UI (Admin assignment surface) |
| Assigned-Proctor filter (queue) | `proctorAssignmentRepo.hasActiveAssignment` / `getProctorExamAssignment` exist; no Incident-list filter joins them | n/a | partially — filter requires an additive read query | additive read API |
| Interruption episode history (per attempt) | `attemptInterruptionRepo.findByAttempt` / `findLatestByAttempt`; events via `attemptInterruptionEventRepo.listByAttempt` | none | yes (repo level) | no Admin aggregate read endpoint; UI |
| Time-adjustment ledger (per attempt) | `attemptTimeAdjustmentRepo.listByAttempt` (repo level) | none | yes (repo level) | no Admin aggregate read endpoint; UI |
| Proctor monitoring (assignment-filtered) | `GET /admin/proctor/exams`, `GET /admin/exams/:examId/proctor/attempts`, `GET /admin/attempts/:attemptId/proctor-events` | `ProctorDashboardPage` / `ProctorWorkspacePage` (Admin-side, existing) | out of J5 MVP scope (Proctor-facing is J6) | n/a |
| Audit timeline (per target) | `auditLogRepo.listByTarget` (repo level) | none in Recovery Center | yes (repo level) | no Admin aggregate read endpoint; UI |

### 2.2 Authority facts frozen by this audit

- The Incident aggregate, its nine canonical commands, the Admin Incident API
  surface, append-only event history, scope-quadruple links, and the
  `grantAttemptTime()` optional `incidentId` path are **implemented** (J3,
  CLOSED, PR #242). The Admin Incident runtime is live.
- The Proctor Incident **backend** authority is **implemented for assigned
  Exams** (J4-I1, CLOSED, PR #250): an assigned Proctor can
  `incident.view` / `incident.create` / `incident.investigate` (which covers
  notes, severity change, and evidence/action links within the granted
  investigate surface) **on the Exam they are actively assigned to**. This is
  a real backend runtime, not a future capability.
- The dangerous terminal authority is **NOT** granted to Proctor:
  `incident.resolve` / `incident.dismiss` (Admin-only terminal judgment),
  `AttemptTimeGrant` (Admin-only), `AttemptForceSubmit` (Admin-only),
  `AttemptMisconductMark` (Admin-only). `AttemptForceSubmit` and
  `AttemptMisconductMark` were **removed** from the Proctor preset and its
  sensitive projection in J4-I1B (ADR-015 §13); they remain valid Admin
  catalog permissions and the routes stay scoped.
- Unassigned Exam/Attempt/Incident access by a Proctor returns an
  anti-enumeration 404 `RESOURCE_NOT_FOUND` (byte-identical to the
  not-found shape); capability denial returns 403 `PERMISSION_DENIED`;
  resolver-infrastructure failure returns 503 `AUTHZ_UNAVAILABLE`.
- There is **no** Proctor-facing Recovery Center product UI (that is J6, NOT
  STARTED). The existing `ProctorDashboardPage` / `ProctorWorkspacePage` are
  Admin-side monitoring pages, not the J6 Proctor Recovery Center.
- There is **no** Admin Recovery Center product UI (this is J5, NOT STARTED).

### 2.3 Boundary the audit deliberately draws

Do **not** confuse these two distinct statements:

```text
"Proctor Incident backend runtime is NOT implemented"        ← FALSE on master
"Proctor Incident product UI is NOT implemented"             ← TRUE (it is J6)
```

Earlier documentation that read "Proctor Incident runtime is NOT implemented"
or "Proctor activation still requires J4" is corrected elsewhere in this same
job (see `implementation-status.md` and `incident-authority.md`).

---

## 3. MVP product surface (frozen)

### 3.1 Product entry points

First-version routes (final path strings follow the existing frontend router
convention in `apps/web/src/lib/routes.ts`; the semantics, not the literal
slug, are what is frozen here):

```text
/admin/recovery                          — Admin Recovery Queue
/admin/exams/:examId/recovery            — Exam Recovery Detail
/admin/incidents/:incidentId             — Incident Detail
/admin/attempts/:attemptId/operations    — Attempt Operations Context
```

The Proctor→Exam assignment management surface is part of the J5 MVP because
the assignment authority is the input the rest of the Recovery Center filters
on; it is exposed in the Admin console (NOT the Proctor console — that is J6).

### 3.2 MVP product areas

1. **Admin Recovery Queue** — organization-wide, server-filtered Incident list.
2. **Exam Recovery Detail** — Exam-scoped recovery view.
3. **Incident Detail** — full authoritative incident projection (events, notes,
   linked actions/attempts/interruptions, allowed actions).
4. **Attempt Operations Context** — Attempt status, effective deadline,
   interruption history, time-adjustment ledger, timeline, allowed Admin
   actions.
5. **Proctor Assignment Management** — Admin assign/revoke/list for an Exam
   (consumes the existing Admin assignment API).

---

## 4. MVP data scope (frozen)

### 4.1 In scope — first version only

The first version of the Recovery Center handles only data the existing
authority already supports:

```text
- open / investigating / resolved / dismissed incidents
- incident severity (info | minor | major | critical)
- incident type (9-value ADR-014 enum)
- incident status
- linked Exam
- linked Attempt(s) / Candidate(s)
- incident events (append-only history)
- incident notes
- incident action links (time_grant | force_submit)
- incident attempt/interruption evidence links
- Attempt current status
- Attempt effective deadline
- interruption episodes / history (per attempt)
- time-adjustment ledger (per attempt)
- Attempt timeline
- Proctor assignments (active/revoked) for the Exam
- canonical Admin actions (time grant, force submit, misconduct mark)
- authoritative audit / navigation links
```

### 4.2 Explicitly NOT in J5 MVP

The following are **not** J5 MVP commitments and must not be implied as such.
They are deferred to J7 / P7 / future system-incident jobs:

```text
- stuck-grading repair / arbitrary grading reconciliation
- Email dead-letter / retry center
- worker health monitoring
- backup / restore warnings
- PostgreSQL repair tools
- startup reconciliation engine
- system-generated incidents
- media evidence / binary attachment storage
- Redis presence
- WebSocket / SSE live feed
- generic system operations / health center
- arbitrary SQL repair
- raw status / deadline mutation from the UI
- automatic incident classification
- full crash-reconciliation engine
```

A "stuck-grading repair" or "Email retry center" is its own future job with its
own authority; it is **not** smuggled into J5 just because the Recovery Center
is a convenient place to host a tab.

---

## 5. Recovery Queue (read model)

### 5.1 Queue goals

```text
- organization-wide Incident list (NOT per-Exam fan-out)
- server-side filtered and paginated
- stable pagination (no client-side "list all Exams, then fetch incidents per Exam")
- NO N+1 architecture
```

The queue must NOT be implemented as "the browser fetches every Exam and then
calls `GET /admin/exams/:examId/incidents` for each". That is a forbidden
read pattern for J5.

### 5.2 Filter dimensions (proposed)

The first version aims to support at least these queue filters (each must be
verified against reality during J5-I1A; any the existing API cannot serve
becomes an additive read API in J5-I1A, not a UI-only guess):

```text
examId
candidateId
attemptId
status           (open | investigating | resolved | dismissed)
severity         (info | minor | major | critical)
incidentType     (9-value enum)
createdFrom
createdTo
unresolvedOnly
assignedProctorUserId
cursor           (stable pagination)
limit
```

### 5.3 Read-model classification (frozen by this audit)

Every proposed filter is classified into exactly one bucket. The J5-I1A
implementation may not silently invent an endpoint that the audit classifies as
"requires additive read API".

| Bucket | Meaning |
| --- | --- |
| **Already implemented** | A master endpoint exists today and serves this directly. |
| **Reusable with no change** | A master repo method or projection exists; an endpoint can expose it without changing the read shape. |
| **Requires additive read API / repository query** | No master read path serves this; J5-I1A must add it. The endpoint is **proposed**, not existing. |
| **Deferred** | Out of J5 MVP. |

Classification against the §5.2 dimensions (current master):

| Dimension | Bucket | Notes |
| --- | --- | --- |
| `examId` | Already implemented | `GET /admin/exams/:examId/incidents` (`listByExam`) |
| `status` | Already implemented | `listByExam(statusFilter)` |
| `severity` | Requires additive read API | repo has no severity filter on the org-wide path |
| `incidentType` | Requires additive read API | repo has no type filter on the org-wide path |
| `candidateId` | Requires additive read API | no org-wide filter by candidate |
| `attemptId` | Requires additive read API | no org-wide filter by attempt anchor |
| `createdFrom` / `createdTo` | Requires additive read API | no time-range filter |
| `unresolvedOnly` | Reusable with no change | derivable from `statusFilter = [open, investigating]`; UI convenience |
| `assignedProctorUserId` | Requires additive read API | needs a join against `exam_proctor_assignments` |
| `cursor` / `limit` | Requires additive read API | `listByExam` is unbounded; keyset pagination is the J4-I1C pattern to reuse |

### 5.4 Proposed additive queue endpoint (J5-I1A contract, NOT yet existing)

Because no organization-wide, multi-filter Incident queue exists on master,
J5-I1A is contracted to add one. The proposed shape follows the existing
Admin API style (keyset-paginated, like the J4-I1C Proctor assignment list):

```text
GET /admin/recovery/incidents
```

The final route name is a J5-I1A decision and must align with the existing
API style; the contract only fixes that **some** organization-wide,
server-filtered, keyset-paginated Incident queue read endpoint must exist
before the read-only UI (J5-I1B) can ship. The endpoint must NOT be a
client-side fan-out aggregator.

A generic `/recovery/items` super-aggregate model is **rejected** for J5 MVP:
the reality audit shows only one frozen, unified recovery-item type on master
(the ADR-014 Incident). The MVP stays Incident-centered. Other recovery
domains (grading, Email, backup) bring their own authority and are deferred.

---

## 6. Incident Detail projection

### 6.1 Required detail fields (UI authority)

The Incident Detail page must render an authoritative projection that covers
at least:

```text
- incident (id, type, severity, status, description, occurredAt, detectedAt,
            reportedBy, resolution summary, resolvedAt/By, version)
- incident events (append-only, ordered by event_sequence)
- incident notes (from note_added events)
- linked attempts (membership)
- linked candidates
- linked interruption episodes (evidence)
- linked time grants / actions (action_type + action_id)
- exam summary (identity + scope)
- attempt summary (current status + effective deadline)
- current allowed actions (server-derived; see §7)
- version / concurrency token (for expectedVersion on writes)
- audit references / authoritative navigation links
```

### 6.2 Frontend MUST NOT derive

These fields cannot be computed by the frontend; they must come from a server
projection or be read-only displays of server-supplied data:

```text
- incident terminality (server status is the truth)
- action eligibility (server capability + resource scope + status)
- Attempt effective deadline (server-derived from the ledger)
- assignment authority (server assignment state, not a client guess)
- target resource organization (server scope quadruple)
- command idempotency outcome (server operationId replay result)
```

### 6.3 Aggregate vs multi-fetch (J5-I1A decision)

The reality audit shows the detail projection can be assembled from existing
repo-level reads (`incidentRepo.findById` + `findAuthorizationChain` +
`listEventsByIncident` + `listActionsByIncident` + `listAttemptsByIncident` +
`listInterruptionLinksByIncident`) plus Attempt-side reads. J5-I1A must
decide, with evidence:

- whether the existing per-incident endpoints can be safely composed by the
  page without unreasonable request count / N+1; OR
- whether a single additive aggregate detail endpoint is required.

Either is acceptable; defaulting to "the page issues six requests" without
measuring is not.

---

## 7. Admin action matrix (frozen)

Every UI action MUST call an existing canonical command (or a J5-I1A endpoint
that is explicitly mapped to one). Route-local mutation is forbidden.

| Action | Existing canonical command/API | Required permission | Resource resolver | Allowed states | Reason required? | Confirmation required? | operationId? | Retry behavior | Authoritative reload target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create Incident | `POST /admin/exams/:examId/incidents` → `createExamIncident()` | `incident.create` | `exam` (examId) | n/a (new) | per ADR-014 (description) | no | yes | replay → `idempotent_replayed` | Incident Detail |
| Start investigation | `POST /admin/incidents/:incidentId/investigate` → `startIncidentInvestigation()` | `incident.investigate` | `incident` | `open` | no | no | yes | replay | Incident Detail |
| Add note | `POST /admin/incidents/:incidentId/notes` → `addIncidentNote()` | `incident.investigate` | `incident` | any (side write) | no | no | yes (per note) | replay | Incident Detail |
| Update severity | `POST /admin/incidents/:incidentId/severity` → `changeIncidentSeverity()` | `incident.investigate` | `incident` | non-terminal | no | no | yes + `expectedVersion` | replay / version conflict | Incident Detail |
| Link action (time_grant / force_submit) | `POST /admin/incidents/:incidentId/actions` → `linkIncidentAction()` | `incident.investigate` | `incident` | any (side write) | no | no | yes | replay / `INCIDENT_ACTION_ALREADY_LINKED` | Incident Detail |
| Link attempt / interruption | `POST /admin/incidents/:incidentId/{attempts,interruptions}` → `linkIncident*()` | `incident.investigate` | `incident` | any (side write) | no | no | yes | replay / scope-quadruple error | Incident Detail |
| Resolve incident | `POST /admin/incidents/:incidentId/resolve` → `resolveExamIncident()` | `incident.resolve` (Admin sensitive) | `incident` | `open` \| `investigating` | per ADR-014 (see §8 gap) | **yes** (terminal judgment) | yes + `expectedVersion` | replay / version / invalid-transition | Incident Detail |
| Dismiss incident | `POST /admin/incidents/:incidentId/dismiss` → `dismissExamIncident()` | `incident.resolve` (Admin sensitive) | `incident` | `open` \| `investigating` | per ADR-014 (see §8 gap) | **yes** (terminal judgment) | yes + `expectedVersion` | replay / version / invalid-transition | Incident Detail |
| Grant Attempt time | `POST /admin/attempts/:attemptId/time-grants` → `grantAttemptTime()` | `attempt.time.grant` (Admin) | `attempt` (attemptId) | non-terminal Attempt | per ADR-013 | no | yes | replay / `terminal` | Attempt Operations Context + Incident Detail |
| Force submit Attempt | `POST /admin/attempts/:attemptId/force-submit` → canonical force-submit | `attempt.force.submit` (Admin) | `attempt` | non-terminal Attempt | per existing contract | **yes** | yes | replay / terminal | Attempt Operations Context |
| Mark Attempt misconduct | `POST /admin/attempts/:attemptId/misconduct` → canonical misconduct mark | `attempt.misconduct.mark` (Admin) | `attempt` | per existing contract | per existing contract | **yes** | yes | replay | Attempt Operations Context |
| Assign Proctor | `POST /admin/exams/:examId/proctors` → `assignProctorToExam()` | `exam.proctor_assignment.manage` (Admin) | `exam` | n/a | per ADR-015 (`reasonCode` in payload only) | no | yes | replay / `no_change` | Exam Recovery Detail |
| Revoke Proctor | `POST /admin/exams/:examId/proctors/:proctorUserId/revoke` → `revokeProctorFromExam()` | `exam.proctor_assignment.manage` (Admin) | `exam` | n/a | per ADR-015 (`reasonCode` in payload only) | no | yes | replay / `no_change` / 404 | Exam Recovery Detail |

Notes:

- "per ADR-014 (see §8 gap)" for resolve/dismiss reason: the current API
  optionality of `reason` is a J5-I1 contract gap to be adjudicated before
  implementation — see §8.
- "Allowed states" for Attempt actions is bounded by the canonical command's
  own contract; the UI never widens it.

---

## 8. Dangerous-action UX (frozen rules)

```text
1. force submit          — explicit confirmation dialog required
2. misconduct mark       — explicit confirmation dialog required
3. resolve incident      — explicit confirmation (terminal judgment)
4. dismiss incident      — explicit confirmation (terminal judgment)
5. reason field optionality MUST match the actual API/domain contract
```

### 8.1 The reason-field contract gap (open for J5-I1)

The current Incident `resolve` / `dismiss` API and ADR-014 may treat `reason`
as optional. The product may want it required for terminal judgments. This is
an **open contract gap** for J5-I1 to resolve before implementation — it must
NOT be silently faked as required in the UI alone. The adjudication options
are:

- (a) change the API/domain contract to require reason on terminal transitions
  (a J5-I1 contract change, reviewed like any ADR-014 follow-up); OR
- (b) keep the API optional and have the UI require it as a product rule,
  documented as a UI-only constraint.

Either decision must be recorded in the J5-I1 closeout, and the UI must not
pretend the server enforces what the server does not enforce.

### 8.2 operationId / retry / reload rules (frozen)

```text
- operationId is generated client-side
- a retry of the SAME user operation MUST reuse the same operationId
- a NEW independent operation MUST generate a new operationId
- duplicate clicks MUST NOT produce duplicate mutation
  (the server's UNIQUE(organization_id, operation_id) on the events table is
   the arbiter — duplicate replays return idempotent_replayed, not a second
   mutation)
- on any command success, the page MUST immediately re-read the authoritative
  projection/timeline; it MUST NOT wait for the next polling tick
- optimistic fake success is forbidden
- 409 (IDEMPOTENCY_CONFLICT / version / already-linked), 404, 403, 503 must be
  classified and surfaced distinctly
- the server's permission/resource-scope decision is final
- a disabled button is a UX convenience, NEVER an authorization
```

---

## 9. Refresh model (frozen for J5 MVP)

```text
J5 MVP refresh = manual refresh
               + bounded polling where useful
               + a visible stale-data indicator
```

Explicitly excluded from J5 MVP:

```text
- Redis
- WebSocket
- SSE
- presence
- cross-instance live fan-out
```

A successful command MUST trigger an immediate authoritative re-read of the
affected projection(s); it must not rely on the next polling interval to
catch up. The bounded polling interval itself is a J5-I1B UI decision.

---

## 10. Responsive / accessibility baseline (inherited authority)

The Recovery Center inherits the existing frontend visual authority (see
`AGENTS.md` → "Frontend Visual Authority" and `docs/standards/ui-system.md`):

```text
- Tailwind + shadcn/ui substrate
- NO re-introduction of Ant Design or any forbidden dependency
- existing design tokens (no page-local font-family / arbitrary typography)
- authoritative components: TableShell / DataTableShell, Card, StatusBadge,
  Button, Dialog/ConfirmDialog, InlineErrorBanner, FieldError, etc.
- domain status presentation MUST flow through statusMeta + StatusBadge
- loading / empty / error / permission-denied states on every view
- keyboard navigation; accessible dialog focus management
- dangerous-action confirmation text readable by screen readers
- desktop-first Admin pages, but narrow screens must remain operable
```

**This R0 document does not implement any UI.** J5-I1B/I1C own the
implementation and must follow the component-insufficiency protocol in
`AGENTS.md` rather than hand-rolling local recipes.

---

## 11. J5 non-goals (frozen)

```text
- Proctor-facing Recovery Center              (J6)
- Proctor dangerous-operation grants          (force submit / misconduct /
                                               time grant / resolve stay
                                               Admin-only per ADR-015 §13)
- custom roles
- Teacher / Grader relationship authority
- Redis in any J5 path
- live presence
- system-generated incidents
- generic system health center
- backup / restore center
- arbitrary SQL repair
- raw status / deadline mutation from the UI
- media evidence / binary attachment storage
- automatic incident classification
- full crash-reconciliation engine
- one universal updateIncident() / universal recovery-item endpoint
```

---

## 12. J5 implementation slices (frozen)

The J5 work is decomposed so that the read model and read-only UI can be
reviewed before any operator-action UI ships.

```text
J5-R0   Admin Recovery Center reality audit + product/API/read-model contract
        (THIS document — documentation-only, IN REVIEW)

J5-I1A  Recovery queue + required authoritative read APIs / projections
        (the additive organization-wide Incident queue endpoint from §5.4,
         plus the §6.3 aggregate-vs-multifetch decision for Incident Detail)

J5-I1B  Read-only Admin Recovery Center UI
        - queue (with filters)
        - exam recovery detail
        - incident detail projection
        - attempt operations context (read-only)
        - loading / empty / error / permission-denied states

J5-I1C  Admin operations UI
        - incident commands (investigate / note / severity / resolve / dismiss)
        - time grant
        - force submit
        - misconduct mark
        - Proctor assignment management
        - operationId / retry safety per §8.2
        - dangerous-action confirmation per §8

J5-I1D  Browser E2E + accessibility/responsive closeout
        + status documentation
        + J6 reusable-component handoff
```

Dependencies:

```text
J5-R0 accepted
  → J5-I1A
  → J5-I1B
  → J5-I1C
  → J5-I1D
```

Partial parallelism between J5-I1A and J5-I1B is allowed **only** when the
reality-audit evidence shows the existing API is already sufficient for the
read-only UI being built in parallel; it must not be the default assumption.

---

## 13. J6 handoff (corrected authority)

J6 (Proctor Recovery Center) reuses J5 components but MUST NOT bypass:

```text
- active Proctor role
- active Exam assignment
- explicit permission
- resource resolver
- server-side capability decision
```

The current Proctor baseline (master, ADR-015 §13, as implemented by J4-I1) is
the authority J6 starts from. It is recorded here so the J5 contract and the
J6 planning sketch cannot drift apart:

| Capability | Current Proctor baseline (master) |
| --- | --- |
| View assigned Exam live status | Allowed |
| View assigned Exam Attempts / timeline | Allowed |
| View incidents in assigned Exam | Allowed |
| Create incident in assigned Exam | Allowed |
| Investigate / add notes / evidence in assigned Exam | Allowed |
| Create a suspected-misconduct **incident** | Allowed (incident type `suspected_misconduct`) |
| Apply Attempt misconduct **mark** | Admin-only |
| Grant Attempt time | Admin-only / deferred |
| Force submit Attempt | Admin-only |
| Resolve / dismiss incident | Admin-only terminal judgment |
| Access unassigned Exam | Denied with anti-enumeration 404 |
| Change Exam/system settings | Denied |
| Delete history | Denied |

The earlier J6 planning sketch's rows that read "Grant time: Policy-dependent",
"Force submit: Policy-dependent", "Resolve/dismiss: Policy-dependent" are
**stale relative to ADR-015 §13 as implemented** and are corrected in
`recovery-operations-jobs.md` §8 by this same job.

Critical distinction J6 (and any UI sharing J5 components) must preserve:

```text
Create a suspected_misconduct Incident  (incident type, allowed for Proctor)
        !=
Apply AttemptMisconductMark             (terminal Attempt fact, Admin-only)
```

A Proctor may *document* suspected misconduct as an incident; a Proctor may
NOT apply the misconduct mark to the Attempt. Sharing a button component
between Admin and Proctor does not change this.

---

## 14. Acceptance checklist (J5-R0)

J5-R0 acceptance is "the contract is complete and reality-consistent", NOT
"runtime features are done". Acceptance requires every item below:

```text
[ ] master reality audit completed                     (§2)
[ ] J4 status reconciled across docs                   (separate doc fixes)
[ ] J5 dependencies corrected (J1 + J3 + J4-I1)        (recovery-operations-jobs.md)
[ ] J5 MVP boundaries frozen                           (§3, §4)
[ ] existing / reusable / missing API matrix completed (§2.1, §5.3)
[ ] queue read model frozen                            (§5)
[ ] detail projection frozen                           (§6)
[ ] Admin action matrix frozen                         (§7)
[ ] retry / idempotency UX frozen                      (§8.2)
[ ] dangerous-action UX frozen                         (§8)
[ ] refresh model frozen                               (§9)
[ ] J5 implementation slices frozen                    (§12)
[ ] J6 handoff corrected                               (§13)
[ ] all modified docs internally consistent
[ ] NO runtime changes introduced by J5-R0
```

J5-R0 must NOT be marked CLOSED or ACCEPTED inside this PR; that is the
reviewer's call.

---

## 15. Open questions for reviewer (not blocking R0 freeze)

These remain genuine decisions and are listed so they are not lost:

- Final route name for the organization-wide Incident queue endpoint
  (`GET /admin/recovery/incidents` is the proposal; the existing API style may
  suggest a different name).
- Incident Detail: one additive aggregate endpoint vs stable multi-fetch from
  existing per-incident endpoints (J5-I1A decides with evidence).
- Whether dangerous-operation `reason` should be upgraded to server-side
  required (the §8.1 contract gap).
- Whether the bounded polling interval is fixed here or deferred to J5-I1B.
