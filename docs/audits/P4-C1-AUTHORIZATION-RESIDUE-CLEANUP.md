# P4-C1 — Authorization Residue Cleanup and Regression Lock

> **Job:** `P4-C1 — Authorization Residue Cleanup and Regression Lock`
> **Type:** Cleanup + documentation + permanent regression lock.
> **Branch:** `feat/phase4-rbac`
> **Pre-C1 base commit:** `6711b2b` (`Merge pull request #207 …`)
> **Authority chain read first:** `AGENTS.md`,
> `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md` (§4.3, §11.3 P4-G-04..08,
> §13 P4-C1),
> `docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md` (PASS baseline),
> `docs/architecture/authorization.md`,
> `docs/adr/ADR-010-scoped-rbac-architecture.md`.
> **Depends on:** P4-V0 PASS (met on `f2a7a80`, re-verified `6711b2b`).

---

## 1. Objective

Remove only **proven-dead** migration residue, document intentionally retained
compatibility surfaces and reserved/unresolved capabilities, and add a
**permanent whole-application regression lock** against reintroducing
role-based route gates.

Gap Register items closed by this Job (P4-R0 §11.3):

```text
P4-G-04 — dead catalog permission ResultPublish (result.publish)
P4-G-05 — M11-reserved grading permissions documented
P4-G-06 — legacy RBAC residue removed / isolated
P4-G-07 — users.role compatibility projection documented
P4-G-08 — whole-app zero-requireRole regression assertion added
```

No live route, capability preset, role grant, frontend, schema, or migration
behavior was changed.

---

## 2. Modified files

| File | Change |
| --- | --- |
| `packages/authz/src/catalog.ts` | Removed the dead `Permission.ResultPublish` (`result.publish`) key. Added inline status comments documenting the retained unresolved/reserved keys (`CandidateDelete`, `SystemInfoView`, `GradingFinalize`, `GradingIdentityView`, `System*`). |
| `packages/auth/src/rbac.ts` | **Deleted.** Dead legacy runtime map; 0 production importers. |
| `packages/auth/src/rbac.test.ts` | **Deleted.** Asserted the misleading legacy map (`getPermissionsForRole("Teacher")` → `[]`), contradicting the real Teacher preset. |
| `apps/api/src/plugins/auth.ts` | Removed the dead `requirePermission` decorator (0 route consumers; read only the always-empty `ctx.permissions`). Added a comment recording the removal and the `requireRole` retention rationale. |
| `apps/api/src/plugins/authz.ts` | Added an introspection-only `_isScoreCapability: true` tag to the `requireScoreCapability` preHandler. Closes the P4-V0 §7.2/§8 "80 metadata gates + 1 dedicated score gate" introspection gap so the whole-app regression lock classifies the score route as protected. **Production-neutral** — same pattern as `_isAuthenticate` / `_isRequireRole`; no runtime authorization decision changed. |
| `apps/api/src/types/fastify-auth.d.ts` | Removed the dead `requirePermission` type declaration and its now-unused `Permission` import. `Role` retained (still used by `requireRole`). |
| `apps/api/src/types/requestContext.ts` | Updated the `permissions`-field doc comment to record the `requirePermission` removal and the retained-compatibility rationale for the field itself. |
| `apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts` | **New file.** The permanent whole-application regression lock. |
| `docs/architecture/authorization.md` | Added the explicit `users.role` / JWT-role compatibility policy (§users.role and JWT-role compatibility policy). |
| `docs/adr/ADR-010-scoped-rbac-architecture.md` | Marked the dead `result.publish` row in §4.8 as removed (P4-C1), pointing at the live `exam.result.publish`. |

## 3. Removed symbols / residue

| Symbol | Where | Proof of zero consumers |
| --- | --- | --- |
| `Permission.ResultPublish` (`result.publish`) | `packages/authz/src/catalog.ts` | `rg "ResultPublish\|result\.publish" apps packages` — no route consumer, no grant. The live result-publish route uses `ExamResultPublish` (`exam.result.publish`). Catalog-closed-union and presets tests iterate remaining values, so removal is safe. |
| `getPermissionsForRole` + the `ROLE_PERMISSIONS` map | `packages/auth/src/rbac.ts` | `@exam/auth` `index.ts` is `export {}`; the map is never re-exported. `rg getPermissionsForRole` returns only `rbac.ts`/`rbac.test.ts`. Zero production importers (P4-V0 §11.3). |
| `rbac.test.ts` legacy assertions | `packages/auth/src/rbac.test.ts` | Asserted the misleading legacy map (Teacher → `[]`). Deleted with the map. |
| `fastify.requirePermission` decorator + `_isRequirePermission` tag | `apps/api/src/plugins/auth.ts` | `rg fastify.requirePermission\(` in routes = 0. Read only `ctx.permissions` which is `[]` on every runtime context. |
| `requirePermission` type declaration | `apps/api/src/types/fastify-auth.d.ts` | Matched the removed decorator. |

## 4. Preserved symbols (intentional — not P4-C1 scope to delete)

| Symbol | Status (documented in `catalog.ts`) |
| --- | --- |
| `CandidateDelete` (`candidate.delete`) | **Unresolved product decision.** Granted to Admin but no `DELETE /candidates/:id` route exists today. Removing the route-less grant is out of P4-C1 scope (P4-G-04). |
| `SystemInfoView` (`system.info.view`) | **Unresolved product decision.** `GET /system/info` is public today, so no role needs the perm. Retained pending product decision (P4-G-04). |
| `GradingFinalize` (`grading.finalize`) | **Reserved for M11 scoped grading.** Omitted from all human presets by design. No route consumer. Owner: M11. |
| `GradingIdentityView` (`grading.identity.view`) | **Reserved for M11 scoped grading** (double-blind). No route consumer. Owner: M11. |
| `SystemAutoSubmit` / `SystemHeartbeatScan` / `SystemLifecycleReconcile` | **System-actor-only.** Bound to synthetic actor identities in the deadlineScanner / heartbeat plugins; non-login, non-assignable; never reach the assignment-authority path. Not human HTTP-route permissions. |
| `users.role` column + writes | **Compatibility / display projection** of the active primary assignment. Non-authoritative (0 runtime authz decisions read it). Deprecation is a later decision, not P4-C1. |
| `ctx.permissions` field | Retained as a compatibility surface (part of the base `RequestContext` in the `@exam/domain` leaf package); every resolver/system-actor/auth context still initializes it to `[]`. |
| `fastify.requireRole` decorator | Retained **only** as the test-fixture seam for the whole-app regression lock's negative control (it lets the conformance test prove the classifier detects a synthetic role gate). 0 production route consumers. |

## 5. Consumer searches (re-verified during this Job)

```text
rg -n "ResultPublish|result\.publish" apps packages docs
  → docs/archive/** (historical, not updated), ADR-010 §4.8 (updated this Job),
    P4-R0/P4-V0 audit references (historical record). Zero code consumers.

rg -n "fastify\.requirePermission|_isRequirePermission" apps packages
  → classifier negative-evidence comments only (the permission_list kind is
    still detected by the tag; it is now permanently 0 because no decorator
    sets the tag). Zero route consumers.

rg -n "getPermissionsForRole|packages/auth/src/rbac|legacyMap" apps packages
  → packages/authz/src/legacyMap.{ts,test.ts} (separate file, runtime consumer
    count 0 per P4-V0 §11.3; KEPT as migration-compatibility residue per
    P4-R0 §4.3-C — deletion not authorized). rbac.ts/rbac.test.ts deleted.

rg -n "fastify\.requireRole|_isRequireRole" apps packages
  → decorator definition (auth.ts), type declaration (fastify-auth.d.ts),
    classifier (routeRegistryConformance*.test.ts), comments. Zero route
    consumers.
```

## 6. New regression lock

`apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts` registers the
**full production composition** via `registerApiRoutes(app)` (the same function
`server.ts:117` calls) inside a Fastify app built with the production auth
plugins, attaches an `onRoute` capture hook, and asserts over every primary
route:

```text
[x] captures the full runtime tree via registerApiRoutes (not an enumerated subset)
[x] full runtime paths include /api and /api/auth prefixes
[x] excludes Fastify auto-generated HEAD aliases consistently
[x] 0 active requireRole route preHandlers across the WHOLE app
[x] 0 active requirePermission route consumers across the WHOLE app
[x] no route carries BOTH a capability gate and a legacy role/permission gate
[x] every protected route has exactly ONE capability/ownership gate
    (flat / scoped / score_capability)
[x] the authenticate-only + public route set is exactly the documented closed set
[x] the full composition reconciles to 91 primary routes
    (81 protected + 10 non-protected) — the P4-V0 Gate 0.5 baseline
[x] every protected route's gate carries a valid catalog permission
[x] the removed dead result.publish is absent from both the catalog and every route
[x] negative control: the classifier detects a synthetic requireRole route
    (non-vacuity)
```

It does **not** hard-code a route-subset allowlist as the PASS condition: it
sweeps every primary route and names any offender in the failure message so a
regression is triaged, not silently swallowed. The classifier is the same
tag-based logic proven in `routeRegistryConformance.test.ts`, extended to
recognize the `_isScoreCapability` tag added this Job (closing the P4-V0
"dedicated score gate" introspection exception).

> **Note on the existing `routeRegistryConformance.test.ts`.** It is retained
> unchanged. It registers only the 17 M10-A/B/C/D route plugins and asserts
> per-route metadata against `ROUTE_PERMISSION_REGISTRY`; it complements (does
> not duplicate) the new whole-app sweep, which additionally covers
> auth/self/public/proctor-monitoring/client-events.

## 7. Tests

| Suite | Command | Result |
| --- | --- | --- |
| Whole-app regression lock (NEW) | `APP_MODE=test TEST_DB_ISOLATION=worker-database pnpm --filter @exam/api exec vitest run src/authz/routeRegistryConformanceWholeApp.test.ts` | **10 passed / 0 skip** |
| Existing route conformance (unchanged behavior) | `… vitest run src/authz/routeRegistryConformance.test.ts` | **75 passed / 0 skip** |
| `@exam/authz` suite (catalog + presets + boundaries) | `pnpm --filter @exam/authz test` | **63 passed / 0 skip** |
| `@exam/auth` suite (rbac.test.ts removed: 20 → 13) | `pnpm --filter @exam/auth test` | **13 passed / 0 skip** |
| Full repository gate | `pnpm verify` | see §9 |

## 8. Behavior-delta statement

```text
Live routes:        NONE changed. Every protected route still resolves through
                    the same capability/ownership gate on ctx.capabilities.
Role presets:       NONE changed. ResultPublish was never granted to any role;
                    its removal is access-matrix-neutral.
Frontend:           NONE changed (the web imports Permission from @exam/authz;
                    it never referenced ResultPublish).
Schema/migrations:  NONE changed.
Score route:        GET /api/scores/attempts/:attemptId still gated by
                    requireScoreCapability; only an introspection-only tag was
                    added (no runtime decision changed).
Result publication: POST /exams/:id/publish-results unchanged — still
                    ExamResultPublish, granted to Admin+Teacher.
```

The only runtime-observable change is the absence of two dead decorators/maps
that had zero consumers.

## 9. Verification — `pnpm verify`

Run after the C1 changes (full repository gate):

```bash
pnpm verify
```

**Result: PASS (exit 0).** All stages green:

```text
format:check        PASS — All matched files use Prettier code style!
lint (code-quality) PASS — Code quality checks passed.
lint:copy           PASS — No hardcoded business copy found.
lint:arch           PASS — Architecture checks passed.
lint:db-config      PASS — DB/test-config regression guards passed.
lint:ui-gates       PASS
lint:eslint         PASS
typecheck (turbo)   PASS — 17/17 tasks successful
coverage (turbo)    PASS — 16/16 tasks successful
build (turbo)       PASS — 9/9 tasks successful
```

Coverage-stage per-package results (all green, no threshold failure):

| Package | Test Files | Tests | Skips |
| --- | ---: | ---: | ---: |
| `@exam/api` | **122** | passed | 5 (redis-env) |
| `@exam/web` | 94 | passed | 0 |
| `@exam/exam-engine` | 23 | passed | 0 |
| `@exam/db` | 23 | passed | 0 |
| `@exam/contracts` | 9 | passed | 0 |
| `@exam/authz` | 9 | passed | 0 |
| `@exam/auth` | **2** (rbac.test.ts removed) | passed | 0 |
| `@exam/domain` | 3 | passed | 0 |
| `@exam/import-export` | 1 | passed | 0 |

> **API test-file count**: 121 → **122** (the new `routeRegistryConformanceWholeApp.test.ts`).
> **`@exam/auth` test-file count**: 3 → **2** (the misleading `rbac.test.ts` deleted with the dead map).
>
> **Flake note (documented, not a C1 regression).** Two intermediate `pnpm verify`
> invocations hit a 5000ms timeout on `packages/db/src/testWorkerDatabase.test.ts`
> (the physical-DB-lifecycle test that runs `CREATE DATABASE`/migrate/truncate
> against real Postgres). This is the repository-documented
> **BUG-FLAKE-001 "physical-DB-lifecycle" / "WSL2 host-performance" subclass**
> (`docs/standards/test-flakes.md` lines 203, 207–209): standalone the test is
> 15/15 PASS (~1.4–10s); under turbo coverage contention on a loaded WSL2 host
> it can exceed the default 5s `testTimeout`. It is host-performance-bound I/O
> contention, not a code or authorization regression, and C1 did not touch
> `packages/db` (`git diff --stat 6711b2b -- packages/db` is empty). The final
> `pnpm verify` run reproduced in this section passed cleanly (db 23/23 incl.
> `testWorkerDatabase` 15/15), confirming the verdict.

## 10. Remaining decisions (out of P4-C1)

- `CandidateDelete` / `SystemInfoView`: unresolved product decisions (P4-G-04).
  Kept; a future Job decides route vs removal.
- `users.role` column deprecation: documented as a non-authoritative
  compatibility cache; dropping the column is a later decision, not P4-C1.
- `legacyMap.ts`: kept as migration-compatibility residue per P4-R0 §4.3-C
  (deletion not authorized unless the P4 authority explicitly permits it and
  all consumers are proven absent).
- M11 scoped grading (`GradingFinalize` / `GradingIdentityView`): reserved.

## 11. Acceptance checklist (task §4.5)

```text
[x] ResultPublish is removed
[x] ExamResultPublish behavior is unchanged
[x] requirePermission runtime surface is removed
[x] legacy packages/auth RBAC runtime map is removed (rbac.ts + rbac.test.ts)
[x] compatibility types still compile (ctx.permissions field retained;
    Permission/Role domain enums untouched)
[x] reserved/unresolved permissions remain (CandidateDelete, SystemInfoView,
    GradingFinalize, GradingIdentityView, System*)
[x] users.role compatibility policy is documented (authorization.md)
[x] permanent full-runtime zero-requireRole assertion exists
    (routeRegistryConformanceWholeApp.test.ts)
[x] targeted tests pass
[x] pnpm verify passes
[x] no route/preset behavior changed
```
