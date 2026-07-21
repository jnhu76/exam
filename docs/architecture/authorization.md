# Authorization Architecture

> Reconstructed from production code at the verified commit.

```text
STATUS:          CURRENT
AUTHORITY:        Architecture
SCOPE:            Authorization model, authz package boundary, route authorization
OWNER:            Architecture / Security
LAST VERIFIED:    2712c01 — reconstructed from packages/authz, apps/api/src/authz,
                  apps/api/src/plugins/authz.ts, route conformance tests
SUPERSEDES:       —
RELATED ADRS:     ADR-005 (exam operation state), ADR-006 (time authority audit)
```

## 1. Model

Authorization is a **permission + scope** model.

- **Permission** — a dotted-key capability (defined in `packages/authz/src/catalog.ts`).
  This is the single authority for "what permissions exist".
- **Scope** — the data boundary a permission applies to (organization, exam,
  course, candidate group, attempt, etc.).
- **Role** — a preset bundle of permissions (defined in
  `packages/authz/src/presets.ts`). Phase 1 product roles are **Admin** and
  **Candidate** only. Teacher-like / Proctor / Grader bundles are Phase 3.

Two runtime consumers share this language:

| Consumer | Use | Source |
|----------|-----|--------|
| `apps/api` | Runtime enforcement on every route via the authz plugin + scoped/scored capability resolvers | `apps/api/src/plugins/authz.ts`, `apps/api/src/authz/*` |
| `apps/web` | UI capability checks (show/hide actions) | `apps/web/src/lib/capabilities.ts` imports `Permission`/`PermissionKey` |

Web uses a **stateless, deterministic** capability function for UI gating only.
Runtime enforcement always happens server-side.

## 2. Boundary: `packages/authz`

`authz` is a **framework-agnostic permission language**. Verified facts:

- Internal deps: `@exam/domain` only.
- No `fastify`, `@fastify/*`, `drizzle-orm`, or `react` imports (verified by
  `rg`; enforced by `scripts/check-architecture.mjs`).
- Barrel `index.ts` re-exports: `catalog`, `legacyMap`, `presets`,
  `auditActions`, `resolver`, `systemActor`.

**Why it is a package, not folded into the API:** the same permission language
is consumed by both API (runtime enforcement) and Web (UI capability checks).
Folding it into the API would either (a) couple Web to the API package, or
(b) duplicate the permission catalog in Web. Keeping `authz` as a leaf-shaped
package preserves a single source of truth.

### Known dead / transitional code in `authz` (Wave 2 cleanup, not Wave 1)

- `legacyMap.ts` — migration bridge; **zero external callers** (verified by
  `rg`). Slated for deletion after migration confirmation.
- `packages/auth/src/rbac.ts` (note: in the `auth` package, not `authz`) —
  legacy `getPermissionsForRole`. **Zero production callers.** Kept in Wave 1
  only because M10-F re-verification is pending (scan review Gate 0.5). Do not
  delete in Wave 1.

## 3. Route authorization

Every route declares its authorization requirement. Two artifacts record this:

| Artifact | Location | Purpose | Status |
|----------|----------|---------|--------|
| Runtime enforcement | `apps/api/src/plugins/authz.ts` + scoped/scored capability resolvers in `apps/api/src/authz/` | Actual allow/deny decision per request | Live, authoritative |
| Route registry | `apps/api/src/authz/routeRegistry.ts` | Manually-maintained metadata table (1061 LOC) | **Test-only** — zero production importers; consumed by route-authorization conformance tests |

**Critical constraint on the route registry:** it is a manually-maintained
oracle, not auto-generated. Auto-generating the *expected* capability from
runtime metadata would create a circular proof (runtime says Permission A →
auto-generated says Permission A → test passes) and could not catch
"should-be-Permission-B" drift. Any future refactor must split the file into
an auto-generated route inventory + a manually-maintained policy table; it
must not collapse them. The registry must not be moved or rewritten in Wave 1.

## 4. Single-tenant data boundary

Phase 1.x is single-tenant, multi-user. The `organization` table and
`organizationId` columns are the **internal data boundary**; there is exactly
one organization (the internal default). Every repository method receives a
`ctx` that carries the resolved organization and actor. Repository code must
never be bypassed from routes (no bare `db.select()`).

Cross-tenant operations, `organizationSlug` login, tenant switcher, and
SuperAdmin are **Phase 4 platformization** and must not appear in current work.

## 5. What authorization is NOT

- It is not a CRUD permission matrix UI (Phase 3).
- It is not role invitation / lifecycle (Phase 3).
- It is not a proctor authority boundary. Proctor *visibility* and
  *incident recording* exist (lightweight); force-submit / extend-time /
  misconduct state mutation are deferred (source-documented at
  `apps/api/src/routes/proctorMonitoring.ts`).
- It is not the audit subsystem. Audit recording is a separate concern bound
  by ADR-006's audit durability contract (Atomic / Synchronous sensitive read /
  Active best effort / Domain-history exclusion).

## 6. Wave 1 boundary (what this doc does NOT authorize)

This document describes the current authorization architecture. It does **not**
authorize:

- Merging `authz` into `apps/api` (rejected by scan review §2.2).
- Deleting `packages/auth/src/rbac.ts` or `requirePermission` (blocked on
  M10-F re-verification — scan review Gate 0.5).
- Deleting Type 3 RBAC / permission-boundary tests (blocked on mutation
  evidence).
- Moving or rewriting `routeRegistry.ts`.

See `docs/roadmap/current.md` for the authorized next work.
