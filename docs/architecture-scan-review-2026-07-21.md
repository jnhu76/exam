# Architecture Scan Review — Verified Findings & Revised Manifest

**Date:** 2026-07-21 (updated per second review pass)
**Reviewer:** Independent verification against codebase
**Scan under review:** `docs/architecture-scan-findings-2026-07-21.md`
**Branch:** feat/project-simplification-architecture-scan

---

## 0. Executive Summary

The architecture scan is a **useful discovery document** with mostly accurate observations but **flawed strategic conclusions**. The scan correctly identifies dead code, duplicate registries, dead scripts, and stale documentation. However, its core recommendation — merging 4 packages into `apps/api` to reduce from 7 to 3 packages — is based on a **static analysis that undervalues strategic boundaries**.

This review provides a **verified-by-codebase** assessment of each finding, separating what should be executed from what should be revised.

**The target is not a fixed package count.** The exit conditions are:
- Each remaining package has a stable, enforceable responsibility
- No framework pollution (Fastify, Drizzle, React) in leaf packages
- No circular dependencies
- No deep imports that subvert the public API
- No two packages expressing the same fact

**Current boundary assessment:** 5 strategic packages (`domain`, `contracts`, `db`, `authz`, `exam-engine`) + 1 provisional (`import-export`) + 1 merge candidate (`auth`, conditional on DB seed audit).

---

## 1. Package Consumer Analysis — Verified Facts

### 1.1 `packages/authz`

| Claim | Scan says | Verified | Notes |
|-------|-----------|----------|-------|
| Consumers | `apps/api` + `apps/web` (constants only) | ✅ PARTIALLY | Web production: only `apps/web/src/lib/capabilities.ts` imports `Permission` + `PermissionKey`. API: ~40 production files. |
| Barrel: 0 importers | Claimed | ❌ **WRONG** | Both API and Web import from `@exam/authz` barrel extensively. The barrel is actively used. |
| Verdict | MERGE into apps/api | ❌ REJECT | See §2.2 |

**Key nuance:** Web imports are not "constants only" — `permissionsForRole` is a pure function. But it's a stateless, deterministic function, so the spirit of the scan's claim (Web uses authz for UI capability checks, not runtime enforcement) is directionally correct.

### 1.2 `packages/exam-engine`

| Claim | Scan says | Verified | Notes |
|-------|-----------|----------|-------|
| Consumers | 16 imports, all in `apps/api` | ✅ | ~13 production files + test files, all in API |
| Verdict | MERGE into apps/api | ❌ REJECT | See §2.3 |

### 1.3 `packages/auth`

| Claim | Scan says | Verified | Notes |
|-------|-----------|----------|-------|
| Barrel | `export {}` (dead) | ✅ | Verified |
| Consumers | 55 deep-imports, all in `apps/api` + `db` seed | ✅ | All use `@exam/auth/src/...` deep imports |
| Verdict | MERGE into apps/api | ✅ CONDITIONAL | See §2.4 — blocked by DB seed dependency audit |

### 1.4 `packages/import-export`

| Claim | Scan says | Verified | Notes |
|-------|-----------|----------|-------|
| Consumers | 2 imports, both in `apps/api` | ✅ | `routes/attempts.admin.ts` + `routes/export.ts` |
| Package size | 44-line csv.ts | ✅ | 3 source files, 1 test file |
| Verdict | MERGE into apps/api | ❌ REVISED | See §2.5 — now KEEP PROVISIONALLY AND PURIFY |

---

## 2. Detailed Finding Review

### 2.1 Package Count Target (FINDING-R1 in review)

**Scan claim:** "7 → 3 packages, 57% reduction"
**Review claim:** Package count is not a valid target

**Verification:** The scan's Executive Summary metrics table uses "7 → 3" as a target. This is misleading. Package count is a proxy metric at best.

**Verdict: REJECT the "3 packages" target.** The target should be the exit conditions listed in §0.

### 2.2 `authz` Package (FINDING-R2 in review)

**Scan claim:** MERGE into apps/api — only API and Web use it, Web only uses constants
**Review claim:** KEEP AND PURIFY — two runtime consumers already exist

**Verification:**
- `apps/api` has ~40 production files importing from `@exam/authz` (runtime enforcement, capability resolution, permission checks)
- `apps/web` has 1 production file + ~25 test files importing from `@exam/authz` (UI capability checks)
- authz depends only on `@exam/domain` (leaf dependency)
- authz has NO Fastify, Drizzle, or React dependency

**Assessment:** The scan's claim of "Barrel: 0 importers" is **factually incorrect**. The barrel IS used. However, the scan's broader observation (authz is primarily consumed by API) is directionally correct.

**Verdict: KEEP as package.** The authz package provides:
- A shared permission language used by both API (runtime) and Web (UI)
- Framework-agnostic capability model (no Fastify/Drizzle/React)
- Clear separation between "what permissions exist" (package) and "how they're enforced" (API)

**Action:** Purify the boundary — remove any implicit Fastify or DB knowledge from the package. The resolver pattern already achieves this; verify no violations exist.

### 2.3 `exam-engine` Package (FINDING-R3 in review)

**Scan claim:** MERGE into apps/api — "16 imports, all in apps/api"
**Review claim:** KEEP AS CROSS-RUNTIME DOMAIN KERNEL

**Verification:**
- All 16 imports are from `apps/api` — scan is correct on consumer count
- exam-engine depends only on `@exam/domain` (leaf dependency)
- Contains: exam state machine, attempt state machine, answer protocol, grading, timer, deadline reconciliation
- Has NO Fastify, Drizzle, or React dependency

**Assessment:** The scan correctly identifies that exam-engine has one consumer today. But the module's value is in its **domain isolation** — it's the exam runtime kernel. Extracting it from a merged API later would be costly.

**Verdict: KEEP as package.** The exam-engine protects:
- Deterministic state machine logic (no DB, no HTTP, no I/O)
- Answer protocol (versioned, idempotent saves)
- Timer/deadline calculations (server time authority)
- Grading engine bridge

**Action:** Purify — delete dead exports (`types.ts` stubs, unused barrel re-exports), resolve `gradeQuestion` name collision, unify `getRemainingSeconds`.

### 2.4 `auth` Package — Merge with Blocker

**Scan claim:** MERGE into apps/api — 55 deep-imports, dead barrel

**Verification:**
- Barrel: `export {}` — completely dead. ✅
- All imports use deep paths: `@exam/auth/src/password.js`, `@exam/auth/src/session.js`
- `rbac.ts` (40 lines): 0 external callers. ✅
- `requirePermission` decorator: 0 route consumers. ✅

**Blocker identified:** `packages/db/package.json` declares `@exam/auth` as a devDependency. Before merging, must prove:
1. `packages/db` has no real `import from "@exam/auth"` in production code
2. `@exam/auth` is only a stale devDependency
3. All seed paths use `HashFunction` injection (demo-seed.ts already does this)
4. DB package will not have a reverse dependency on `apps/api`

**Verdict: MERGE into apps/api, CONDITIONALLY ACCEPTED.** Blocked by DB seed/auth dependency audit (see §2.16). The `session.ts` and `password.ts` modules become `apps/api/src/auth/`. Web and Desktop don't need password hashing or JWT session management.

### 2.5 `import-export` Package — Keep Provisionally

**Scan claim:** MERGE into apps/api — 2 imports, 44-line csv.ts
**Review claim (original):** MERGE into apps/api
**Review claim (corrected):** KEEP PROVISIONALLY AND PURIFY

**Verification:**
- 2 consumers, both in `apps/api`
- Core file: 44 lines, 3 source files + 1 test file
- **Critical distinction:** csv.ts is a **pure codec** with zero dependencies (no Fastify, no DB, no Node API, no workspace package)

**Assessment:** Unlike `packages/auth` (which is server-specific infrastructure), `import-export` is a pure encoding/decoding module. Future consumers may include:
- Web client-side CSV export
- Desktop local export
- Offline exam package import
- Batch candidate/question import
- Proctor log export
- Audit record export

**Revised boundary:**
- **Allowed in package:** pure parsing, pure serialization, format validation, formula injection protection, cross-format interchange types
- **Forbidden in package:** HTTP response, DB query, Fastify, file download headers, permission checks, audit writes, export job orchestration
- **API orchestration:** `apps/api/src/modules/import-export/` handles the server-side workflow

**Verdict: KEEP PROVISIONALLY AND PURIFY.** Do not merge now. The package is a zero-dependency codec that may serve multiple runtimes. Re-evaluate when product direction (Desktop, Web export) is clearer.

### 2.6 Triple Role/Permission Registry (Scan's Finding 3.2)

**Scan claim:** 4 registries → 1 (keep `authz/catalog.ts`)
**Review claim:** ACCEPT with authz as authority

**Verification:**
- `packages/auth/src/rbac.ts` — 0 callers. ✅ DELETE
- `packages/authz/src/legacyMap.ts` — 0 external callers. ✅ DELETE after migration
- `packages/domain/src/enums.ts` (legacy `Permission`/`Role`) — 0 production consumers. ✅ DELETE or reduce to canonical re-export
- `packages/authz/src/catalog.ts` — authority. ✅ KEEP

**Verdict: ACCEPT.** Execute as a standalone task (AUTHZ-CATALOG-CONSOLIDATION), not as a prerequisite for package merge.

### 2.7 Dead Exports in exam-engine (Scan's Finding 3.3)

**Scan claim:** Delete 3 `declare function` stubs, 6 dead re-exports, unify `getRemainingSeconds`, move `gradeAttempt`/`startAttempt` to test helpers

**Verification:**
- `packages/exam-engine/src/types.ts` — 3 `declare function` stubs, 0 callers. ✅ DELETE
- `packages/exam-engine/src/index.ts` — barrel has 13 exports; claim is 6 have 0 external consumers. Need to verify individual exports.
- `getRemainingSeconds` — 0 prod callers; web reimplements. ✅ UNIFY
- `gradeAttempt` — "retained for test compatibility". ✅ MOVE to test helper
- `startAttempt` — tests only. ✅ MOVE to test helper

**Verdict: ACCEPT.** These are safe, low-risk deletions.

### 2.8 `gradeQuestion` Name Collision (Scan's Finding 3.4)

**Scan claim:** Rename engine's `gradeQuestion` → `completeManualGrade`

**Verification:**
- `packages/domain/src/gradingEngine.ts:129` — pure per-question auto-grader
- `packages/exam-engine/src/manualGrading.ts:86` — side-effectful command mutating DB

**Verdict: ACCEPT.** Rename to `completeManualGrade` or `gradeQuestionCommand`.

### 2.9 `routeRegistry.ts` — Ownership, Not Just Relocation

**Scan claim:** 1061 LOC, zero production consumers — move to `__tests__/`

**Verification:**
- 1061 lines. ✅
- 0 production consumers. ✅
- 4 test consumers: `routeRegistry.test.ts`, `routeRegistryConformance.test.ts`, `adminSuperset.test.ts`, `proctorMonitoring.crossOrg.test.ts`. ✅
- Detailed comment documents it as "metadata + coverage test, not enforcement."

**Verdict: MOVE out of production bundle, but with ownership and structural split.**

**Key insight:** Auto-generating the entire manifest from runtime metadata would create a circular proof — the runtime says it needs Permission A, the auto-generated file says it needs Permission A, the test passes. This cannot catch "should be Permission B" errors.

**Recommended structure:**
```
Auto-generated (from Fastify route metadata):
  route inventory (method, path, schema completeness)
  Any new route not in manifest = test failure

Manually maintained (the real oracle):
  expected capability per route
  scope requirement
  ownership semantics
  special allow/deny policy
```

This splits the 1061-line file into a smaller policy table + auto-generated inventory:

```ts
// Manually maintained — the real conformance oracle
export const expectedRouteAuthorization = {
  "POST /api/exams": {
    capability: Permission.ExamCreate,
    scope: "organization",
  },
};
```

**OWNER:** authorization architecture
**CHANGE TRIGGER:** any route authorization metadata change
**ENFORCEMENT:** route conformance test blocks drift

**Location:** `apps/api/test-support/authz/` with the following structure:
```
apps/api/test-support/authz/
├── expectedRouteAuthorization.ts   # manually maintained oracle
├── routeInventory.ts               # auto-generated from Fastify composition
└── routeAuthorizationTypes.ts      # shared types
```

**Production tsconfig** must exclude `test-support/`. **Test tsconfig** must explicitly include it. **Production package exports** must not include `test-support/`.

**Rationale for split:**
- `routeInventory` is auto-generated from runtime route composition — catches newly added routes not yet in the manifest
- `expectedRouteAuthorization` is manually maintained as the independent oracle — the real conformance test
- Both are compared in the conformance test; mismatch = test failure
- Auto-generating the *expected* capability from runtime metadata would create a circular proof (runtime says Permission A → auto-generated says Permission A → test passes — cannot catch "should be Permission B" errors)

### 2.10 ADR Audit (Scan's Section 4)

**Scan claim:**
- ADR-001 (Redis): ADR_OVERDESIGNED → Archive
- ADR-004 (Desktop): CODE_CONFORMS → Archive
- ADR-007 trio → Merge into one doc
- ADR-009 (Frontend FSM): CODE_DIVERGES → Archive
- KEEP: ADR-002, 003, 005, 006, 008

**Verification:**
- 11 ADR files exist in `docs/adr/`
- ADR-001 Redis: Status says "Accepted (Phase 2 收口), Full adoption: Deferred." Redis is NOT used in production. But the ADR records a real decision (optional baseline, not full adoption). The scan's "ADR_OVERDESIGNED" label is not a standard ADR status.
- ADR-004 Desktop: Desktop does not exist as code. The ADR is a planning document.
- ADR-007: 3 files, 2 are audit reports, 1 is a real ADR. ✅
- ADR-009: "No code implemented" by design. It's a proposal.

**Verdict: REJECT archival of ADR-001, ADR-004, ADR-009.**
- ADR-001: Change status to `DEFERRED / CONDITIONAL`. Keep visible — Redis optionalization is a real decision.
- ADR-004: Change status to `DEFERRED — PRODUCT DIRECTION RETAINED`. Desktop is a real product direction.
- ADR-007: Merge 2 audit reports into `docs/dev/test-flakes.md`. Keep the real ADR.
- ADR-009: Change status to `PROPOSED`. It's a proposal, not a decision — but it should be visible.
- **ACCEPT** the ADR-007 trio cleanup.

**Principle:** ADRs document decisions and their context. Archiving valid (even if deferred) decisions loses context. Use explicit status labels instead.

### 2.11 Redis Infrastructure — Precision on Optionalization

**Scan claim:** Remove all — plugin, compose services, test files, config, ADR archive

**Verification:**
- Redis plugin: `apps/api/src/plugins/redis.ts` — exists
- Redis test files: `redis.test.ts`, `redis-fallback-guard.test.ts`, `testRedis.ts` — exist
- Docker compose: Redis service in `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml` — exists
- ADR-001: exists
- Production business path using Redis: **NONE** (only diagnostics ping)

**Assessment:** The correct treatment depends on whether Redis is a near-term priority:

**Case A — Redis is a near-term product candidate** (likely, given current trajectory):
- Proctor presence, SSE/WebSocket distribution, multi-instance rate limiting, scanner coordination are all on the roadmap
- Keep minimal adapter, move compose to optional profile, default off
- Delete diagnostics-only test files (they test nothing)
- Keep real contract tests
- ADR-001 status: `DEFERRED — NEAR-TERM PRODUCT CANDIDATE`

**Case B — Redis has no timeline:**
- Delete runtime implementation (plugin, connection lifecycle, tests)
- Keep ADR-001 with trigger conditions
- Re-adding Redis later is not costly

**Verdict: OPTIONALIZE (Case A).** Document explicitly:
```
Status: DEFERRED — NEAR-TERM PRODUCT CANDIDATE
Current runtime dependency: OPTIONAL
Default deployment: DISABLED
Activation trigger: first approved Redis-backed vertical slice
```

### 2.12 Phase 1 Baseline Problem (FINDING-R7 in review)

**Scan issue:** Uses "Phase 1" as baseline for judging value, while the system already has Phase 2 features implemented.

**Verification:**
- Proctor monitoring: ✅ Implemented (backend + frontend)
- Force-submit/extend-time/misconduct: ✅ Implemented
- Manual grading queue: ✅ Implemented (backend + frontend)
- `canceled` exam state: ✅ Implemented

**Verdict: ACCEPT the review's criticism.** The scan should baseline against "CURRENT IMPLEMENTED SYSTEM" not "Phase 1 minimal product." This affects the evaluation of audit, Redis, control fields, and module value.

**Action:** Update the scan's baseline assumption before using it for prioritization.

### 2.13 Test Redundancy — Categorized by Risk

**Scan claim:** ~9 deletion candidates with surviving evidence, confidence levels HIGH/MEDIUM

**Verification of candidates:**
- A11: `submitAndGradeAttempt.test.ts` (125 lines) → surviving `candidate-save-submit.test.ts` (1626 lines)
- A12: `adminSuperset.test.ts` (38 lines) → surviving `adminCompatibility.test.ts`
- A13: `permissionMatrix.{helpers,fixture}.test.ts` (41+54 lines) → 4 matrix files
- A14: `login.integration.test.tsx` → surviving `LoginPage.test.tsx` (4× richer)
- A15: `sanitizeClientEvent.test.ts` (web re-export) → surviving `contracts/__tests__/sanitizeClientEvent.test.ts`
- A16: `unauthorized-access.test.ts` AC2 block → surviving `permissionBoundary.test.ts`
- A17: `rbac-matrix.test.ts` AC1/AC5/AC6 → surviving `permissionBoundary.test.ts` + `m10dPermissionBoundary.test.ts`

**Revised approach — categorize by risk type, not by confidence level:**

**Type 1: Mechanical duplication** — low risk, no mutation needed:
- A15: re-export test (web re-exports `sanitizeClientEvent` from contracts)
- A13: test-of-test (helpers/fixture test the test infrastructure, not production logic)
- **Evidence needed:** import/caller check, assertion mapping, run target suite, check coverage

**Type 2: Normal behavioral overlap** — medium risk, mutation optional:
- A11: orchestrator test subsumed by richer route-level test
- A14: login integration test subsumed by richer component test
- **Evidence needed:** assertion mapping, surviving test covers same inputs, run target suite, check coverage

**Type 3: Security/permission/transaction overlap** — high risk, mutation required:
- A12: adminSuperset test overlaps with permission boundary tests
- A16: unauthorized-access AC2 block overlaps with RBAC M10 boundary tests
- A17: rbac-matrix AC1/AC5/AC6 overlaps with M10 boundary tests
- **Evidence needed:** fault injection or mutation evidence, real DB/HTTP layer proof, full suite verification

**Verdict:** Execute deletions by type, not by confidence level. Types 1 and 2 can proceed with lighter evidence. Type 3 requires mutation evidence before deletion.

### 2.14 Dead Scripts (Scan's Section 6)

**Scan claim:** 5 dead scripts, 5 duplicate scripts, various drift items

**Verification:**
- `scripts/check-e2e-artifacts.mjs` — EXISTS. Not wired in CI. ✅ DELETE
- `scripts/check-docstring-coverage.mjs` — EXISTS. No exit code. ✅ DELETE or wire
- `scripts/check-test-env-contract.mjs` — EXISTS. Not wired. ✅ DELETE or wire
- `scripts/check-test-time-contract.mjs` — EXISTS. Not wired. ✅ DELETE or MERGE
- `scripts/rebuild-all.sh` — EXISTS. Duplicates `pnpm --filter "./packages/*" build`. ✅ DELETE
- `seed:e2e` duplicate — VERIFIED. ✅ DELETE `seed:e2e`
- `test:integration` — EXISTS at root, api, db. Need to verify byte-identity.
- `.env` (15432) vs `.env.example` (5432) — VERIFIED. Different default ports. ✅ MERGE to one default

**Verdict: ACCEPT deletions A5-A10, A18-A22.** Low risk, clearly dead code.

### 2.15 Dockerfile Build Ladder — Investigate, Don't Assume

**Scan claim:** Simplify to `pnpm --filter "./packages/*" build`

**Previous verdict:** REJECT — "build order is load-bearing"
**Corrected verdict:** INVESTIGATE — not proven either way

**Assessment:** The current Dockerfile has 8 separate `pnpm --filter` build commands in explicit dependency order. Additionally, the manifest COPY list was found to be missing `packages/authz/package.json`, indicating the hand-maintained approach has already drifted.

**Proper investigation:**
1. Clean Docker build with current ladder (baseline)
2. Clean Docker build with `pnpm turbo build` (topological)
3. Compare output artifacts
4. Run production image smoke test
5. Verify cache behavior on incremental changes

**Verdict: INVESTIGATE — do not replace without proof, do not keep without attempting simplification.** The correct answer may be `pnpm turbo build` or a filtered turbo graph, not a wildcard.

### 2.16 DB ↔ Domain Boundary Contract

**Identified gap in previous review:** The `packages/db` ↔ `packages/domain` relationship needs a formal architecture contract.

**Current state:**
- DB schema type-imports domain types for JSONB fields: `AnswerRecord`, `ControlFlags`, `GradingRule`, `QuestionSnapshot`, `SubmittedAnswersSnapshot`, etc.
- `packages/db/package.json` has `exports: { ".": "./dist/index.js", "./src/*": "./dist/*" }` — allows deep imports into internals

**Recommended dependency direction:**
```
domain (leaf — no internal deps)
  ↑
db (can type-import domain, must not know about API/Web/Desktop)
```

**Rules:**
- **DB CAN depend on:** domain types, domain enums, pure data structures
- **DB MUST NOT depend on:** domain orchestration, exam-engine commands, API services, Fastify, Web/Desktop
- **Domain MUST NOT know about:** column names, table names, Drizzle, PostgreSQL, migrations, repositories

**Deep-import cleanup:**
Replace `"./src/*": "./dist/*"` with explicit subpath exports:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./schema": "./dist/schema/index.js",
    "./repositories": "./dist/repository/index.js",
    "./testing": "./dist/testing/index.js"
  }
}
```

This prevents consumers from reaching into arbitrary internal paths and makes the package boundary real.

---

## 3. Revised Cleanup Manifest

### 3.1 MECHANICAL CLEANUP CANDIDATES — ITEM-LEVEL PROOF REQUIRED

**Group A: Authorized for deletion** (zero-caller or confirmed dead — execute after final proof)

| ID | Item | Evidence required before delete |
|----|------|--------------------------------|
| A1 | `packages/auth/src/rbac.ts` | Final zero-caller proof (rg check) |
| A2 | `packages/exam-engine/src/types.ts` | Final zero-caller proof (rg check) |
| A4 | `requirePermission` decorator in `plugins/auth.ts` | Final zero-route-consumer proof |
| A5 | `mutation-campaign-results/` directory | gitignored, untracked, unreferenced |
| A7 | `seed:e2e` (duplicate of `db:seed:e2e`) | Verify byte-identical commands |
| A8 | `scripts/check-e2e-artifacts.mjs` | Confirm not wired in any CI/workflow |
| A10 | `docker-compose.test.override.yml` | Confirm only referenced in comments |
| A18 | `verify:nodb-tests` | Confirm only in archived docs |
| A19 | `smoke` (root + turbo) | Confirm not wired in any workflow |

**Group B: Decide before deletion** (needs investigation, not safe to assume)

| ID | Item | Decision needed |
|----|------|-----------------|
| A3 | 6 dead re-exports from `exam-engine/src/index.ts` | Verify each individually — may include legitimately used exports |
| A6 | `test:integration` duplicate entries | Verify actual command is byte-identical to `test` |
| A9 | `scripts/rebuild-all.sh` | **MOVED FROM WAVE 1B** — blocked by B13 (Dockerfile investigation). Delete only after experimental proof that `pnpm turbo build` produces identical output. See §2.15. |
| A20 | `check-docstring-coverage.mjs` | Decide: wire as gate or DELETE |
| A21 | `check-test-env-contract.mjs` | Decide: wire or DELETE |
| A22 | `check-test-time-contract.mjs` | Decide: merge into env contract or DELETE |

### 3.2 SIMPLIFY — Wave 2/3 (boundary purification)

| ID | Item | Action | Wave |
|----|------|--------|------|
| B2 | Triple registry consolidation | Keep `authz/catalog.ts` as authority | Wave 2 |
| B4 | `verify` entry | Reuse `verify:static` prefix | Wave 4 |
| B5 | Color script merge | Merge `check-raw-color-usage` + `check-token-bypass` | Wave 4 |
| B6 | `check-high-font-weight.mjs` | Delete after extending ESLint glob | Wave 4 |
| B7 | Test infrastructure files | Move to test trees | Wave 2 |
| B8 | `routeRegistry.ts` | Move to `apps/api/test-support/authz/` with inventory/policy split | Wave 2 |
| B9 | `gradeQuestion` rename | `completeManualGrade` | Wave 2 |
| B10 | `getRemainingSeconds` | Unify in exam-engine | Wave 2 |
| B11 | ADR-007 trio | Merge 2 reports into `docs/dev/test-flakes.md` | Wave 1A |
| B14 | `.env` vs `.env.example` | Pick one port default | Wave 4 |
| B15 | `lint:md` | Wire into `verify:static` or DELETE | Wave 4 |

### 3.3 STRATEGIC DECISIONS — Wave 0/3/4 (with conditions)

| ID | Item | Revised Action | Condition | Wave |
|----|------|----------------|-----------|------|
| B1a | `packages/auth` | MERGE into `apps/api` | Blocked by DB seed dependency audit (§2.16) | Wave 3 |
| B1b | `packages/authz` | KEEP AND PURIFY | Verify no framework pollution | Wave 2 |
| B1c | `packages/exam-engine` | KEEP AND PURIFY | Delete dead exports, unify timer | Wave 2 |
| B1d | `packages/import-export` | KEEP PROVISIONALLY AND PURIFY | Re-evaluate when product direction clarifies | Wave 2 |
| B3 | Redis infrastructure | OPTIONALIZE (Case A) | Document activation trigger, move compose to optional profile | Wave 3 |
| B12 | ADR-001/004/009 | KEEP with status update | Add `DEFERRED`/`PROPOSED` labels | Wave 1A |
| B13 | Dockerfile build ladder | INVESTIGATE | Compare turbo build vs current ladder empirically. Do NOT delete rebuild-all.sh until proven. | Wave 4 |

### 3.4 TEST DELETIONS — By Risk Category

| ID | Item | Type | Action |
|----|------|------|--------|
| A15 | `sanitizeClientEvent.test.ts` (web) | Type 1: mechanical | DELETE after import/caller check + assertion mapping |
| A13 | `permissionMatrix.{helpers,fixture}.test.ts` | Type 1: mechanical | DELETE after import/caller check + suite run |
| A11 | `submitAndGradeAttempt.test.ts` (orchestrator) | Type 2: behavioral | DELETE after assertion mapping + coverage check |
| A14 | `login.integration.test.tsx` (web) | Type 2: behavioral | DELETE after assertion mapping + coverage check |
| A12 | `adminSuperset.test.ts` (api) | Type 3: security/permission | KEEP until mutation evidence produced |
| A16 | `unauthorized-access.test.ts` AC2 block | Type 3: security/permission | KEEP until mutation evidence produced |
| A17 | `rbac-matrix.test.ts` AC1/AC5/AC6 | Type 3: security/permission | KEEP until mutation evidence produced |

---

## 4. Execution Waves

### Gate 0: Verify PR #197 Snapshot Tag

PR #197 (`e7af792 — fix(audit): make ADR-006 durability contract proportional`) modified production audit behavior. Before any structural cleanup:

- Confirm the PR #197 commit is tagged/recorded
- Note that it invalidates PR #196's M10-F closure evidence (see Gate 0.5)

### Gate 0.5: Re-execute M10-F

PR #197 explicitly states that M10-F evidence from PR #196 is now stale. The audit durability contract change may affect RBAC permission boundary behavior. **M10-F must be re-executed and re-verified before any of the following:**

- Deleting RBAC Type 3 tests (A12, A16, A17)
- Refactoring route authorization oracle (B8)
- Deleting permission compatibility evidence
- Moving authz enforcement code
- Modifying route authorization metadata

**Document governance (Wave 1A) and mechanical cleanup (Wave 1B) that does NOT touch RBAC are NOT blocked by Gate 0.5.**

### Wave 0: Freeze Verdicts (before any code change)

- Confirm strategic package boundaries (this document)
- Set ADR statuses explicitly
- Document current implementation matrix
- Approve product directions for Redis, Desktop, import-export
- **Forbid** execution of rejected Manifest items (B1b merge, B1c merge, B3 full delete, B12 archival)

### Wave 1A: Document Governance (parallel with Wave 1B)

- `docs/README.md` — index of architecture documentation
- `docs/architecture/system-overview.md` — current system architecture
- `docs/architecture/authorization.md` — authz model and boundary
- `docs/architecture/exam-runtime.md` — exam-engine model and boundary
- `docs/architecture/db-boundary.md` — db ↔ domain contract
- `docs/status/implementation-matrix.md` — all capabilities by status
- `docs/adr/README.md` — ADR index with status labels
- ADR-007 trio: merge 2 audit reports into `docs/dev/test-flakes.md`
- ADR-001/004/009: update status labels

### Wave 1B: Mechanical Cleanup (parallel with Wave 1A)

- Group A items: A1, A2, A4, A5, A7, A8, A10, A18, A19 — execute after final per-item proof
- Group B items: A3, A6, A9, A20, A21, A22 — decide per-item before deletion
- A9 (rebuild-all.sh) is BLOCKED by B13 (Dockerfile investigation in Wave 4)
- No package moves, no RBAC-sensitive changes

### Wave 2: Boundary Purification

- authz: verify no Fastify/DB dependency, document package boundary
- exam-engine: delete dead exports, rename `gradeQuestion`, unify `getRemainingSeconds`
- db: formalize deep-import cleanup (explicit subpath exports)
- import-export: define pure codec boundary, move orchestration to API
- routeRegistry: split into auto-generated inventory + manually maintained policy table

### Wave 3: Structural Migration

- auth → `apps/api/src/auth/` (after DB seed dependency audit — see blocker)
- import-export: adjust if product direction confirms (or keep as-is)
- Legacy catalog cleanup (delete `authz/src/legacyMap.ts`, legacy `domain/enums` Permission/Role — NOT `auth/rbac.ts` which was already deleted in Wave 1B)
- Redis optionalization (compose profile, delete diagnostics tests, keep adapter)
- Test-support relocations (routeRegistry, test infrastructure)

### Wave 4: Infrastructure Polish

- Test deletions by risk category (A11-A17)
- Dockerfile build ladder: experimental comparison
- Env config merge (`.env` vs `.env.example` port)
- Verify pipeline simplification
- CI script consolidation

---

## 5. Summary of Package Verdicts

| Package | Final Recommendation | Rationale |
|---------|---------------------|-----------|
| **domain** | KEEP AND PURIFY | Cross-runtime domain language, leaf dependency |
| **contracts** | KEEP AND PURIFY | API/Web/Desktop serialization contracts |
| **db** | KEEP AND PURIFY | PostgreSQL storage + repository boundary, needs deep-import cleanup |
| **authz** | KEEP AND PURIFY | Cross-runtime permission language + pure policy |
| **exam-engine** | KEEP AND PURIFY | Cross-runtime exam kernel, framework-agnostic |
| **import-export** | KEEP PROVISIONALLY AND PURIFY | Zero-dependency codec, future multi-runtime consumers |
| **auth** | MERGE CONDITIONALLY | Server-specific auth infrastructure, blocked by DB seed audit |

**Current count:** 5 strategic + 1 provisional + 1 conditional merge = 7 total, → ~6 after auth merge. **The number is not the target.**

---

## 6. Final Verdict

```
ARCHITECTURE SCAN:
ACCEPT AS DISCOVERY EVIDENCE

VERIFIED REVIEW:
ACCEPT AS BASIS FOR NEW MANIFEST

PACKAGE MERGES:
DO NOT EXECUTE YET
(except auth after DB seed audit)

GATES BEFORE RBAC-SENSITIVE CHANGES:
- Gate 0: PR #197 tag verified
- Gate 0.5: M10-F re-executed and verified

AUTHORIZE:
- Wave 0: verdict freeze
- Wave 1A: document authority reconstruction
- Wave 1B: Group A mechanical deletions (per-item proof)
- Wave 1B: Group B decisions and deletions
- Wave 2: strategic boundary contracts
- Wave 3: conditional structural migration
- Wave 4: infrastructure and test polish

BLOCKED:
- A9 (rebuild-all.sh): blocked by B13 (Dockerfile experiment)
- Type 3 test deletions: blocked by mutation evidence
- auth merge: blocked by DB seed dependency audit

REQUIRE:
- DB seed/auth dependency audit before auth merge
- Dockerfile build ladder experiment (turbo vs current)
- mutation evidence for Type 3 test deletions
- M10-F re-verification before RBAC-sensitive changes
- Corrected execution manifest with conditions above
```