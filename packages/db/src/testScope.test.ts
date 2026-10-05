import { describe, expect, it } from "vitest";
import {
  resolveTestScope,
  resolveDbPackageTestScope,
  resolveDbIsolationMode,
  resolvePostgresDatabaseName,
  resolveRedisPrefix,
  resolveQueuePrefix,
  isLegacyFileSchemaMode,
  type ResolverEnv,
} from "./testScope.js";

/**
 * ADR-007 Phase 2A resolver tests.
 *
 * These tests intentionally never touch a real PostgreSQL / Redis instance.
 * Every case constructs an explicit `ResolverEnv` and passes it directly to
 * `resolveTestScope`, so the suite is hermetic and needs no DB service.
 */

/** Build an env with only the keys we care about, undefined for the rest. */
function env(overrides: Record<string, string | undefined> = {}): ResolverEnv {
  // Start from a blank object — we never want leakage from process.env here.
  const e: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) e[k] = v;
  }
  return e as ResolverEnv;
}

describe("resolveTestScope — local worker defaults", () => {
  it("uses worker id 1 and fast group by default", () => {
    const scope = resolveTestScope(env());
    expect(scope.kind).toBe("local-worker");
    expect(scope.group).toBe("fast");
    expect(scope.workerId).toBe("1");
    expect(scope.shardIndex).toBe("local");
    expect(scope.isCi).toBe(false);
    expect(scope.scopeId).toBe("local_w1");
    expect(scope.postgresDatabaseName).toBe("exam_test_w1");
    expect(scope.redisPrefix).toBe("exam:test:local:w1:");
    expect(scope.queuePrefix).toBe("exam:test:local:w1");
    expect(scope.queueMode).toBe("producer-only");
    expect(scope.dbIsolation).toBe("worker-database");
  });

  it("derives local worker 2 naming", () => {
    const scope = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "local",
        TEST_WORKER_ID: "2",
        API_TEST_GROUP: "fast",
      }),
    );
    expect(scope.scopeId).toBe("local_w2");
    expect(scope.postgresDatabaseName).toBe("exam_test_w2");
    expect(scope.redisPrefix).toBe("exam:test:local:w2:");
    expect(scope.queuePrefix).toBe("exam:test:local:w2");
  });

  it("prefers VITEST_POOL_ID, and TEST_WORKER_ID over it; VITEST_WORKER_ID is never a slot identity (round-3)", () => {
    // Slot id is the only runner-injected identity — see resolveWorkerId
    // docstring for why VITEST_WORKER_ID (instance id) was removed entirely.
    const fromRunner = resolveTestScope(
      env({ VITEST_POOL_ID: "2", VITEST_WORKER_ID: "3" }),
    );
    expect(fromRunner.workerId).toBe("2");
    expect(fromRunner.scopeId).toBe("local_w2");

    const explicit = resolveTestScope(
      env({
        VITEST_POOL_ID: "2",
        VITEST_WORKER_ID: "3",
        TEST_WORKER_ID: "9",
      }),
    );
    expect(explicit.workerId).toBe("9");
    expect(explicit.scopeId).toBe("local_w9");

    // VITEST_WORKER_ID alone does NOT provide a slot id: outside Vitest it is
    // ignored (serial fallback "1"), and under Vitest its presence without
    // VITEST_POOL_ID fails fast instead of silently rebinding slot resources
    // to the known-bad instance identity.
    const legacyOnly = resolveTestScope(env({ VITEST_WORKER_ID: "3" }));
    expect(legacyOnly.workerId).toBe("1");
    expect(() =>
      resolveTestScope(env({ VITEST_WORKER_ID: "3", VITEST: "true" })),
    ).toThrow(/VITEST_POOL_ID is required for slot-scoped test resources/);
  });

  it("treats an empty VITEST_POOL_ID as unset: '1' outside Vitest, fail-fast under Vitest", () => {
    const scope = resolveTestScope(env({ VITEST_POOL_ID: " " }));
    expect(scope.workerId).toBe("1");
    expect(() =>
      resolveTestScope(env({ VITEST_POOL_ID: " ", VITEST: "true" })),
    ).toThrow(/VITEST_POOL_ID is required for slot-scoped test resources/);
  });

  it("uses the runner-injected slot id under Vitest without an explicit override", () => {
    const scope = resolveTestScope(
      env({ VITEST_POOL_ID: "2", VITEST: "true" }),
    );
    expect(scope.workerId).toBe("2");
  });

  it("slot-derived database name is stable across sequential files that share a slot", () => {
    // Two "files" (fresh envs) handed the same pool slot by the runner must
    // resolve to the SAME physical database — this is the property that caps
    // database count at maxWorkers. The unique instance id differs; it must
    // NOT affect the name.
    const fileA = resolveTestScope(
      env({ VITEST_POOL_ID: "1", VITEST_WORKER_ID: "11" }),
    );
    const fileB = resolveTestScope(
      env({ VITEST_POOL_ID: "1", VITEST_WORKER_ID: "12" }),
    );
    expect(fileA.postgresDatabaseName).toBe("exam_test_w1");
    expect(fileB.postgresDatabaseName).toBe("exam_test_w1");
  });

  it("concurrent slots resolve to DIFFERENT databases", () => {
    const slot1 = resolveTestScope(
      env({ VITEST_POOL_ID: "1", VITEST_WORKER_ID: "11" }),
    );
    const slot2 = resolveTestScope(
      env({ VITEST_POOL_ID: "2", VITEST_WORKER_ID: "12" }),
    );
    expect(slot1.postgresDatabaseName).not.toBe(slot2.postgresDatabaseName);
  });
});

describe("resolveTestScope — CI shard worker", () => {
  it("derives shard 1 worker 1 naming", () => {
    const scope = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "1",
        TEST_WORKER_ID: "1",
      }),
    );
    expect(scope.kind).toBe("ci-shard-worker");
    expect(scope.isCi).toBe(true);
    expect(scope.shardIndex).toBe("1");
    expect(scope.scopeId).toBe("s1_w1");
    expect(scope.postgresDatabaseName).toBe("exam_test_s1_w1");
    expect(scope.redisPrefix).toBe("exam:test:s1:w1:");
    expect(scope.queuePrefix).toBe("exam:test:s1:w1");
  });

  it("derives shard 3 worker 2 naming", () => {
    const scope = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "3",
        TEST_WORKER_ID: "2",
      }),
    );
    expect(scope.scopeId).toBe("s3_w2");
    expect(scope.postgresDatabaseName).toBe("exam_test_s3_w2");
    expect(scope.redisPrefix).toBe("exam:test:s3:w2:");
    expect(scope.queuePrefix).toBe("exam:test:s3:w2");
  });

  it("defaults shard index to 1 in CI when unset", () => {
    const scope = resolveTestScope(env({ TEST_INFRA_SCOPE: "ci" }));
    expect(scope.shardIndex).toBe("1");
    expect(scope.scopeId).toBe("s1_w1");
  });

  it("detects CI from CI=true even without TEST_INFRA_SCOPE", () => {
    const scope = resolveTestScope(env({ CI: "true", TEST_SHARD_INDEX: "2" }));
    expect(scope.isCi).toBe(true);
    expect(scope.kind).toBe("ci-shard-worker");
    expect(scope.scopeId).toBe("s2_w1");
  });
});

describe("resolveTestScope — dedicated scopes", () => {
  it("background scope uses its own namespace and worker-enabled queue", () => {
    const scope = resolveTestScope(env({ API_TEST_GROUP: "background" }));
    expect(scope.kind).toBe("background");
    expect(scope.scopeId).toBe("background");
    expect(scope.postgresDatabaseName).toBe("exam_test_background");
    expect(scope.redisPrefix).toBe("exam:test:background:");
    expect(scope.queuePrefix).toBe("exam:test:background");
    expect(scope.queueMode).toBe("worker-enabled");
  });

  it("concurrency scope uses its own namespace", () => {
    const scope = resolveTestScope(env({ API_TEST_GROUP: "concurrency" }));
    expect(scope.kind).toBe("concurrency");
    expect(scope.scopeId).toBe("concurrency");
    expect(scope.postgresDatabaseName).toBe("exam_test_concurrency");
    expect(scope.redisPrefix).toBe("exam:test:concurrency:");
    expect(scope.queuePrefix).toBe("exam:test:concurrency");
  });

  it("e2e scope uses its own namespace", () => {
    const scope = resolveTestScope(env({ API_TEST_GROUP: "e2e" }));
    expect(scope.kind).toBe("e2e");
    expect(scope.scopeId).toBe("e2e");
    expect(scope.postgresDatabaseName).toBe("exam_test_e2e");
    expect(scope.redisPrefix).toBe("exam:test:e2e:");
    expect(scope.queuePrefix).toBe("exam:test:e2e");
  });

  it("dedicated scopes ignore worker/shard env when deriving names", () => {
    const scope = resolveTestScope(
      env({
        API_TEST_GROUP: "background",
        TEST_WORKER_ID: "7",
        TEST_SHARD_INDEX: "4",
        TEST_INFRA_SCOPE: "ci",
      }),
    );
    expect(scope.scopeId).toBe("background");
    expect(scope.postgresDatabaseName).toBe("exam_test_background");
  });
});

describe("resolveTestScope — legacy file-schema fallback", () => {
  it("returns null database name and keeps the legacy flag", () => {
    const scope = resolveTestScope(
      env({ TEST_DB_ISOLATION: "file-schema", TEST_WORKER_ID: "2" }),
    );
    expect(scope.dbIsolation).toBe("file-schema");
    expect(scope.postgresDatabaseName).toBeNull();
    expect(isLegacyFileSchemaMode(scope)).toBe(true);
    // Redis / queue prefixes still derived (they are harmless naming only).
    expect(scope.redisPrefix).toBe("exam:test:local:w2:");
  });

  it("file-schema fallback works for dedicated groups too", () => {
    const scope = resolveTestScope(
      env({ API_TEST_GROUP: "e2e", TEST_DB_ISOLATION: "file-schema" }),
    );
    expect(scope.dbIsolation).toBe("file-schema");
    expect(scope.postgresDatabaseName).toBeNull();
    expect(isLegacyFileSchemaMode(scope)).toBe(true);
  });
});

describe("resolveTestScope — input validation", () => {
  it("rejects an invalid worker identity value from any source", () => {
    expect(() =>
      resolveTestScope(env({ TEST_WORKER_ID: "1; DROP TABLE users" })),
    ).toThrow(/invalid worker identity env/);
    expect(() => resolveTestScope(env({ TEST_WORKER_ID: "w/ slash" }))).toThrow(
      /invalid worker identity env/,
    );
    // Explicit empty override is rejected (not silently treated as unset).
    expect(() => resolveTestScope(env({ TEST_WORKER_ID: "" }))).toThrow(
      /TEST_WORKER_ID/,
    );
    // Runner-controlled values are validated with the same charset.
    expect(() => resolveTestScope(env({ VITEST_POOL_ID: "pool/x" }))).toThrow(
      /invalid worker identity env/,
    );
  });

  it("rejects an invalid shard index", () => {
    expect(() =>
      resolveTestScope(
        env({ TEST_INFRA_SCOPE: "ci", TEST_SHARD_INDEX: "shard" }),
      ),
    ).toThrow(/invalid TEST_SHARD_INDEX/);
    expect(() =>
      resolveTestScope(env({ TEST_INFRA_SCOPE: "ci", TEST_SHARD_INDEX: "-1" })),
    ).toThrow(/invalid TEST_SHARD_INDEX/);
    expect(() =>
      resolveTestScope(env({ TEST_INFRA_SCOPE: "ci", TEST_SHARD_INDEX: "01" })),
    ).toThrow(/invalid TEST_SHARD_INDEX/);
  });

  it("rejects an invalid group", () => {
    expect(() => resolveTestScope(env({ API_TEST_GROUP: "slow" }))).toThrow(
      /invalid API_TEST_GROUP/,
    );
  });

  it("rejects an invalid db isolation mode", () => {
    expect(() =>
      resolveTestScope(env({ TEST_DB_ISOLATION: "magic-schema" })),
    ).toThrow(/invalid TEST_DB_ISOLATION/);
  });

  it("rejects an invalid queue mode", () => {
    expect(() =>
      resolveTestScope(env({ TEST_QUEUE_MODE: "always-on" })),
    ).toThrow(/invalid TEST_QUEUE_MODE/);
  });

  it("allows an explicit queue mode override on ordinary group", () => {
    const scope = resolveTestScope(
      env({ API_TEST_GROUP: "fast", TEST_QUEUE_MODE: "disabled" }),
    );
    expect(scope.queueMode).toBe("disabled");
  });
});

describe("resolveTestScope — derived-name shape invariants", () => {
  it("Redis prefix always ends with ':'", () => {
    for (const group of ["fast", "background", "concurrency", "e2e"] as const) {
      const scope = resolveTestScope(env({ API_TEST_GROUP: group }));
      expect(scope.redisPrefix.endsWith(":")).toBe(true);
    }
    const ci = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "5",
        TEST_WORKER_ID: "9",
      }),
    );
    expect(ci.redisPrefix.endsWith(":")).toBe(true);
  });

  it("Queue prefix never ends with ':'", () => {
    for (const group of ["fast", "background", "concurrency", "e2e"] as const) {
      const scope = resolveTestScope(env({ API_TEST_GROUP: group }));
      expect(scope.queuePrefix.endsWith(":")).toBe(false);
    }
    const ci = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "5",
        TEST_WORKER_ID: "9",
      }),
    );
    expect(ci.queuePrefix.endsWith(":")).toBe(false);
  });

  it("postgres database name contains only lowercase letters, digits, underscore", () => {
    const cases = [
      env({ TEST_WORKER_ID: "1" }),
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "3",
        TEST_WORKER_ID: "2",
      }),
      env({ API_TEST_GROUP: "background" }),
      env({ API_TEST_GROUP: "concurrency" }),
      env({ API_TEST_GROUP: "e2e" }),
    ];
    for (const e of cases) {
      const scope = resolveTestScope(e);
      expect(scope.postgresDatabaseName).not.toBeNull();
      expect(scope.postgresDatabaseName).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("does not exceed the PostgreSQL identifier length limit", () => {
    const huge = "w" + "0".repeat(200);
    expect(() => resolveTestScope(env({ TEST_WORKER_ID: huge }))).toThrow(
      /exceeds 63 chars/,
    );
  });
});

describe("resolveTestScope — helper accessors", () => {
  it("resolvePostgresDatabaseName / resolveRedisPrefix / resolveQueuePrefix proxy the scope", () => {
    const scope = resolveTestScope(
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "2",
        TEST_WORKER_ID: "3",
      }),
    );
    expect(resolvePostgresDatabaseName(scope)).toBe("exam_test_s2_w3");
    expect(resolveRedisPrefix(scope)).toBe("exam:test:s2:w3:");
    expect(resolveQueuePrefix(scope)).toBe("exam:test:s2:w3");
  });

  it("resolvePostgresDatabaseName returns null under file-schema", () => {
    const scope = resolveTestScope(
      env({ TEST_DB_ISOLATION: "file-schema", TEST_WORKER_ID: "1" }),
    );
    expect(resolvePostgresDatabaseName(scope)).toBeNull();
  });
});

describe("resolveTestScope — no external dependencies", () => {
  // Guard rail: this test file must never require a live DB. We assert that
  // resolution works with a totally empty env and no network in play.
  it("resolves with an empty env and no DB service", () => {
    const scope = resolveTestScope(env());
    expect(scope.scopeId).toBe("local_w1");
    expect(scope.postgresDatabaseName).toBe("exam_test_w1");
  });
});

describe("resolveDbPackageTestScope — @exam/db package worker-slot namespace (#648)", () => {
  it("derives the package slot name for the local default pool id", () => {
    const scope = resolveDbPackageTestScope(env({ TEST_WORKER_ID: "1" }));
    expect(scope.postgresDatabaseName).toBe("exam_test_db_w1");
  });

  it("is deterministic: same env, same slot name", () => {
    const e = env({ TEST_WORKER_ID: "2" });
    expect(resolveDbPackageTestScope(e).postgresDatabaseName).toBe(
      resolveDbPackageTestScope(e).postgresDatabaseName,
    );
  });

  it("pool id bounds the slot name: distinct pool ids → distinct slots", () => {
    const w1 = resolveDbPackageTestScope(
      env({ TEST_WORKER_ID: "1" }),
    ).postgresDatabaseName;
    const w2 = resolveDbPackageTestScope(
      env({ TEST_WORKER_ID: "2" }),
    ).postgresDatabaseName;
    expect(w1).toBe("exam_test_db_w1");
    expect(w2).toBe("exam_test_db_w2");
    expect(w1).not.toBe(w2);
  });

  it("derives the CI shard+pool name and never equals the API slot", () => {
    const e = env({
      TEST_INFRA_SCOPE: "ci",
      TEST_SHARD_INDEX: "3",
      TEST_WORKER_ID: "2",
    });
    const dbScope = resolveDbPackageTestScope(e);
    expect(dbScope.postgresDatabaseName).toBe("exam_test_db_s3_w2");
    expect(dbScope.postgresDatabaseName).not.toBe(
      resolveTestScope(e).postgresDatabaseName,
    );
  });

  it("overrides only the slot-identity fields; run taxonomy facts are preserved", () => {
    const e = env({ TEST_WORKER_ID: "2" });
    const api = resolveTestScope(e);
    const dbPkg = resolveDbPackageTestScope(e);
    expect(dbPkg.scopeId).toBe(api.scopeId);
    expect(dbPkg.workerId).toBe(api.workerId);
    expect(dbPkg.shardIndex).toBe(api.shardIndex);
    expect(dbPkg.dbIsolation).toBe(api.dbIsolation);
    expect(dbPkg.redisPrefix).toBe(api.redisPrefix);
    expect(dbPkg.queuePrefix).toBe(api.queuePrefix);
  });

  it("package slot names are disjoint from every API slot name shape", () => {
    // The API grammar after `exam_test_` is `w*`, `s*_w*`, or a dedicated
    // group — never the literal `db_` segment, so the namespaced slot can
    // never collide with an API slot on a shared server.
    const envs = [
      env({ TEST_WORKER_ID: "1" }),
      env({ TEST_WORKER_ID: "3" }),
      env({
        TEST_INFRA_SCOPE: "ci",
        TEST_SHARD_INDEX: "2",
        TEST_WORKER_ID: "1",
      }),
      env({ API_TEST_GROUP: "background" }),
    ];
    for (const e of envs) {
      const apiName = resolveTestScope(e).postgresDatabaseName;
      const dbPkgName = resolveDbPackageTestScope(e).postgresDatabaseName;
      expect(dbPkgName).not.toBe(apiName);
      expect(dbPkgName).toMatch(/^exam_test_db_/);
    }
  });

  it("fails loudly under file-schema isolation (no slot database exists)", () => {
    expect(() =>
      resolveDbPackageTestScope(env({ TEST_DB_ISOLATION: "file-schema" })),
    ).toThrow(/requires worker-database isolation/);
  });

  it("keeps the runner fail-fast: Vitest without a pool id still hard-fails", () => {
    expect(() => resolveDbPackageTestScope(env({ VITEST: "true" }))).toThrow(
      /VITEST_POOL_ID is required/,
    );
  });
});

describe("resolveDbPackageTestScope — API_TEST_GROUP must not collapse package slots (#648)", () => {
  // Turbo passes API_TEST_GROUP through DB-backed tasks, so a dedicated API
  // group can be present in a plain @exam/db invocation. The package slot
  // identity is owned ONLY by the worker slot (+ shard in CI); the API
  // dedicated-group namespace (exam_test_<group>) must never leak into the
  // physical package slot name — sibling Vitest workers of ONE invocation
  // would otherwise share one database and resetPostgres() each other's
  // fixtures mid-file.
  const dedicatedGroups = ["background", "concurrency", "e2e"] as const;

  it.each(dedicatedGroups)(
    "API_TEST_GROUP=%s: distinct pool ids stay on distinct package slots",
    (group) => {
      const pool1 = resolveDbPackageTestScope(
        env({ API_TEST_GROUP: group, VITEST_POOL_ID: "1" }),
      );
      const pool2 = resolveDbPackageTestScope(
        env({ API_TEST_GROUP: group, VITEST_POOL_ID: "2" }),
      );
      expect(pool1.postgresDatabaseName).toBe("exam_test_db_w1");
      expect(pool2.postgresDatabaseName).toBe("exam_test_db_w2");
      expect(pool1.postgresDatabaseName).not.toBe(pool2.postgresDatabaseName);
    },
  );

  it.each(dedicatedGroups)(
    "API_TEST_GROUP=%s: the slot name never contains the group segment",
    (group) => {
      const scope = resolveDbPackageTestScope(
        env({ API_TEST_GROUP: group, VITEST_POOL_ID: "1" }),
      );
      expect(scope.postgresDatabaseName).not.toContain(group);
      expect(scope.postgresDatabaseName).toMatch(/^exam_test_db_w/);
    },
  );

  it("CI: dedicated group keeps shard+pool identity (s3, w1/w2)", () => {
    const base = {
      API_TEST_GROUP: "background",
      TEST_INFRA_SCOPE: "ci",
      TEST_SHARD_INDEX: "3",
    } as const;
    const w1 = resolveDbPackageTestScope(env({ ...base, VITEST_POOL_ID: "1" }));
    const w2 = resolveDbPackageTestScope(env({ ...base, VITEST_POOL_ID: "2" }));
    expect(w1.postgresDatabaseName).toBe("exam_test_db_s3_w1");
    expect(w2.postgresDatabaseName).toBe("exam_test_db_s3_w2");
    expect(w1.postgresDatabaseName).not.toBe(w2.postgresDatabaseName);
  });

  it("ordinary group unchanged: pool-only local name, TEST_WORKER_ID wins over VITEST_POOL_ID", () => {
    const scope = resolveDbPackageTestScope(
      env({ VITEST_POOL_ID: "2", TEST_WORKER_ID: "7" }),
    );
    expect(scope.postgresDatabaseName).toBe("exam_test_db_w7");
  });

  it("slot-identity fields describe the physical slot even under a dedicated API group", () => {
    const scope = resolveDbPackageTestScope(
      env({ API_TEST_GROUP: "background", VITEST_POOL_ID: "4" }),
    );
    expect(scope.workerId).toBe("4");
    expect(scope.postgresDatabaseName).toBe("exam_test_db_w4");
  });

  it("the package slot stays disjoint from the API dedicated-group database", () => {
    const e = env({ API_TEST_GROUP: "background", VITEST_POOL_ID: "1" });
    expect(resolveDbPackageTestScope(e).postgresDatabaseName).not.toBe(
      resolveTestScope(e).postgresDatabaseName,
    );
  });
});

describe("resolveDbIsolationMode — mode-only read (main-process safe)", () => {
  it("unset / empty / whitespace default to worker-database", () => {
    expect(resolveDbIsolationMode(env({}))).toBe("worker-database");
    expect(resolveDbIsolationMode(env({ TEST_DB_ISOLATION: "" }))).toBe(
      "worker-database",
    );
    expect(resolveDbIsolationMode(env({ TEST_DB_ISOLATION: "  " }))).toBe(
      "worker-database",
    );
  });

  it("echoes both supported modes", () => {
    expect(
      resolveDbIsolationMode(env({ TEST_DB_ISOLATION: "file-schema" })),
    ).toBe("file-schema");
    expect(
      resolveDbIsolationMode(env({ TEST_DB_ISOLATION: "worker-database" })),
    ).toBe("worker-database");
  });

  it("fails fast on invalid values (same error as the full resolver)", () => {
    expect(() =>
      resolveDbIsolationMode(env({ TEST_DB_ISOLATION: "magic-schema" })),
    ).toThrow(/invalid TEST_DB_ISOLATION/);
  });

  it("never resolves a worker identity: safe without VITEST_POOL_ID under Vitest", () => {
    expect(() => resolveDbIsolationMode(env({ VITEST: "true" }))).not.toThrow();
    expect(resolveDbIsolationMode(env({ VITEST: "true" }))).toBe(
      "worker-database",
    );
  });
});
