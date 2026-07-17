# RBAC Job Queue — Phase 3 Scoped RBAC

> **Currency note (2026-07-01).** This file was originally the execution tracker
> for the foundation PR on `feat/phase3-scoped-rbac`. The foundation (jobs 0–8),
> the M7/M8/M9 multi-role work (job 10), and SYSTEM-M1 have all since been
> **merged to `master`** (PR #149–#153, #157, plus the `phase3-enforcement`
> series). The original "STOP at job 9" gate was resolved — enforcement
> proceeded. This file is **retained as the per-job history + current-gap
> tracker**; the authoritative current status now lives in
> `docs/phase3/plan.md` §0/§3/§5. The single remaining open item is
> **RBAC-M10-finish** (wire scope resolvers into the request path; flip the
> remaining ~50 `requireRole` routes).
>
> **Purpose.** Single source of truth for the Phase 3 Scoped RBAC rollout progress.
> One ADR (`adr-scoped-rbac-architecture.md`) is the design authority; this file
> is the **execution tracker**. Each Middle Job below is committed individually on
> `feat/phase3-scoped-rbac`. When every job is done this file is deleted; while work
> remains it is the handoff base for the next session.
>
> **ADR:** `docs/phase3/rbac/adr-scoped-rbac-architecture.md`
> **TDD:** vertical slices (one test → minimal impl → next test). GREEN before refactor.
> **Conventions:** new leaf `packages/authz`; `*.test.ts`; intra-pkg `./x.js`; cross-pkg `@exam/...`.

## Global invariants (must hold across every job)

- **RBAC ≠ state machine.** Every sensitive transition = permission + state guard + audit (ADR cross-cutting invariant + §22.3).
- **Never fail open.** Permission denied = 403; AuthZ unavailable / broken chain = 503 or deny (ADR §3.9).
- **Organization anchor is explicit.** Every sensitive resolver verifies `resource.organizationId === ctx.organizationId` (ADR §3.4).
- **Backend is authority.** Frontend capability state is a render hint only (ADR §3.5).
- **No Redis as AuthZ authority. No external policy library. No audit-action rename.** `users.role` stays as a compatibility cache during migration.

## Status legend

- `[ ]` not started · `[~]` in progress · `[x]` done (committed) · `[!]` blocked/needs confirm

## Job queue

> Original execution order on `feat/phase3-scoped-rbac`. The `Merged?` column
> reflects `master` state as of 2026-07-01.

| # | Job | Type | This PR | Risk | Status | Merged? |
| --- | --- | --- | :---: | :---: | --- | :---: |
| 0 | Tracking doc (this file) | scaffold | ✅ | low | [x] | ✅ #149 |
| 1 | **RBAC-M1** Permission catalog constants + `packages/authz` leaf + legacy map + arch lint | additive | ✅ | low | [x] | ✅ #150 |
| 2 | **RBAC-M2** Role preset matrix (mirrors ADR §Role→Permission) | data, no enforce | ✅ | low | [x] | ✅ #150 |
| 3 | **AUDIT-M1** AuditAction constants + `recordAudit` boundary validation (no rename) | boundary check | ✅ | low | [x] | ✅ #150 |
| 4 | **RBAC-M3** Scope resolver interfaces + ownership-chain integrity rules | interfaces+contract | ✅ | medium | [x] | ✅ #150 |
| 5 | **RBAC-M4** Route permission registry + coverage test (no enforcement) | metadata+test | ✅ | medium | [x] | ✅ #150 |
| 6 | **RBAC-M6** Admin compatibility superset mapping | preset update | ✅ | medium | [x] | ✅ #150 |
| 7 | **RBAC-M5** Shadow permission mode (non-blocking) | dual-run, no block | ✅ | low | [x] | ✅ #150 |
| 8 | **AUDIT-M2** Sensitive-read audit events (`grading.detail_viewed`, `user.role_changed`) | add audit | ✅ | low | [x] | ✅ #150 |
| 9 | **STOP** confirm before enforcing: RBAC-M10 / PROCTOR-M1 / GRADING-M1 / SYSTEM-M1 | flips real gates | ⏸️ | high | **resolved** — go/no-go happened; enforcement proceeded (see rows 11–16) | ✅ |
| 10 | RBAC-M7 schema / RBAC-M8 assignment API / RBAC-M9 frontend nav | schema + UI | ❌ separate PR | high | [x] | ✅ #153 |
| 11 | **SYSTEM-M1** — scanners use `System` role instead of synthetic `Admin` (`createSystemRequestContext`) | additive | — | medium | [x] | ✅ #151 |
| 12 | **M10-Step1** Runtime `Role` widened to 6 presets (`Admin/Teacher/Proctor/Grader/Candidate/System`) + login path | widening | — | medium | [x] | ✅ enforcement PRs |
| 13 | **M10-Step2** `requireCapability` decorator (flat role-preset membership; resolvers layered later) | decorator | — | medium | [x] | ✅ enforcement PRs |
| 14 | **M10-Step3** `createAttemptResolver` + `createExamResolver` (org-anchor + fail-closed) | resolver impl + tests | — | medium | [x] | ✅ enforcement PRs |
| 15 | **PROCTOR flip** — `proctorMonitoring.ts` (×2) flipped to `requireCapability` | route flip | — | high | [x] | ✅ enforcement PRs |
| 16 | **GRADING flip** — `gradingQueue.ts` (×3) + `attempts.admin.ts` (×6) flipped to `requireCapability`; permission-matrix test + swagger stub | route flip | — | high | [x] | ✅ enforcement PRs |
| 17 | **RBAC-M10-finish** — wire scope resolvers into the `requireCapability` request path; flip remaining ~50 `requireRole` routes per-domain | resolver wiring + route flips | ❌ future PRs | high | **[ ] open** — see "Current real gap" below | ❌ |

## Final review — APPROVED (foundation PR only)

> **Scope of this verdict:** the foundation PR on `feat/phase3-scoped-rbac`
> (jobs 0–8). The enforcement flips (rows 11–16) and SYSTEM-M1 were separate
> PRs with their own review. The foundation-PR verdict is retained below for
> history.

Independent reviewer verdict: **APPROVE** — 58/58 tests, typecheck/lint clean, no security/logic issues. Three non-blocking suggestions; all three are deferred to the relevant follow-up jobs (not this foundation PR) to avoid scope creep / regression risk on an already-approved additive PR:

- **#1 `gradingQueue.ts` direct `createAuditLogRepo().create()` bypasses `recordAudit`** → real consistency gap (bypasses `ipAddress`/`userAgent` enrichment). **Deferred to GRADING-M1.** Note: these call sites intentionally `await` the audit (deterministic test contract); the correct fix is an awaitable `recordAudit` variant, not a swap — that's design work belonging to the grading enforcement job, not this foundation. (The bypassed `isTestLike` gate is a non-issue here: `grading.score_entered` / `grading.finalized` are in the catalog, so they pass even in prod.)
- **#2 `legacyMap` undefined guards** → defense-in-depth nit; TS already enforces completeness. Deferred.
- **#3 `KNOWN_PRODUCTION_AUDIT_ACTIONS: readonly string[]` → `readonly AuditActionKey[]`** → reasonable drift-detection tightening; deferred (low value — the test already asserts every entry ∈ `AuditAction`).

## Current real gap (as of 2026-07-01) — RBAC-M10-finish

Everything above rows 0–16 is merged. The **only** remaining RBAC work is row 17
(RBAC-M10-finish). It has two distinct parts:

1. **Wire scope resolvers into the request lifecycle.** Today `requireCapability`
   (`apps/api/src/plugins/auth.ts`) checks only flat role-preset membership — it
   never consults `createAttemptResolver` / `createExamResolver`. Those resolvers
   exist and are unit-tested (`apps/api/src/authz/resolvers/attemptResolver.ts` +
   `.test.ts`) but are **not constructed or invoked by any Fastify plugin, hook,
   decorator, or route** (verified: zero call sites outside `resolvers/` and
   tests). So on the 11 flipped routes, "Scoped RBAC" is at runtime a flat
   6-role-preset gate; the scope/ownership/own-attempt boundary is not enforced
   by the capability check.
2. **Flip the remaining ~50 legacy `requireRole` routes** to `requireCapability`,
   per-domain, each behind shadow-parity verification for that domain. Route
   families still on `requireRole`: `user.ts`, `system.ts`, `settings.ts`,
   `scores.ts`, `roleAssignments.ts`, `question.ts`, `importLogs.ts`, `export.ts`,
   `exam.ts` (~16 endpoints), `email.ts`, `course.ts`, `candidateField.ts`,
   `audit.ts`, `attempts.candidate.ts` (×9), `candidate.ts`.

**Why this is Middle, not Large:** the design (ADR + permission matrix + scope
model + resolver contract) is accepted and merged. M10-finish is incremental
wiring + per-domain route flips with shadow parity, not new architecture. It
should be decomposed into per-domain Middle Jobs (e.g. flip `user.*` routes,
flip `exam.*` routes, wire attempt-scope into the candidate-runtime routes) and
merged independently.

**Guardrails for M10-finish:**
- Every domain flip must first run shadow parity for that domain (legacy vs
  capability disagreements logged, legacy stays authoritative until the flip).
- Resolvers must verify the ADR §3.4 organization anchor on every sensitive
  resource and fail closed (ADR §3.9) on broken parent chains / not-found.
- `users.role` stays the compatibility cache; keep it synced via
  `syncUsersRoleFromPrimary` on every primary-active assignment change.

## RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1 — ✅ done (2026-07-17)

Code-review corrective that closed four findings on the proctor-landing PR.
Disposition + authority reconstruction recorded here for traceability.

**#1 ACCEPTED** — `GET /scores/attempts/:attemptId` migrated off
`requireRole(["Candidate","Admin"])` to a capability-driven scoped gate:
- New `resolveScoreScope` (`apps/api/src/authz/resolvers/scoreResolver.ts`)
  implements ADR §Resource Resolver Matrix row `score` (→ attempt → candidate +
  exam; source of truth: attempt ownership). Returns ownership facts
  (`candidateId`, `ownerUserId = candidateProfiles.userId`) on success.
- New `buildScoreCapabilityPreHandler` (`apps/api/src/authz/scoreCapability.ts`)
  arbitrates `score.all.view` (any same-org attempt) vs `score.own.view` +
  owner-is-actor from the role preset — **no role-name branching**. Own/all is
  resolved from capability + ownership fact only.
- Wired into `plugins/authz.ts` as `fastify.requireScoreCapability()`; swagger
  stub added (`openapi/swagger.ts`).
- `findVisibleAttempt` simplified to an org-scoped fetch (the resolver is now
  the primary boundary); `computeResultVisibility` (publication gate) is
  **unchanged** — authorization vs publication visibility remain separate
  concerns (ADR §262/691/697).
- Anti-enumeration preserved: cross-candidate (own-view holder, not owner) →
  **404** (not 403); cross-org → resolver `resource_not_found` → 404; genuine
  capability denial (Grader/Proctor) → 403.

**#2 ACCEPTED** — three proctor routes migrated from preset-only
`requireCapability` to `requireScopedCapability`:
- `GET /admin/exams/:examId/proctor/attempts` → `(ExamRoomView, "exam", "examId")`
- `GET /admin/attempts/:attemptId/proctor-events` → `(AttemptTimelineView, "attempt", "attemptId")`
- `POST /admin/attempts/:attemptId/proctor-incident` → `(AttemptMisconductMark, "attempt", "attemptId")`
- `GET /admin/proctor/exams` stays `requireCapability` (registry
  `resolver: "organization"` is context-only — no DB resolver needed).
- This closes the routeRegistry/runtime drift (#5): runtime middleware now
  matches the registry declarations for all four proctor routes.
- Handler-level `findById` cross-org→404 checks remain as defense-in-depth.

**#3 ACCEPTED** — `canSeeManagement` (`apps/web/src/lib/capabilities.ts`) no
longer short-circuits on `isAdmin(user)`. It is now an aggregate over the
management-surface permission set (UserView, AuditLogView, SettingsView,
SystemHealthView, CandidateFieldView). No single permission is anointed as
"the management gate" (ADR §158 names "all organization-scope management
perms" as a group). `CandidateView` is intentionally excluded (Teacher also
holds it, scoped to course assignment — it is not a management-surface grant).
`isAdmin`/`isCandidate` remain as coarse role-class helpers elsewhere.

**#4 REJECTED** — the finding "Exam enters after_grading and disappears from
the Proctor workspace" is a category error. `after_grading` is a
`ResultPublicationMode` (result-visibility policy), NOT an `ExamStatus`
(lifecycle status). An exam cannot "enter after_grading."
`listProctorDiscoverable` filters `ExamStatus` (`published/open/closed`),
matching the frontend `ProctorWorkspacePage.STATUS_FILTERS` exactly. No
production change; orthogonality is now pinned by a contract test
(`packages/contracts/src/examStatusOrthogonality.test.ts`) asserting the three
enums are disjoint and `after_grading` appears only in `ResultPublicationMode`.

**Tests added:** scoreCapability (19) + scoreResolver (6) + score-route
Grader/Proctor denial (2) + proctor matrix incident row + registry-runtime
conformance (4) + capabilities aggregate (3) + ExamStatus orthogonality (8).
Full suite: 1116 passed / 5 skipped. `pnpm verify` green.

## RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-2 — ✅ done (2026-07-17)

Code-review corrective closing Finding 2 (Routes 2/3 scoped-gate regression
protection) on PR #186. Disposition:

**Finding 1 — Broken-parent HTTP construction**
NON-BLOCKING. FK constraints prevent persistent missing-parent chains in
production. Resolver/preHandler unit tests cover the fail-closed logic.

**Finding 2 — Scoped-gate regression protection**
CLOSED.

Route 1 is protected behaviorally: replacing `requireScopedCapability` with
`requireCapability` changes a cross-organization request from 404 to 200 with
an empty result — the HTTP + DB integration test fails.

Routes 2 and 3 retain handler-level tenant filtering, so their externally
observable cross-organization result remains 404 after such a downgrade.
They are therefore protected structurally. Both capability decorators attach
immutable authorization metadata (`authz`) to their preHandler functions,
and a Fastify `onRoute` hook captures the metadata from real runtime route
registration.

The tests assert, per route: authz kind, permission, resolver key, and
resource parameter key — a full `toEqual({ kind, permission, resolverKey,
resourceIdKey })` on the captured metadata.

**Mutation experiments:**
- Mutation B (Route 1): KILLED — behavioral (404 → 200)
- Mutation B2 (Route 2): KILLED — metadata (`"scoped"` → `"flat"`)
- Mutation B3 (Route 3): KILLED — metadata (`"scoped"` → `"flat"`)

**Finding 3 — Permission matrix fake IDs**
NON-BLOCKING PRE-EXISTING TEST DEBT. The matrix proves capability-stage
passage, not real resource access.

**Finding 4 — `canSeeManagement` frontend UX hint**
NON-BLOCKING SECURITY-WISE. Backend remains the authorization authority.

**Verdict:**
```
RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-2:
PASS WITH NON-BLOCKING FINDINGS

FOUR-ROUTE SCOPED CORRECTIVE:
CLOSED

GLOBAL RBAC-M10-FINISH:
OPEN
```

## Acceptance per job (filled in as each lands)

### Commit 0 — Tracking doc
- Created `docs/phase3/rbac/RBAC-JOB-QUEUE.md`.

### RBAC-M1 — ✅ done
- Delivered: `packages/authz` leaf (package.json/tsconfig/vitest.config, `@exam/domain` dep); `src/{catalog,legacyMap,index}.ts`; arch-lint rule added to `scripts/check-architecture.mjs` locking authz to a true leaf (no fastify/React/Drizzle, only `@exam/domain`).
- Catalog: full dotted `PermissionKey` (9 groups), `ScopeType`, `RoleKey` (6 presets), `AuditAction` (new dotted keys only — legacy union owned by AUDIT-M1).
- Legacy map: all 22 `SCREAMING_SNAKE` perms 1:1 mapped; dead `MANAGE_ORGANIZATION`→`organization.update`; 4 proctor-trap keys mapped; `Admin`/`Candidate` roles mapped.
- Tests: 15 passing (shape, closed-union integrity, legacy 1:1 coverage, dead-perm + trap mappings, candidate-own mapping, role map).
- Commands: `pnpm --filter @exam/authz test` ✅ 15/15 · `pnpm --filter @exam/authz typecheck` ✅ · `pnpm --filter @exam/authz build` ✅ · `pnpm verify:static` ✅.

### RBAC-M2 — ✅ done
- Delivered: `packages/authz/src/presets.ts` — `ROLE_PRESETS` + `permissionsForRole(role)` mirroring ADR §Role Presets / §Role→Permission Matrix. Each preset carries key/label/purpose/isSystem/assignable/loginAllowed/defaultScope/permissions/sensitivePermissions.
- Matrix boundaries encoded (ADR §7 review checklist, all 8): Admin compat superset (4 proctor + grading, no Candidate-own, no SYS-only); Teacher not Grader/Proctor; Proctor cannot grade/answer/publish; Grader grades but cannot publish/finalize/identity; Candidate own-scope; System non-login/non-assignable/SYS-only.
- Tests: 24 preset tests (shape, all 8 boundaries, integrity: every grant is a known catalog value with no dupes).
- Commands: `pnpm --filter @exam/authz test` ✅ 39/39 · `pnpm verify:static` ✅.

### AUDIT-M1 — ✅ done
- Delivered: `packages/authz/src/auditActions.ts` — closed `AuditAction` union (all real `recordAudit`/`createAuditLogRepo` actions captured via rg, **no rename** — keeps `attempt.forceSubmit`/`grading.score_entered` camelCase per ADR "Naming collision guard"; adds the 2 ADR-mandated new actions `grading.detail_viewed`/`user.role_changed`). Helpers: `isAuditAction`, `assertAuditAction`, `KNOWN_PRODUCTION_AUDIT_ACTIONS` (rg-derived regression fixture).
- Wired: `apps/api/src/routes/audit.ts` `recordAudit` now validates the action via the closed set; unknown actions are error-logged and the write is skipped (fail-loud, ADR §3.9) without breaking fire-and-forget semantics.
- Moved `AuditAction`/`AuditActionKey` ownership from `catalog.ts` (M1) to `auditActions.ts` (AUDIT-M1) — single source of truth; barrel re-exports both.
- Added `@exam/authz` dep to `@exam/api`.
- Tests: 8 audit-action tests (shape, no-rename invariant, ADR new actions, full production coverage, guards). Total authz: 47/47.
- Commands: `pnpm --filter @exam/authz test` ✅ · `pnpm --filter @exam/api typecheck` ✅ · `pnpm verify:static` ✅.

### RBAC-M3 — ✅ done
- Delivered: `packages/authz/src/resolver.ts` — `ResolverContext`, `ResourceType`, `ResourceRef`, `ResolverKey`, `ResolvedScope`, `DeniedScope`, `DenyReason`, `DENY_REASONS`, `isScopeDenied`, and the `ScopeResolver` interface. Pure implementations: `resolveSystemScope`, `resolveOrganizationScope` (no DB). Resource-aware resolvers are interfaces only — implemented by RBAC-M10/PROCTOR-M1/GRADING-M1.
- Integrity contract encoded as code comments + the `DenyReason` vocabulary (`organization_mismatch`, `broken_parent_chain`, `resource_not_found`, `ownership_mismatch`, `resolver_error`) — the surface enforcement jobs build against (ADR §22.1, §3.4, §3.9). Frozen vs mutable parent links documented; org-anchor rule explicit.
- `isScopeDenied` widened to accept `unknown` so callers passing loosely-typed resolutions still narrow (robust against literal-`true` inference).
- Tests: 5 resolver tests (system/org pure resolution, deny identification, success-vs-deny, deny-reason vocabulary). Total authz: 52/52.
- Commands: `pnpm --filter @exam/authz test` ✅ · `pnpm verify:static` ✅.

### RBAC-M4 — ✅ done
- Delivered: `apps/api/src/authz/routeRegistry.ts` — `RoutePermissionRegistryEntry` type (with ADR §3.3 `SingleResourceSpec | ListResourceSpec` extension reserved), `registryKeyFor`, and `ROUTE_PERMISSION_REGISTRY` covering **every** `requireRole(["Admin"|"Candidate"])` route in `apps/api/src/routes` (re-verified via rg). Encodes the ADR §8 special mappings: force-submit→`attempt.force_submit`@attempt+state-guard, extend-time, misconduct, grading-details→`grading.detail.view`+`grading.detail_viewed` audit, grade-question→`grading.score.write`, candidate own-score→`score.own.view`@own_score.
- **No enforcement** — registry is metadata only. RBAC-M5/M10/PROCTOR-M1/GRADING-M1 consume it.
- Tests: 11 (shape/invariants, all perms/scopes are known catalog values, unique keys, all 6 ADR §8 special mappings, **full coverage of all ~70 protected routes**). Coverage test is the RBAC-M4 acceptance gate.
- Commands: `pnpm --filter @exam/api exec vitest run src/authz/routeRegistry.test.ts` ✅ 11/11 · `pnpm --filter @exam/api typecheck` ✅ · `pnpm verify:static` ✅.

### RBAC-M6 — ✅ done
- Delivered: hardened the Admin preset (already a superset from RBAC-M2) with two formal guarantees:
  - **authz**: `packages/authz/src/adminCompatibility.test.ts` — Admin holds every Admin-route permission (incl. the 4 formerly-missing proctor trap perms + grading); Admin holds NO Candidate-own and NO System-only perms; Admin default scope = organization; last-admin guard contract (Admin assignable+login; System does not count).
  - **api**: `apps/api/src/authz/adminSuperset.test.ts` — cross-checks the route registry: **every Admin-gated route's permission is granted to Admin** (the migration-trap guard, ADR Problem #3 / §9), and no Candidate-own perm is mis-gated as Admin. This catches future registry↔preset drift.
- No preset code change needed (M2 already encoded the superset); M6 = the formal proof + drift guard.
- Tests: 6 authz + 2 api. Total authz: 58/58; api authz suite: 13/13.
- Commands: `pnpm --filter @exam/authz test` ✅ · `pnpm --filter @exam/api exec vitest run src/authz/` ✅ · `pnpm verify:static` ✅.

### RBAC-M5 — ✅ done
- Delivered: `apps/api/src/authz/shadow.ts` — `shadowRequireCapability(input, logger)`. Evaluates legacy (`requireRole`) + capability (preset/flat-perm check) side-by-side; **legacy stays authoritative** (decision always mirrors `legacyAllowed`); mismatches logged as structured warnings (`event: authz.shadow.mismatch`), never thrown (ADR §10.3). Resource id logged as opaque sha256 hash (ADR §10.6/§3.8 — no candidateAnswer/PII). Logger is injectable (`ShadowLogger`) for testability.
- **Not wired to any route** — wiring is RBAC-M10's job. Shadow helper + tests only.
- Capability side = Phase 1 flat preset/permission check; RBAC-M10 swaps in resolver-backed capability without changing shadow's contract.
- Tests: 5 (legacy authoritative allow/deny, mismatch recorded but not blocking, never throws, sensitive-resource log hygiene). API authz suite total: 18/18.
- Commands: `pnpm --filter @exam/api exec vitest run src/authz/` ✅ · `pnpm --filter @exam/api typecheck` ✅ · `pnpm verify:static` ✅.

### AUDIT-M2 — ✅ done
- Delivered: wired the two ADR-mandated sensitive-read/privilege-change audits:
  - `apps/api/src/routes/gradingQueue.ts`: `GET /admin/attempts/:attemptId/grading-details` now emits `grading.detail_viewed` (was unaudited — ADR §7.2 gap). Metadata = opaque ids only (`examId`, `candidateId`); **never** the `candidateAnswer` payload (ADR §3.8).
  - `apps/api/src/routes/user.ts`: `PATCH /users/:id` now additionally emits `user.role_changed` (with `oldRole`/`newRole`) when the role actually changes — privilege change gets its own sensitive audit (ADR §11.5), alongside the existing `user.update`.
- **Catalog completion (fixes AUDIT-M1 oversight):** the original AUDIT-M1 `rg` was single-line and missed ~16 multi-line `recordAudit(...)` actions (`candidate.password_reset`, `branding.update`, `enrollment.add/remove`, `login.success/failure`, etc.). This silently dropped those audit rows via the closed-set gate. Re-scanned with multiline `rg` and completed `AuditAction` + `KNOWN_PRODUCTION_AUDIT_ACTIONS` to cover **all 52** real actions. This restored the previously-failing `user.test.ts` (candidate.password_reset) and reduced `audit.test.ts` failures from 6 → 1.
- Tests: authz 58/58; api authz suite 18/18; `user.test.ts` 18/18 ✅; `gradingQueue.test.ts` 18/19 (1 pre-existing, fails identically on clean baseline — `lists an attempt in the grading queue`, worker-DB data ordering, unrelated to RBAC); `audit.test.ts` 14/15 (1 pre-existing date-range flake).
- Commands: `pnpm --filter @exam/authz test` ✅ · `pnpm --filter @exam/api typecheck` ✅ · `pnpm verify:static` ✅.

## Stop point (job 9) — RESOLVED

> The original "pause after jobs 1–8 + AUDIT-M1/M2 + M5 shadow, surface shadow
> parity, get go/no-go" gate is **resolved**: shadow parity was reviewed, the
> go decision was made, and enforcement proceeded (SYSTEM-M1 #151, M7/M8/M9
> #153, and the `phase3-enforcement` series flipping proctor + grading +
> attempts-admin routes — rows 11–16). The current open work is row 17
> (RBAC-M10-finish), described in "Current real gap" above.

Historical context of the original gate: after jobs 1–8 + AUDIT-M1/M2 + M5
shadow were green, the plan was to pause and surface to the user:
- shadow parity results (legacy vs capability disagreements),
- residual risks for flipping `requireRole → requireCapability`,
- explicit go/no-go for RBAC-M10 / PROCTOR-M1 / GRADING-M1 / SYSTEM-M1.

## Notes / decisions log

- **RBAC-M1 naming depth**: ADR §4 deliberately mixes 2-segment (`user.view`) and 3-segment (`attempt.force_submit`) dotted keys. The closed-union test asserts `>= 2 segments` + lowercase, not a fixed depth — matches ADR.
- **RBAC-M1 `MANAGE_CANDIDATE_FIELDS`**: legacy coarse grant maps to `candidate_field.create` as the closest single new key; the full 4-way split is expressed by role presets (RBAC-M2), not the 1:1 legacy map.
- **RBAC-M1 arch lint**: added `packages/authz/src` forbid block (no fastify/React/Drizzle; only `@exam/domain`) to enforce the ADR "leaf" contract structurally.
- **AUDIT-M1 ownership**: `AuditAction`/`AuditActionKey` moved from `catalog.ts` to `auditActions.ts` (single owner of the audit union); `catalog.ts` keeps Permission/Scope/Role only.
- **AUDIT-M1 fail mode**: `recordAudit` is fire-and-forget, so unknown actions are logged + skipped (not thrown), preserving caller semantics while failing loud in observability.
- **AUDIT-M1→AUDIT-M2 catalog completion**: original single-line `rg` missed ~16 multi-line `recordAudit(...)` actions; the closed-set gate silently dropped those rows. AUDIT-M2 re-scanned multiline and completed the catalog to all 52 real actions. Lesson: audit-action inventories must be multiline-scanned.
- **Post-review catalog fix (commit 9)**: a *second* class of missed actions — dynamically-constructed `exam.${transition}` from `reconciliation.ts` (`exam.open`, `exam.closed`) — was dropped by the gate and broke `examTransitions.test.ts` (8 failures). Added both to the catalog. Re-scanned confirms the closed set now covers every static + dynamic audit action. `examTransitions` 14/14.
- **`recordAudit` param stays `string`**: callers pass dynamic reconciliation strings (`exam.${transition}`), so the param cannot be the closed `AuditActionKey` union. Validation happens inside `recordAudit` via `isAuditAction`; the param stays `string` by design (review #3 — intentional, not a defect).
- **Shadow `actorId` hashed (review #5)**: `ShadowResult.actorId` → `actorIdHash` (sha256 prefix); the file's own hygiene rule now applies to the actor id too.
- **`system_diagnostics` resolver key (review #2)**: added to `ResolverKey` for consistency with `ResourceType`.
- **Review claims rejected (verified false)**: #1 (`ExamResultPublish` "missing") — it exists at `catalog.ts:69`; presets compile and tests pass. #4 (`isScopeDenied` reason validation) — over-engineering; the `DeniedScope` shape already guards runtime.
- **AUDIT-M1 gate test-fixture regression (commit 11, root cause of `audit.test > date-range` timeout)**: the closed-set gate rejected **synthetic test-fixture actions** (`range.t0` … `range.t3` seeded by `audit.test.ts` to verify date-range filtering), silently dropping the rows → `waitForAudit` spun until the 5s timeout. Earlier "pre-existing" claim was wrong (the baseline I stashed against already contained AUDIT-M1). **Fix:** the gate now runs only in non-test-like runtimes (`getRuntimeConfig().app.isTestLike`), so production stays strict (ADR §3.9 fail-loud) while test fixtures may seed arbitrary actions. This is the SOTA pattern for compliance-bound audit sinks (cf. GitLab/K8s audit-event-type validation, enforced at the sink in prod only) — researched via web search (Context7 MCP was not wired into this session). Confirmed: `vitest.shared.ts` forces `APP_MODE=test`, so `isTestLike` is true under vitest. Full api suite now 775/0/5.
- **DB pollution (operator, not code)**: 54 stale `exam_test_w*` worker databases had accumulated from prior E2E/test runs, causing the `gradingQueue > lists in queue` contention failure. Dropped them; that test now passes. Not a code issue, but worth a periodic cleanup.
