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
| 1 | **RBAC-M1** Permission catalog constants + `packages/authz` leaf + legacy map + arch lint | additive | ✅ | low | [~] | — |
| 2 | **RBAC-M2** Role preset matrix (mirrors ADR §Role→Permission) | data, no enforce | ✅ | low | [ ] | — |
| 3 | **AUDIT-M1** AuditAction constants + `recordAudit` boundary validation (no rename) | boundary check | ✅ | low | [ ] | — |
| 4 | **RBAC-M3** Scope resolver interfaces + ownership-chain integrity rules | interfaces+contract | ✅ | medium | [ ] | — |
| 5 | **RBAC-M4** Route permission registry + coverage test (no enforcement) | metadata+test | ✅ | medium | [ ] | — |
| 6 | **RBAC-M6** Admin compatibility superset mapping | preset update | ✅ | medium | [ ] | — |
| 7 | **RBAC-M5** Shadow permission mode (non-blocking) | dual-run, no block | ✅ | low | [ ] | — |
| 8 | **AUDIT-M2** Sensitive-read audit events (`grading.detail_viewed`, `user.role_changed`) | add audit | ✅ | low | [ ] | — |
| 9 | **STOP** confirm before enforcing: RBAC-M10 / PROCTOR-M1 / GRADING-M1 / SYSTEM-M1 | flips real gates | ⏸️ | high | [ ] | — |
| 10 | RBAC-M7 schema / RBAC-M8 assignment API / RBAC-M9 frontend nav | schema + UI | ❌ separate PR | high | [ ] | — |

## Acceptance per job (filled in as each lands)

### Commit 0 — Tracking doc
- Created `docs/phase3/rbac/RBAC-JOB-QUEUE.md`.

### RBAC-M1 — _pending_
- Delivered: `packages/authz` leaf (package.json/tsconfig/vitest), `src/{catalog,legacyMap,index}.ts`; arch lint rule locks authz to leaf.
- Tests: closed-union; 22 legacy perms 1:1 mapped; dead-perm mapping.
- Commands: `pnpm --filter @exam/authz test`; `pnpm verify:static`.

### RBAC-M2 — _pending_
- Delivered: `packages/authz/src/presets.ts` mirroring ADR matrix.
- Tests: ADR §7 eight boundary checks asserted per role.

### AUDIT-M1 — _pending_
- Delivered: `packages/authz/src/auditActions.ts` + `recordAudit` assertion (no rename).
- Tests: unknown rejected; all real actions in closed set.

### RBAC-M3 — _pending_
- Delivered: `packages/authz/src/resolver.ts` interfaces + integrity contract.
- Tests: system/organization resolvers; deny-on-inconsistent-chain contract.

### RBAC-M4 — _pending_
- Delivered: `apps/api/src/authz/routeRegistry.ts` + coverage test.
- Acceptance: every protected route has an entry (existence only, no gate flip).

### RBAC-M6 — _pending_
- Delivered: Admin preset = compatibility superset (4 proctor + grading + diagnostics).
- Tests: ADR §9 ten compatibility checks.

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

- _none yet_
