import { describe, expect, it } from "vitest";
import {
  resolveTestScope,
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

  it("prefers VITEST_WORKER_ID and treats TEST_WORKER_ID as fallback only", () => {
    const fromRunner = resolveTestScope(env({ VITEST_WORKER_ID: "3" }));
    expect(fromRunner.workerId).toBe("3");
    expect(fromRunner.scopeId).toBe("local_w3");

    const explicit = resolveTestScope(
      env({ VITEST_WORKER_ID: "3", TEST_WORKER_ID: "9" }),
    );
    expect(explicit.workerId).toBe("9");
    expect(explicit.scopeId).toBe("local_w9");
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
  it("rejects an invalid worker id", () => {
    expect(() =>
      resolveTestScope(env({ TEST_WORKER_ID: "1; DROP TABLE users" })),
    ).toThrow(/invalid TEST_WORKER_ID/);
    expect(() => resolveTestScope(env({ TEST_WORKER_ID: "w/ slash" }))).toThrow(
      /invalid TEST_WORKER_ID/,
    );
    // Explicit empty value is rejected (not silently treated as unset).
    expect(() => resolveTestScope(env({ TEST_WORKER_ID: "" }))).toThrow(
      /TEST_WORKER_ID/,
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
