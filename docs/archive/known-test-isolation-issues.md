# Known Test Isolation Issues

> **Status**: Active / to be resolved
> **Scope**: Tests that pass under `pnpm verify` (full suite) but fail when run as a sub-set, due to shared DB state between test contexts.
> **Lifecycle**: Each entry is removed when resolved. New entries are added as pre-existing isolation issues are encountered.

This file records pre-existing test isolation issues that are NOT caused by the PR that documents them. The intent is to keep the recording PR's diff focused on its accepted scope while not losing the observation for a future cleanup.

Verification rule: an issue belongs here only if it was reproduced on the PR's base commit (before the PR's own changes), or it is a shared-DB-state coupling that predates the PR.

---

## K-1 — `user.test.ts` list-pagination assertion sees DB residue from sibling tests

### Observed

`apps/api/src/routes/user.test.ts` line 236:

```typescript
expect(body.total).toBe(body.items.length);
```

### Symptom

When running `pnpm --filter @exam/api exec vitest run src/routes/user.test.ts` (or any sub-set of files that excludes some sibling suites), the test `GET /api/users excludes legacy-role rows from items and total via repo-level filter` fails because `body.total` (counted via `listPaginatedByRoles`) returns a value that does not match `body.items.length`. The discrepancy is caused by rows inserted into the shared `exam_test` database by other test files (e.g. `auth.test.ts`, `permissionBoundary.test.ts`) that persist between `buildTestApp` instances because each `buildTestApp` reuses the same `exam_test` database and does not truncate business tables between tests.

When running the full suite via `pnpm verify` (turbo runs all packages in parallel, api tests end up racing for the same DB), the test passes because the rows visible at the time of assertion happen to satisfy the equality. Under `pnpm --filter @exam/api test` alone, the ordering/staleness differs and the equality breaks.

### Verified pre-existing

Reproduced on `master` at the start of PR3 (`4714545`) and again at the start of PR4 (`eb85273`) — both reproduce the failure when running only `src/routes/user.test.ts`. The bug is not introduced by PR3 or PR4.

### Why deferred from PR3 / PR4

- PR3 scope: Phase 1 runtime config hardening. Test-isolation refactoring is out of scope.
- PR4 scope: admin bootstrap / reset-password. Test-isolation refactoring is out of scope.
- A proper fix requires deciding whether each `buildTestApp` should truncate business tables on setup, or whether the pagination tests should not assert exact equality against a shared mutable count.

### Suggested fix direction

One of:

1. Make `buildTestApp` truncate `users`, `auditLogs`, etc. on setup (per-isolation pattern), so each test context sees only its own inserts.
2. Relax the assertion from exact equality (`toBe`) to a consistency check (`total >= items.length` and `totalPages` consistent with `total`), since the test's intent is to verify role filtering, not exact count.

### Owner / next

Candidate cleanup task — a dedicated test-isolation PR, or folded into the Phase 1 exit pass before E2E blocking CI is re-enabled (currently deferred per `docs/phase1-code-gap-audit.md` § Gap Table `E2E CI` row). Not blocking.
