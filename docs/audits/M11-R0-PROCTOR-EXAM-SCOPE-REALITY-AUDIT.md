# M11-R0 — Proctor-to-Exam Scope Reality Audit

> **Job:** `M11-R0-PROCTOR-EXAM-SCOPE-CONTRACT` (J4-R0)
> **Type:** Reality audit (documentation only — no code changed)
> **Date:** 2026-08-02
> **Branch:** `docs/m11-r0-proctor-exam-scope-contract`
> **Base SHA:** `e9fa1969131c0976622ebd3c83465a97f771e5be` (master, post #244)
> **Authority chain this audit feeds:** ADR-015 (Proposed) → J4-I1 runtime

This audit answers, from **real master code**, what exists today for
Proctor→Exam resource-relationship authority. It exists to be cited by
ADR-015 and to prevent J4-I1 from inventing semantics. Every claim below
carries a file/symbol/route reference. Where roadmap text and code differ,
this audit says so explicitly and treats the code as the fact.

The job card forbids implementing runtime in this PR. This audit likewise
changes no code; it records reality.

---

## Scope of "Proctor-to-Exam"

This audit concerns only the **Proctor → assigned Exam** relationship and
the resource-scope enforcement it requires. It does not audit
Teacher→Course, Teacher→Exam, or Grader→Work — those are separate M11
slices explicitly out of scope for J4 (`docs/roadmap/recovery-operations-jobs.md`
§6 "deliberately small slice of M11").

---

## 4.1 Current identity and role facts

| Question | Fact (master `e9fa1969`) | Evidence |
| --- | --- | --- |
| Does a Proctor role preset exist? | **Yes.** `Role.Proctor = "Proctor"` is a closed preset. | `packages/authz/src/catalog.ts:171`; `packages/authz/src/presets.ts:237-250` |
| How does a user obtain the Proctor role? | Via an active `user_role_assignments` row with `role = 'Proctor'`. The DB CHECK allows it: `role IN ('Admin','Teacher','Proctor','Grader','Candidate')`. | `packages/db/src/schema/pg.ts:1144-1146`; `packages/db/src/repository/userRoleAssignmentRepo.ts` (`assign` / `ensurePrimaryAssignment`) |
| Does user-role assignment support a resource scope? | **No.** `user_role_assignments` carries only `organizationId`, `userId`, `role`, `isPrimary`, `isActive`. There is **no** `scope_type` / `scope_resource_id` / `resource_id` column. The composite unique is `(organization_id, user_id, role)` — assignment is organization-wide, never resource-scoped. | `packages/db/src/schema/pg.ts:1116-1147`; `rg "scope_type\|scope_resource_id"` over `packages/db/src/` → zero hits |
| Is `users.role` still a compatibility cache? | **Yes, and explicitly non-authoritative.** `loadAssignmentAuthority` resolves capabilities from active assignments; `users.role` and the JWT `role` claim are "compatibility / display projection" only. Zero runtime authz decisions read `users.role`. | `apps/api/src/authz/assignmentAuthority.ts`; `apps/api/src/plugins/auth.ts:117-189`; `docs/architecture/authorization.md` ("`users.role` and JWT-role compatibility policy") |
| How is the multi-role union loaded? | `loadAssignmentAuthority(db, ctx, userId)` → `listActiveForUser` (full active set, no `.limit(1)`) → `deriveAssignmentAuthority` unions every active role's preset into a stable-sorted `capabilities` array, stored on `ctx.capabilities`. | `apps/api/src/authz/assignmentAuthority.ts:134-252`; `apps/api/src/plugins/auth.ts:164-175` |
| How does revocation take effect today? | Deactivating/removing a `user_role_assignments` row is effective on the **next authenticated request** (authority is re-resolved per request; there is no JWT-capability cache). `deactivate` / `remove` auto-promote the next active assignment to keep the ≤1-primary invariant. | `packages/db/src/repository/userRoleAssignmentRepo.ts:438-522`; `apps/api/src/plugins/auth.ts:128-162` |
| What scope does Admin operate at? | **Organization scope** (`defaultScope: Scope.Organization`). Admin is the compatibility superset and is **not** narrowed by any resource assignment. | `packages/authz/src/presets.ts:198-218`; `docs/architecture/authorization.md` ("MVP product-role boundary") |

**Required conclusion (§4.1):** the only identity-to-role relationship the
schema can express is **organization-wide**. There is no row, column, or
resolver that ties a Proctor (or any role) to a specific Exam. Any
Proctor→Exam authority therefore has to be a **new** resource-relationship
layer, not a query over existing assignment rows.

---

## 4.2 Current permission facts

### Proctor preset — exact permissions on master

From `packages/authz/src/presets.ts:151-160` (`PROCTOR_PERMISSIONS`):

```text
Permission.ExamRoomView            (exam_room.view)
Permission.AttemptStatusView       (attempt.status.view)
Permission.AttemptTimelineView     (attempt.timeline.view)
Permission.AttemptMisconductMark   (attempt.misconduct.mark)
Permission.AttemptForceSubmit      (attempt.force_submit)
```

`Permission.AttemptTimeGrant` is **deliberately absent** from the Proctor
preset (`presets.ts:157-158` comment: "Operator time grant
(AttemptTimeGrant) is Admin-only; Proctor has no grant path"). The legacy
`AttemptTimeExtend` permission is also absent — the old `/extend-time` route
was cut in REC-I4-I3B2.

Proctor `sensitivePermissions`: `AttemptForceSubmit`, `AttemptMisconductMark`
(`presets.ts:246-249`).

### Job-card §4.2 checklist — existence in catalog, grant to Admin, grant to Proctor

| Permission (job-card name) | Catalog key | In catalog? | Granted to Admin? | Granted to Proctor? |
| --- | --- | :---: | :---: | :---: |
| `incident.view` | `Permission.IncidentView` | ✅ `catalog.ts:132` | ✅ `presets.ts:119` | ❌ |
| `incident.create` | `Permission.IncidentCreate` | ✅ `catalog.ts:133` | ✅ `presets.ts:120` | ❌ |
| `incident.investigate` | `Permission.IncidentInvestigate` | ✅ `catalog.ts:134` | ✅ `presets.ts:121` | ❌ |
| `incident.resolve` | `Permission.IncidentResolve` | ✅ `catalog.ts:135` | ✅ `presets.ts:122` (sensitive) | ❌ |
| `attempt.time_grant` | `Permission.AttemptTimeGrant` | ✅ `catalog.ts:91` | ✅ `presets.ts:102` (sensitive) | ❌ |
| `attempt.force_submit` | `Permission.AttemptForceSubmit` | ✅ `catalog.ts:92` | ✅ `presets.ts:103` (sensitive) | ✅ `presets.ts:156` (sensitive) |
| `attempt.misconduct_mark` | `Permission.AttemptMisconductMark` | ✅ `catalog.ts:89` | ✅ `presets.ts:101` (sensitive) | ✅ `presets.ts:155` (sensitive) |
| `exam.monitor` | *(no such key)* | ❌ | ❌ | ❌ |

> **`exam.monitor` does not exist.** The job card lists it, but there is no
> `exam.monitor` permission in the catalog. The closest live capability is
> `exam_room.view` (`Permission.ExamRoomView`), which is the proctor-room
> monitoring read. ADR-015 must not invent `exam.monitor`; it maps onto the
> existing `ExamRoomView` / `AttemptStatusView` reads.

### ADR-014 §8 boundary — verified

ADR-014 §8 states "J3 MUST leave the Proctor preset unchanged: without M11
scope enforcement, a granted Proctor preset would be organization-wide
authority". Verified against `presets.ts`: the Proctor preset holds **zero**
`incident.*` permissions. The four incident permissions are Admin-only
(`presets.ts:118-122`). So the ADR-014 boundary holds for incidents.

### Pre-existing gap this audit surfaces (not introduced by J3)

The Proctor preset **already grants** `AttemptForceSubmit` and
`AttemptMisconductMark` organization-wide (they predate ADR-014 — see the
ADR-014 §8 note: "The pre-existing Proctor preset grants for force submit /
misconduct marking predate this ADR and are tracked by the M11 open item").

**Risk classification (corrected during the ADR-015 design-contract
revision):** this is a **current, reachable** risk, not a future-only one.
The Proctor preset marks the role `assignable: true` and
`loginAllowed: true` (`packages/authz/src/presets.ts:238-249`),
`loadAssignmentAuthority` resolves capabilities per request from active
`user_role_assignments` rows, and Admin can assign the Proctor role via the
role-assignment API today. Therefore any user granted the Proctor role can
**already** exercise `AttemptForceSubmit` and `AttemptMisconductMark`
organization-wide — there is no "Proctor product role not activated" state
that mitigates this on master. The earlier "not currently an active
product risk because no Proctor product role is activated in the MVP"
framing is withdrawn; it conflated *product UI exposure* with *API-level
authority*, and the latter is live.

ADR-015 §13 freezes the closure: **J4-I1B removes
`AttemptForceSubmit` and `AttemptMisconductMark` from `PROCTOR_PERMISSIONS`
atomically with the resolver flip** (the grants are removed from the
preset, not "kept-but-inactive"). The four affected routes
(`POST /admin/attempts/:attemptId/misconduct`,
`POST /admin/attempts/:attemptId/force-submit`,
`POST /admin/attempts/:attemptId/proctor-incident`, and incident
`resolve`/`dismiss`) become `proctorAccess = admin_only` while keeping
their scoped gate (§16). Until that lands, this is an open,
organization-wide Proctor-authority gap on every attempt in the
deployment — exactly what ADR-014 forbade for incidents.

---

## 4.3 Current resource resolver facts

Live resolvers are registered in `apps/api/src/authz/resolvers/`:

| Resolver file | `key` | Scope produced | Live in `requireScopedCapability`? |
| --- | --- | --- | --- |
| `attemptResolver.ts` → `createAttemptResolver` | `"attempt"` | `Scope.Attempt` | ✅ |
| `attemptResolver.ts` → `createExamResolver` | `"exam"` | `Scope.Exam` | ✅ |
| `ownAttemptResolver.ts` | `"own_attempt"` | `Scope.OwnAttempt` | ✅ (candidate runtime) |
| `examEligibilityResolver.ts` | (exam-eligibility gate) | `Scope.OwnAttempt` | ✅ (candidate runtime) |
| `scoreResolver.ts` | `"score"` | `Scope.OwnScore` | ✅ (`requireScoreCapability`) |

The `attempt` and `exam` resolvers (`createAttemptResolver`,
`createExamResolver`) load the **full ownership chain** (attempt→exam→course→org
and exam→course→org) and deny on `resource_not_found` / `organization_mismatch`
/ `broken_parent_chain` / `resolver_error`. They are tenant-scoped
(`ctx.organizationId`) and server-derived.

### Job-card §4.3 checklist — Exam / Attempt→Exam / Incident→Exam / Course→Exam / Candidate→Exam

| Required resolution | Resolver exists? | Truly executed at runtime? | Notes |
| --- | :---: | :---: | --- |
| **Exam** (by `examId`) | ✅ `createExamResolver` | ✅ consumed by `requireScopedCapability(..., "exam", "examId")` on flipped routes (e.g. `GET /admin/exams/:examId/proctor/attempts`, `POST /admin/attempts/:attemptId/time-grants`) | `apps/api/src/authz/resolvers/attemptResolver.ts:166-207` |
| **Attempt → Exam** | ✅ `createAttemptResolver` returns the chain including `examId` | ✅ consumed on `POST /admin/attempts/:attemptId/proctor-incident`, `GET /admin/attempts/:attemptId/proctor-events` | `attemptResolver.ts:121-164` |
| **Incident → Exam** | ❌ **No incident resolver.** No file, no `key: "incident"`. | ❌ | All 11 incident routes use **flat** `requireCapability` (see §4.4). ADR-014 §13 lists `GET /admin/exams/:examId/incidents` etc., but they were implemented flat. An Incident→Exam resolver is **new J4-I1 work**. |
| **Course → Exam** | n/a (no `course` resolver file; `resolver: "course"` appears only as registry metadata) | ❌ | Course-scoped routes (questions, courses) run flat `requireCapability`. Not in J4 scope. |
| **Candidate/Enrollment → Exam** | n/a (enrollment resolver is registry metadata only: `resolver: "enrollment"` on `DELETE /exams/:examId/enrollments/:enrollmentId`) | ❌ | Not in J4 scope. |

### Registry metadata vs runtime enforcement — the critical distinction

`ROUTE_PERMISSION_REGISTRY` (`apps/api/src/authz/routeRegistry.ts`) declares
`scope` + `resolver` for every route, but the registry header states
explicitly: **"This job does NOT enforce anything."** The registry is
metadata + a coverage test. Whether a route is *actually* scope-gated at
runtime is determined by which decorator the route file wires:
`fastify.requireScopedCapability(...)` (resolver runs) vs
`fastify.requireCapability(...)` (flat, no resolver). This distinction is
the heart of §4.4.

**Required conclusion (§4.3):** the `exam` and `attempt` resolvers exist and
are sound, but there is **no Incident→Exam resolver** and no
Proctor-assignment resolver. J4-I1 must add the Incident→Exam resolver (or
route incidents through the existing exam resolver via `examId`) and the
Proctor-assignment enforcement layer; it must not assume incidents are
already scope-gated.

---

## 4.4 Current Proctor routes

The job card demands a route-by-route table distinguishing "route exists /
registered / permission exists / granted / assignment enforced / UI exists".
Below is the verified master state for every route whose path or `x-role`
marker touches Proctor.

| Method | Path | Permission (wired) | Scope gate (wired) | Resolver runs? | Permission granted to Proctor preset? | Proctor-Exam assignment enforced? | UI exists? |
| --- | --- | --- | --- | :---: | :---: | :---: | :---: |
| GET | `/admin/proctor/exams` | `ExamRoomView` | flat `requireCapability` | ❌ (organization list) | ✅ | ❌ (no assignment concept) | ❌ (no Proctor product UI; P4 = Admin/Teacher/Candidate) |
| GET | `/admin/exams/:examId/proctor/attempts` | `ExamRoomView` | `requireScopedCapability(..., "exam", "examId")` | ✅ exam resolver (org + chain) | ✅ | ❌ (resolver checks org, **not** Proctor-Exam assignment) | ❌ |
| GET | `/admin/attempts/:attemptId/proctor-events` | `AttemptTimelineView` | `requireScopedCapability(..., "attempt", "attemptId")` | ✅ attempt resolver | ✅ | ❌ (org + chain only) | ❌ |
| POST | `/admin/attempts/:attemptId/proctor-incident` | `AttemptMisconductMark` | `requireScopedCapability(..., "attempt", "attemptId")` | ✅ attempt resolver | ✅ | ❌ (org + chain only) | ❌ |
| POST | `/admin/attempts/:attemptId/misconduct` | `AttemptMisconductMark` | **flat** `requireCapability` | ❌ | ✅ | ❌ | ❌ |
| POST | `/admin/attempts/:attemptId/force-submit` | `AttemptForceSubmit` | **flat** `requireCapability` | ❌ | ✅ | ❌ | ❌ |
| POST | `/admin/attempts/:attemptId/time-grants` | `AttemptTimeGrant` | `requireScopedCapability(..., "attempt", "attemptId")` | ✅ attempt resolver | ❌ (Admin-only) | ❌ | ❌ |
| GET | `/admin/attempts/:attemptId/timeline` | `AttemptTimelineView` | **flat** `requireCapability` | ❌ | ✅ | ❌ | ❌ |
| GET | `/admin/attempts/:attemptId/export` (+ `/csv`) | `AttemptExport` | **flat** `requireCapability` | ❌ | ❌ (Admin-only) | ❌ | ❌ |
| POST/GET | `/admin/exams/:examId/incidents` (×2) | `IncidentCreate` / `IncidentView` | **flat** `requireCapability` | ❌ | ❌ (Admin-only) | ❌ | ❌ |
| GET | `/admin/incidents/:incidentId` (+ 8 sub-routes) | `IncidentView` / `Investigate` / `Resolve` | **flat** `requireCapability` | ❌ | ❌ (Admin-only) | ❌ | ❌ |

**Sources:** `apps/api/src/routes/proctorMonitoring.ts`; `apps/api/src/routes/attempts.admin.ts:66-540`; `apps/api/src/routes/incidents.admin.ts`; `apps/api/src/authz/routeRegistry.ts` (registry metadata, non-enforcing).

### Key findings

1. **"Route named `/proctor`" ≠ "Proctor-to-Exam scope".** The four
   `/admin/.../proctor...` routes are scoped to **organization + ownership
   chain** only. The exam/attempt resolver verifies the resource belongs to
   the actor's organization — it does **not** verify any Proctor→Exam
   assignment, because no such assignment exists (§4.5). A user granted the
   Proctor role can **today** read live status of **every** exam in the
   organization, not just assigned ones (the "if one existed as a product
   role" hedge is withdrawn — the preset is assignable and the role can be
   granted via the Admin API).

2. **`misconduct` and `force-submit` are flat, not scoped.** Their registry
   entries declare `resolver: "attempt"` / `Scope.Attempt`, but the route
   files wire `requireCapability` (flat). The drift is **not** harmless: a
   user granted the Proctor role can today exercise the flat
   `AttemptForceSubmit` / `AttemptMisconductMark` grants with **no**
   attempt-chain check at all. J4-I1B must flip these to
   `requireScopedCapability` AND remove the grants from the Proctor preset
   (ADR-015 §13).

3. **All 11 incident routes are flat.** ADR-014 §13 lists
   `GET /admin/exams/:examId/incidents` etc. as scoped-by-exam in its API
   proposal, but J3 implemented them flat (the J3 closeout
   `REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md` notes Admin-only authority was
   the scope). The `/admin/incidents/:incidentId` family has **no** resource
   id on the path that an exam resolver could consume — anti-enumeration
   relies on handler-level `NotFoundError` / `repo.findById(ctx, ...)`
   returning null for cross-org incidents. There is no Incident→Exam
   resolver. J4-I1 must add one before any Proctor incident grant.

4. **`POST /admin/attempts/:attemptId/proctor-incident` is an audit-only
   marker, not an Incident creation path.** The route is scoped
   (`requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId")`
   — `proctorMonitoring.ts:200-286`) but its handler writes only an
   audit-only `ProctorIncidentMarked` row via `recordAtomicHttpAudit`; it
   does **not** call the ADR-014 `createExamIncident()` command. It is
   therefore not a safe Incident creation path. ADR-015 §16 freezes its
   J4-I1B disposition: Admin-only (`x-role:["Admin"]`) + OpenAPI
   `deprecated:true`, STAYS scoped (not downgraded to flat); the sole
   Proctor incident-creation path becomes `createExamIncident()` via
   `POST /admin/exams/:examId/incidents`.

5. **No Proctor UI exists.** P4 closed Admin/Teacher/Candidate only
   (`docs/architecture/authorization.md`). The Proctor workspace is future
   J6 work. (Note: "no Proctor product UI" does **not** mean "no Proctor
   API authority" — see §4.2 and G1/G2.)

The route table above is the authoritative Proctor-reachable inventory and
matches ADR-015 §8/§23 one-to-one, including the five additional routes
(`/admin/proctor/exams`, `/admin/exams/:examId/proctor/attempts`,
`/admin/attempts/:attemptId/proctor-events`,
`/admin/attempts/:attemptId/proctor-incident`,
`/admin/attempts/:attemptId/timeline`) that an earlier ADR draft omitted.

**Required conclusion (§4.4):** no route on master enforces a
Proctor-to-Exam assignment. The Proctor-named routes enforce only
organization + ownership-chain. Several sensitive routes are not even
chain-scoped (flat). J4-I1 must add the assignment enforcement layer and
flip the flat sensitive routes before activating any Proctor permission.

---

## 4.5 Current assignment persistence

| Table / mechanism | Exists? | Evidence |
| --- | :---: | --- |
| `exam_proctor_assignments` | ❌ | `rg "exam_proctor" packages/ apps/` → zero hits; not in `packages/db/src/schema/pg.ts` |
| `exam_staff` | ❌ | not in schema; `rg` → zero hits |
| `course_staff` | ❌ | not in schema; `rg` → zero hits |
| `teacher_exam_assignments` | ❌ | not in schema; `rg` → zero hits |
| `grading_assignment` | ❌ | not in schema; `rg` → zero hits |
| resource-scoped `user_role_assignments` (`scope_type` / `scope_resource_id`) | ❌ | `packages/db/src/schema/pg.ts:1116-1147` — no such columns; `rg` → zero hits |

The only assignment persistence is **user-to-role** (`user_role_assignments`),
which is organization-wide and carries no resource dimension
(`docs/archive/phase3/RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md`
"Existing assignment infrastructure" section documents this verbatim and
warns against conflating the two).

**Required conclusion (§4.5):** there is **no** Proctor-to-Exam assignment
persistence of any kind. J4-I1 must create it from scratch. The
`exam_proctor_assignments` table proposed in the recovery-operations-jobs.md
§6 sketch does not exist.

---

## 4.6 Current security gaps

Each gap below is a concrete failure mode that exists on master *or* that
J4-R0 must close before J4-I1 activates a Proctor product role. Format:
`file · symbol/route/table · current behavior · risk`.

### G1 — Proctor can read live status of unassigned Exams (active latent)

- **file/symbol:** `apps/api/src/routes/proctorMonitoring.ts:92-126`
  (`GET /admin/exams/:examId/proctor/attempts`); resolver
  `apps/api/src/authz/resolvers/attemptResolver.ts:166-207`.
- **current behavior:** the exam resolver verifies the exam belongs to the
  actor's **organization**. It does not consult any Proctor→Exam assignment
  (none exists).
- **risk (reclassified — active latent):** this is **reachable today** by
  any user granted the Proctor role (the preset is `assignable: true`,
  `loginAllowed: true`, capabilities loaded per request — §4.2). Such a
  user can monitor live attempt status of any exam in the deployment,
  including exams they are not assigned to. This is exactly the
  "organization-wide Proctor authority" ADR-014 forbade for incidents,
  extended to monitoring reads. The earlier "latent / not exploitable
  because no Proctor product role is active" label conflated product-UI
  exposure with API-level authority and is withdrawn.
- **closure:** ADR-015 §8 + §23 — J4-I1B adds the Proctor-assignment
  enforcement layer and the route becomes `proctorAccess =
  assignment_scoped`.

### G2 — `misconduct` and `force-submit` are flat (no chain check at all) (active latent)

- **file/symbol:** `apps/api/src/routes/attempts.admin.ts:66-77, 130-141`
  (`POST /admin/attempts/:attemptId/misconduct`, `.../force-submit`).
- **current behavior:** gated by `requireCapability(AttemptMisconductMark)`
  and `requireCapability(AttemptForceSubmit)` — flat. No resolver, no
  ownership-chain check. The handler trusts `ctx` org scoping inside
  `flagMisconduct` / `submitAttempt` repo calls.
- **risk (reclassified — active latent):** the registry *says* these are
  `Scope.Attempt` / `resolver: "attempt"`, but runtime does not enforce
  it. A user granted the Proctor role can **today** force-submit or flag
  misconduct on **any** attempt id in the org (subject only to the repo's
  org filter), because both grants are live in the Proctor preset
  (`presets.ts:151-160`). The earlier "mitigated because only Admin
  exercises these routes in the MVP" label is withdrawn for the same
  reason as G1.
- **closure:** ADR-015 §13 + §23 — J4-I1B removes
  `AttemptForceSubmit`/`AttemptMisconductMark` from `PROCTOR_PERMISSIONS`
  AND flips both routes to `requireScopedCapability(..., "attempt", ...)`;
  `proctorAccess` becomes `admin_only` (the scoped gate is retained).

### G3 — Incident routes have no Incident→Exam resolver

- **file/symbol:** `apps/api/src/routes/incidents.admin.ts` (all 11 routes,
  flat `requireCapability`); no incident resolver file exists.
- **current behavior:** `/admin/incidents/:incidentId/*` rely on
  handler-level `repo.findById(ctx, incidentId)` returning null for
  cross-org incidents (`NotFoundError` → 404). The exam linkage is stored
  on the incident row but **not** consulted by any scope resolver.
- **risk:** if J4 grants `incident.view/investigate` to Proctor without a
  resolver, a Proctor could read/investigate any incident in the org by id.
  ADR-014 §13 assumed scoped routes; J3 shipped flat. J4-I1B must add an
  Incident→Exam resolver (or require the exam-scoped list routes and
  resolve single incidents through their exam) before any Proctor incident
  grant.

### G4 — Role revocation racing a resource request (general)

- **file/symbol:** `apps/api/src/authz/assignmentAuthority.ts`;
  `apps/api/src/plugins/auth.ts:128-162`.
- **current behavior:** authority is re-resolved **per request** from
  `user_role_assignments`. There is no JWT-capability cache. So role
  revocation is effective on the next authenticated request — **good**.
- **residual risk:** a request already past `authenticate` but not yet
  past the capability gate could in principle complete after a concurrent
  revocation. In practice the gate runs in `preHandler` before the handler,
  so the window is sub-request. This is acceptable and matches ADR-010
  §3.9. **No gap for role revocation per se.**
- **J4 concern:** Exam-assignment revocation must follow the same
  per-request model — ADR-015 §6.10 freezes "revocation applies to all
  future authorization decisions immediately", which the per-request load
  model already satisfies.

### G5 — Exam-assignment revocation racing a resource request (new, J4)

- **file/symbol:** *(does not exist yet — `exam_proctor_assignments`)*.
- **current behavior:** n/a.
- **risk:** once J4-I1 adds assignment rows, revoking an assignment must
  block the next request. Because authority is loaded per request, the
  assignment check must be in the **same per-request path** as the
  capability check (not a separate JWT-cached claim). ADR-015 §6.10 +
  §10 (resolver runs in `preHandler`) freezes this. If J4-I1 caches
  assignments in the JWT, revocation would lag until session refresh —
  **forbidden**.

### G6 — Admin represented as fake Proctor assignment rows

- **file/symbol:** *(design risk for J4-I1)*.
- **current behavior:** n/a.
- **risk:** a tempting J4-I1 shortcut is to seed an
  `exam_proctor_assignments` row for every (Admin, Exam) so the resolver
  treats Admin and Proctor uniformly. This is forbidden by the recovery
  jobs doc §13 ("Admin authority is not implemented by fake Proctor
  assignments") and by ADR-010 (Admin is the compatibility superset at
  organization scope). ADR-015 §6.2 freezes "Admin does not require fake
  exam assignment rows" and the resolver must short-circuit Admin
  (§6.3 — assignment is a Proctor-only condition).

### G7 — 403/404 enumeration leakage

- **file/symbol:** `apps/api/src/authz/scopedCapability.ts:127-156`;
  `apps/api/src/authz/resolvers/attemptResolver.ts:54-119`.
- **current behavior:** the scoped preHandler maps
  `resource_not_found` → **404** (anti-enumeration: a missing resource is
  indistinguishable from "not yours"), and `organization_mismatch` /
  `ownership_mismatch` / `broken_parent_chain` → **403** (indistinguishable
  from a capability denial). This is the existing house policy
  (ADR-010 §3.9) and is sound.
- **risk:** the **flat** routes in §4.4 (G2, G3) do not get this treatment
  — they rely on handler `NotFoundError`/null returns. Inconsistent. J4-I1B
  must route incidents and the flat attempt routes through the scoped
  preHandler so the 403/404 policy is uniform. ADR-015 §6.9 freezes the
  policy: "missing or outside resource scope → 404 RESOURCE_NOT_FOUND;
  has scope but lacks capability → 403 FORBIDDEN".

### G8 — Duplicate assignment / concurrent assign-revoke (new, J4)

- **file/symbol:** *(does not exist yet)*.
- **current behavior:** n/a.
- **risk:** two concurrent `assignProctorToExam` for the same (exam,
  proctor), or assign racing revoke, could create two active rows or a
  half-revoked state. ADR-015 §6.7 freezes the unique arbiter
  (`UNIQUE (organization_id, exam_id, proctor_user_id) WHERE status =
  'active'`-style partial unique, mirroring the
  `user_role_assignments_active_primary_unique` precedent) and the
  recovery flow (rollback → fresh-transaction query → replay/conflict),
  matching ADR-014 §9.

### G9 — Assignment/role inconsistency (new, J4)

- **file/symbol:** *(design risk for J4-I1)*.
- **current behavior:** n/a.
- **risk:** a Proctor loses the Proctor role but keeps active
  `exam_proctor_assignments`. ADR-015 §6.12 freezes: assignment row may
  remain as the resource relationship, but runtime requires **both**
  active role AND active assignment. Role revocation does not auto-revoke
  the assignment (decoupled lifecycles); the assignment simply stops
  authorizing until the role is restored.

### G10 — Historical audit readability after revocation

- **file/symbol:** `audit_logs` (general); incident history
  `exam_incident_events` (ADR-014).
- **current behavior:** audit rows are immutable and org-scoped;
  `audit_log.view` remains Admin-granted. Incident history is append-only.
- **risk:** none for reads — revoked Proctors cannot read because they lose
  the capability, but Admin can still read the full history. ADR-015 §6.14
  freezes audit actions `exam.proctor_assigned` /
  `exam.proctor_revoked` with the standard payload.

### G11 — Disabled user

- **file/symbol:** `apps/api/src/plugins/auth.ts:111-115`
  (`if (!user?.isActive) → 401`).
- **current behavior:** disabled users are rejected at `authenticate`
  before any capability/assignment check.
- **risk:** none — disabled users cannot reach the resolver. Assignment
  rows for a disabled user are inert.

### G12 — Organization mismatch

- **file/symbol:** resolver chain
  `apps/api/src/authz/resolvers/attemptResolver.ts:96-105`;
  `assignmentAuthority.ts:143-150` (subject-mismatch fail-closed).
- **current behavior:** every resolver checks the full chain's
  `organizationId === ctx.organizationId`; the authority kernel rejects
  cross-org rows. Single-tenant: only the internal default org exists.
- **risk:** none for the existing exam/attempt resolvers. J4-I1's
  assignment table must carry `organizationId` and the assignment resolver
  must apply the same org check (ADR-015 §6.8 — tenant-scoped,
  server-derived, fail-closed).

---

## Summary reality verdict

```text
Identity:        Proctor preset exists; assignment is ORG-WIDE only (no resource scope).
Permissions:     Proctor holds ExamRoomView, AttemptStatusView, AttemptTimelineView,
                 AttemptMisconductMark, AttemptForceSubmit — all org-wide and ACTIVE
                 (assignable + loginAllowed + per-request load). The "deferred/inactive"
                 framing is withdrawn: this is a current, reachable grant set.
                 Proctor holds ZERO incident.* permissions (ADR-014 boundary holds).
                 AttemptTimeGrant is Admin-only by design.
Resolvers:       exam + attempt resolvers exist and are sound (org + chain).
                 NO Incident→Exam resolver. NO Proctor-assignment resolver.
Routes:          4 /proctor routes scope only to org+chain, NOT to assignment.
                 misconduct + force-submit + timeline are FLAT (registry lies).
                 all 11 incident routes are FLAT.
                 POST /admin/attempts/:attemptId/proctor-incident is scoped but writes
                 an audit-only ProctorIncidentMarked marker — NOT createExamIncident().
Assignment:      NONE. No exam_proctor_assignments, no scope columns, no staff tables.
Security gaps:   G1 (ACTIVE LATENT — Proctor org-wide monitor, reachable today),
                 G2 (ACTIVE LATENT — flat sensitive routes, reachable today),
                 G3 (no incident resolver), G5/G8/G9 (new-J4 concurrency/decoupling),
                 G6 (fake-Admin-assignment shortcut must be refused),
                 G7 (403/404 uniformity requires scoped preHandler on all sensitive routes).
```

J4-I1 must therefore: (a) add the two-table `exam_proctor_assignments` +
`exam_proctor_assignment_events` persistence; (b) add a Proctor-assignment
enforcement layer into the per-request authority/resolver path; (c) add an
Incident→Exam resolver; (d) flip the flat sensitive routes (`misconduct`,
`force-submit`, `timeline`, incident family) to `requireScopedCapability`;
(e) **remove `AttemptForceSubmit` + `AttemptMisconductMark` from the
Proctor preset** (closing the current G1/G2 risk) and make the legacy
`proctor-incident` route Admin-only + deprecated; (f) only then activate
any new Proctor incident grant. ADR-015 freezes the contract for all six;
it must not let J4-I1 activate permissions before (a)–(e) land.
