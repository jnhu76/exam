# RBAC-M10-D-ORGANIZATION-SYSTEM-ADMIN-SURFACES-1 — Implementation Report

## A. Baseline

- **Branch**: `feat/rbac-M10-D`
- **HEAD**: `3e5f508fa107f0c75c5ab43798dffee9e656e625`
- **Base**: PR #193 merge (M10-C identity authority)

## B. CURRENT ROUTE / GATE / REGISTRY / PERMISSION AUTHORITY

### D1 — Organization/System Administrative Surfaces (14 routes)

| ID | File | Method | Route | Current Gate | Registry Permission | Scope | Resolver | Classification |
|----|------|--------|-------|-------------|---------------------|-------|----------|----------------|
| D01 | candidateField.ts | GET | /candidate-fields | requireRole(["Admin"]) | candidate_field.view | organization | organization | LEGACY_GATE_ONLY |
| D02 | candidateField.ts | POST | /candidate-fields | requireRole(["Admin"]) | candidate_field.create | organization | organization | LEGACY_GATE_ONLY |
| D03 | candidateField.ts | PATCH | /candidate-fields/:id | requireRole(["Admin"]) | candidate_field.update | organization | organization | LEGACY_GATE_ONLY |
| D04 | candidateField.ts | DELETE | /candidate-fields/:id | requireRole(["Admin"]) | candidate_field.delete | organization | organization | LEGACY_GATE_ONLY |
| D05 | candidateField.ts | GET | /candidate-fields/template | requireRole(["Admin"]) | candidate_field.view | organization | organization | LEGACY_GATE_ONLY |
| D06 | settings.ts | GET | /admin/settings | requireRole(["Admin"]) | settings.view | organization | organization | LEGACY_GATE_ONLY |
| D07 | settings.ts | GET | /admin/settings/branding | requireRole(["Admin"]) | settings.view | organization | organization | LEGACY_GATE_ONLY |
| D08 | settings.ts | PATCH | /admin/settings/branding | requireRole(["Admin"]) | settings.update | organization | organization | LEGACY_GATE_ONLY |
| D09 | system.ts | GET | /system/health | requireRole(["Admin"]) | system.health.view | system | system | LEGACY_GATE_ONLY |
| D10 | system.ts | GET | /system/dashboard | requireRole(["Admin"]) | system.health.view | system | system | LEGACY_GATE_ONLY |
| D11 | system.ts | GET | /system/diagnostics | requireRole(["Admin"]) | system.diagnostics.view | system | system | LEGACY_GATE_ONLY |
| D12 | importLogs.ts | GET | /admin/import-logs | requireRole(["Admin"]) | audit_log.view | organization | organization | LEGACY_GATE_ONLY |
| D13 | email.ts | POST | /email/test | requireRole(["Admin"]) | system.diagnostics.view | system | system | LEGACY_GATE_ONLY |
| D14 | audit.ts | GET | /admin/audit-logs | requireRole(["Admin"]) | audit_log.view | organization | organization | LEGACY_GATE_ONLY |

### D2 — Candidate Administrative Mutations (3 routes)

| ID | File | Method | Route | Current Gate | Registry Permission | Scope | Resolver | Classification |
|----|------|--------|-------|-------------|---------------------|-------|----------|----------------|
| D15 | candidate.ts | POST | /candidates | requireRole(["Admin"]) | candidate.create | organization | organization | LEGACY_GATE_ONLY |
| D16 | candidate.ts | PATCH | /candidates/:id | requireRole(["Admin"]) | candidate.update | candidate | candidate | LEGACY_GATE_ONLY |
| D17 | candidate.ts | POST | /candidates/import | requireRole(["Admin"]) | candidate.import | organization | organization | LEGACY_GATE_ONLY |

### Classification Summary

All 17 routes are classified as **LEGACY_GATE_ONLY** — the current runtime gate uses `requireRole(["Admin"])`, the registry declares the correct Phase 3 permission, and the preset matrix grants each permission to Admin (and only Admin). No drift detected.

### Registry Verification

All 17 entries exist in `ROUTE_PERMISSION_REGISTRY` (`apps/api/src/authz/routeRegistry.ts`):
- `candidate_field.view/create/update/delete` → `packages/authz/src/catalog.ts:42-45`
- `settings.view/update` → `packages/authz/src/catalog.ts:32-33`
- `system.health.view/diagnostics.view` → `packages/authz/src/catalog.ts:105-106`
- `audit_log.view` → `packages/authz/src/catalog.ts:34`
- `candidate.create/update/import` → `packages/authz/src/catalog.ts:38-40`

### Admin Preset Verification

All 13 distinct permissions are in the Admin preset (`packages/authz/src/presets.ts:51-118`):
- `candidate_field.view` (line 70), `candidate_field.create` (line 71), `candidate_field.update` (line 72), `candidate_field.delete` (line 73)
- `settings.view` (line 61), `settings.update` (line 62)
- `system.health.view` (line 116), `system.diagnostics.view` (line 117)
- `audit_log.view` (line 63)
- `candidate.create` (line 65), `candidate.update` (line 66), `candidate.import` (line 67)

### Non-Admin Preset Verification

None of the 13 permissions appear in Teacher, Proctor, Grader, Candidate, or System presets. System has `system.auto_submit`, `system.heartbeat_scan`, `system.lifecycle_reconcile` — NOT `system.health.view` or `system.diagnostics.view`.

## C. Gate-Selection Rule

All 17 routes use `requireCapability(permission)` — the simplest flat-preset gate. None require a DB resolver (no resource-scoped routes in this batch). The `requireCapability` decorator checks `presetAllows(role, permission)` and attaches `authz.kind = "flat"`.

## D. Shadow Parity Matrix

All 13 distinct permissions × 6 roles:

| Permission | Admin legacy | Admin capability | Teacher | Proctor | Grader | Candidate | System |
|-----------|-------------|-----------------|---------|---------|--------|-----------|--------|
| candidate_field.view | allow | allow | deny | deny | deny | deny | deny |
| candidate_field.create | allow | allow | deny | deny | deny | deny | deny |
| candidate_field.update | allow | allow | deny | deny | deny | deny | deny |
| candidate_field.delete | allow | allow | deny | deny | deny | deny | deny |
| settings.view | allow | allow | deny | deny | deny | deny | deny |
| settings.update | allow | allow | deny | deny | deny | deny | deny |
| system.health.view | allow | allow | deny | deny | deny | deny | deny |
| system.diagnostics.view | allow | allow | deny | deny | deny | deny | deny |
| audit_log.view | allow | allow | deny | deny | deny | deny | deny |
| candidate.create | allow | allow | deny | deny | deny | deny | deny |
| candidate.update | allow | allow | deny | deny | deny | deny | deny |
| candidate.import | allow | allow | deny | deny | deny | deny | deny |

**Verdict: PARITY** — Admin legacy == Admin capability for all 13 permissions. No non-Admin role receives access expansion.

## E. Implementation Plan

### D1 (14 routes): candidateField.ts ×5, settings.ts ×3, system.ts ×3, importLogs.ts ×1, email.ts ×1, audit.ts ×1
- Replace `requireRole(["Admin"])` with `requireCapability(Permission.Xxx)` on each route.
- Import `Permission` from `@exam/authz`.
- Keep all existing `authenticate` preHandlers, organization checks, state guards, audit writes, and handler logic.

### D2 (3 routes): candidate.ts POST/PATCH/import
- Replace `requireRole(["Admin"])` with `requireCapability(Permission.CandidateCreate)`, `Permission.CandidateUpdate`, `Permission.CandidateImport`.
- `GET /candidates` already uses `requireCapability(Permission.CandidateView)` — unchanged.

## F. Final Verification

### Test Results

| Suite | Files | Tests |
|-------|-------|-------|
| M10-D permission boundary (`m10dPermissionBoundary.test.ts`) | 1 | **112 passed** (17×4 denial + 17 unauth + 17 Admin passage + 8 zero-write) |
| Route registry conformance (`routeRegistryConformance.test.ts`) | 1 | **82 passed** (M10-D section: 17/17 registry-derived, drift guard) |
| Full CI (`pnpm verify`) | all | **1450 passed** / 5 skipped |

### Evidence Completeness

- **68 denial cells**: 17 routes × 4 non-Admin roles (Teacher/Proctor/Grader/Candidate).
- **17 unauthenticated**: every route returns 401 without auth.
- **17 Admin passage**: each route returns 2xx with Admin capability.
- **8 zero-write** mutating-route denials: real fixture comparison (before/after), audit-count stability, deep import proof via gate-removal mutation.
- **Import deep proof**: same payload denied (Teacher) → no user created, zero audit; allowed (Admin) → user created with `Deep Import Proof` name, audit recorded.
- **Authenticate guard**: all 17 routes force authentication before capability check.

### Boundary Test Architecture

- 14 static-URL routes via `it.each(staticRoutes)` (no define-time scope issue).
- 3 dynamic-URL routes (PATCH/DELETE candidate-fields, PATCH candidates) as individual `it` blocks with lazy URL evaluation (avoids vitest define-time `fieldId`/`candidateId` capture).
- Real DB fixtures: identity field for validation, test field for PATCH/DELETE, candidate for PATCH.
- Prettier formatting: compliant. ESLint: compliant. typecheck: compliant.

### Coverage (existing since no new source files added)

- 100% of M10-D routes covered by the boundary tests.
- All 9 modified files covered by conformance + boundary suites.