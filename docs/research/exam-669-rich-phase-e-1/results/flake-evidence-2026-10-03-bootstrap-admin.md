# Raw flake evidence — 2026-10-03, turbo full-suite run (Phase-E baseline context)

Occurrence context: `pnpm test` at repo root (turbo, 18 tasks incl. DB-backed
packages running concurrently against the same local PG 18 container, cold
docker start minutes earlier).

Original failure (verbatim tail of the failed task):

```
@exam/api:test:  ⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯
@exam/api:test:  FAIL  src/scripts/bootstrap-admin.test.ts > bootstrapAdminOnFreshDb (production bootstrap path) > serializes concurrent first-install attempts: exactly one winner, one Admin, one audit
@exam/api:test:  Error: Test timed out in 5000ms.
@exam/api:test:  If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
@exam/api:test:   ❯ src/scripts/bootstrap-admin.test.ts:488:3
@exam/api:test:      486|   });
@exam/api:test:      487|
@exam/api:test:      488|   it("serializes concurrent first-install attempts: exactly one winner…
@exam/api:test:      489|     // Two non-force bootstrap attempts race on a migrated-but-empty s…
@exam/api:test:      490|     // The transaction-scoped advisory lock makes the serialization do…
@exam/api:test:
@exam/api:test:  Test Files  1 failed | 212 passed | 4 skipped (217)
@exam/api:test:  Tests  1 failed | 2800 passed | 11 skipped (2812)
@exam/api:test:  Duration  271.67s
Tasks: 16 successful, 18 total / Failed: @exam/api#test
```

Re-run standalone (same code, same DB, serial): PASS

```
✓ src/scripts/bootstrap-admin.test.ts (20 tests) 5371ms
  ✓ serializes concurrent first-install attempts: exactly one winner, one Admin, one audit 681ms
Test Files  1 passed (1) / Tests  20 passed (20)
```

Signature match: same-code-rerun-passes; 5s assertion timeout under cross-package
DB load; not on a Phase-E Rich seam. Resembles BUG-FLAKE-001 (5s family under
coverage/parallelism) and the 2026-07-25 ea-lock-order contention-loop timeout,
but on a different suite (bootstrap-admin advisory-lock serialization).
