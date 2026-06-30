# RBAC Job Queue — Phase 3 Scoped RBAC

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

| # | Job | Type | This PR | Risk | Status | Commit |
| --- | --- | --- | :---: | :---: | --- | --- |
| 0 | Tracking doc (this file) | scaffold | ✅ | low | [x] | _commit 0_ |
| 1 | **RBAC-M1** Permission catalog constants + `packages/authz` leaf + legacy map + arch lint | additive | ✅ | low | [x] | _commit 1_ |
| 2 | **RBAC-M2** Role preset matrix (mirrors ADR §Role→Permission) | data, no enforce | ✅ | low | [x] | _commit 2_ |
| 3 | **AUDIT-M1** AuditAction constants + `recordAudit` boundary validation (no rename) | boundary check | ✅ | low | [x] | _commit 3_ |
| 4 | **RBAC-M3** Scope resolver interfaces + ownership-chain integrity rules | interfaces+contract | ✅ | medium | [x] | _commit 4_ |
| 5 | **RBAC-M4** Route permission registry + coverage test (no enforcement) | metadata+test | ✅ | medium | [x] | _commit 5_ |
| 6 | **RBAC-M6** Admin compatibility superset mapping | preset update | ✅ | medium | [x] | _commit 6_ |
| 7 | **RBAC-M5** Shadow permission mode (non-blocking) | dual-run, no block | ✅ | low | [ ] | — |
| 8 | **AUDIT-M2** Sensitive-read audit events (`grading.detail_viewed`, `user.role_changed`) | add audit | ✅ | low | [ ] | — |
| 9 | **STOP** confirm before enforcing: RBAC-M10 / PROCTOR-M1 / GRADING-M1 / SYSTEM-M1 | flips real gates | ⏸️ | high | [ ] | — |
| 10 | RBAC-M7 schema / RBAC-M8 assignment API / RBAC-M9 frontend nav | schema + UI | ❌ separate PR | high | [ ] | — |

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

### RBAC-M5 — _pending_
- Delivered: `apps/api/src/authz/shadow.ts`, legacy stays authoritative, logs only.
- Tests: mismatch recorded not blocking.

### AUDIT-M2 — _pending_
- Delivered: `grading.detail_viewed` / `user.role_changed` wired; metadata PII-free (ADR §3.8).

## Stop point (job 9)

After jobs 1–8 + AUDIT-M1/M2 + M5 shadow are green, **pause** and surface to the user:
- shadow parity results (legacy vs capability disagreements),
- residual risks for flipping `requireRole → requireCapability`,
- explicit go/no-go for RBAC-M10 / PROCTOR-M1 / GRADING-M1 / SYSTEM-M1.

## Notes / decisions log

- **RBAC-M1 naming depth**: ADR §4 deliberately mixes 2-segment (`user.view`) and 3-segment (`attempt.force_submit`) dotted keys. The closed-union test asserts `>= 2 segments` + lowercase, not a fixed depth — matches ADR.
- **RBAC-M1 `MANAGE_CANDIDATE_FIELDS`**: legacy coarse grant maps to `candidate_field.create` as the closest single new key; the full 4-way split is expressed by role presets (RBAC-M2), not the 1:1 legacy map.
- **RBAC-M1 arch lint**: added `packages/authz/src` forbid block (no fastify/React/Drizzle; only `@exam/domain`) to enforce the ADR "leaf" contract structurally.
- **AUDIT-M1 ownership**: `AuditAction`/`AuditActionKey` moved from `catalog.ts` to `auditActions.ts` (single owner of the audit union); `catalog.ts` keeps Permission/Scope/Role only.
- **AUDIT-M1 fail mode**: `recordAudit` is fire-and-forget, so unknown actions are logged + skipped (not thrown), preserving caller semantics while failing loud in observability.
