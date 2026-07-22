/**
 * Stateful test scope / datasource resolver (ADR-007 Phase 2A skeleton).
 *
 * This module is PURE RESOLUTION LOGIC. It must NOT:
 *   - connect to PostgreSQL
 *   - create or drop a database
 *   - create or drop a schema
 *   - run a migration
 *   - connect to Redis
 *   - create a queue or start a worker
 *   - start a timer / interval
 *
 * It only turns the current test-run environment (env vars set by the runner
 * or the developer) into a single {@link ResolvedTestScope} that the rest of
 * the harness can later bind to a PostgreSQL database, a Redis key prefix, a
 * queue prefix, and a background-worker lifecycle.
 *
 * Non-goals of this PR (see ADR-007 + docs/archive/dev/test-ci-parallelism-plan.md):
 *   - Does NOT open `fileParallelism: true`.
 *   - Does NOT change `maxWorkers` defaults.
 *   - Does NOT create real worker databases (that is Phase 3).
 *   - Does NOT remove the legacy `file-schema` fallback (it is preserved here).
 *   - Does NOT remove the existing per-file schema helper in `testIsolation.ts`.
 *   - Does NOT remove any BUG-FLAKE-001 mitigation.
 *
 * The legacy per-file schema mechanism (`testIsolation.ts`) keeps working
 * unchanged. This resolver only provides a uniform naming surface so future
 * phases can adopt per-worker databases without renaming resources again.
 *
 * NOTE on the shared env var name `TEST_DB_ISOLATION`: this module and
 * `testIsolation.ts` BOTH read `process.env.TEST_DB_ISOLATION` but interpret it
 * DIFFERENTLY:
 *   - here: `"file-schema" | "worker-database"` (which isolation strategy)
 *   - `testIsolation.ts`: `"1" | "true" | "0"` (enable/disable the helper)
 * The two value sets are disjoint, so there is no current conflict while this
 * resolver is not yet wired into any runner. A future Phase 3 integrator MUST
 * reconcile these before pointing the test factories at this resolver.
 */

/** Kind of test scope, mirrors ADR-007 §1. */
export type TestInfraScopeKind =
  | "local-worker"
  | "ci-shard-worker"
  | "background"
  | "concurrency"
  | "e2e";

/** Test group, mirrors docs/archive/dev/test-suite-taxonomy.md. */
export type TestGroup = "fast" | "background" | "concurrency" | "e2e" | "all";

/** PostgreSQL isolation strategy. */
export type TestDbIsolationMode = "file-schema" | "worker-database";

/** Queue worker involvement for the current scope. */
export type TestQueueMode = "disabled" | "producer-only" | "worker-enabled";

/** Fully resolved test scope. Pure data; safe to log / snapshot. */
export interface ResolvedTestScope {
  /** Opaque scope id (e.g. `local_w2`, `s3_w2`, `background`, `e2e`). */
  scopeId: string;
  /** Which scope kind this is. */
  kind: TestInfraScopeKind;
  /** Test taxonomy group. */
  group: TestGroup;
  /** PostgreSQL isolation strategy. */
  dbIsolation: TestDbIsolationMode;
  /**
   * Derived PostgreSQL database name, or `null` when isolation is
   * `file-schema` (the legacy path does not own a worker database).
   */
  postgresDatabaseName: string | null;
  /** Redis key prefix, always ending with `:`. */
  redisPrefix: string;
  /** Queue prefix, never ending with `:`. */
  queuePrefix: string;
  /** Queue worker involvement for this scope. */
  queueMode: TestQueueMode;
  /** Shard index: `"local"` for local runs, or a numeric string in CI. */
  shardIndex: string;
  /** Resolved worker id (from the runner, never hand-set unless as fallback). */
  workerId: string;
  /** Whether this run is treated as CI. */
  isCi: boolean;
}

/** Sentinel env object for callers that want process.env defaults. */
export type ResolverEnv = NodeJS.ProcessEnv;

const GROUPS: readonly TestGroup[] = [
  "fast",
  "background",
  "concurrency",
  "e2e",
  "all",
];
const DB_ISOLATIONS: readonly TestDbIsolationMode[] = [
  "file-schema",
  "worker-database",
];
const QUEUE_MODES: readonly TestQueueMode[] = [
  "disabled",
  "producer-only",
  "worker-enabled",
];

/**
 * Worker id charset: alphanumerics, underscore, hyphen.
 * Rejects anything that could escape an identifier or a filesystem path.
 */
const WORKER_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Shard index: literal "local" or a positive integer string.
 * No leading zeros beyond "0" semantics — "1".."999" allowed.
 */
const SHARD_LOCAL = "local";
const SHARD_INDEX_RE = /^(0|[1-9][0-9]*)$/;

/** PostgreSQL name charset for derived database names. */
const PG_NAME_SAFE_RE = /^[a-z0-9_]+$/;

/** PostgreSQL identifier length limit (NAMEDATALEN-1 default). */
const PG_NAME_MAX_LEN = 63;

/** Shared error prefix so tests / logs can recognize resolver failures. */
const ERR_PREFIX = "[testScope]";

function fail(message: string): never {
  throw new Error(`${ERR_PREFIX} ${message}`);
}

function readString(env: ResolverEnv, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Like {@link readString}, but distinguishes "unset" from "set to empty".
 * Returns `"unset"` / `"empty"` / the trimmed value so callers can reject
 * explicit empties instead of silently falling back.
 */
function readStringStrict(
  env: ResolverEnv,
  key: string,
): { kind: "unset" } | { kind: "empty" } | { kind: "value"; value: string } {
  const v = env[key];
  if (v === undefined) return { kind: "unset" };
  const trimmed = v.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  return { kind: "value", value: trimmed };
}

/**
 * Resolve the worker id.
 *
 * Resolution order (ADR-007):
 *   1. `TEST_WORKER_ID` — explicit manual override (wins if set).
 *   2. `VITEST_WORKER_ID` — injected automatically by the Vitest runner.
 *   3. `"1"` — final fallback.
 *
 * Developers normally do NOT set `TEST_WORKER_ID`; the runner-provided
 * `VITEST_WORKER_ID` is the expected source. `TEST_WORKER_ID` exists as an
 * explicit override / fallback for environments that do not inject a runner id.
 */
function resolveWorkerId(env: ResolverEnv): string {
  // `TEST_WORKER_ID` takes precedence when set (manual override). An
  // explicitly-set-but-empty value is rejected rather than silently treated as
  // "unset" — empties do not match the allowed charset.
  const explicit = readStringStrict(env, "TEST_WORKER_ID");
  if (explicit.kind === "empty") {
    fail("TEST_WORKER_ID is set but empty (allowed: [A-Za-z0-9_-])");
  }
  // VITEST_WORKER_ID is runner-controlled, so empty/whitespace is treated as
  // "unset" (lenient) rather than rejected.
  const fromRunner = readString(env, "VITEST_WORKER_ID");
  const raw = explicit.kind === "value" ? explicit.value : (fromRunner ?? "1");
  if (!WORKER_ID_RE.test(raw)) {
    fail(
      `invalid TEST_WORKER_ID / VITEST_WORKER_ID: "${raw}" (allowed: [A-Za-z0-9_-])`,
    );
  }
  return raw;
}

function resolveShardIndex(env: ResolverEnv, isCi: boolean): string {
  const raw = readString(env, "TEST_SHARD_INDEX");
  if (raw === undefined) return isCi ? "1" : SHARD_LOCAL;
  if (raw === SHARD_LOCAL) return SHARD_LOCAL;
  if (!SHARD_INDEX_RE.test(raw)) {
    fail(
      `invalid TEST_SHARD_INDEX: "${raw}" (allowed: "local" or a positive integer)`,
    );
  }
  return raw;
}

function resolveGroup(env: ResolverEnv): TestGroup {
  const raw = readString(env, "API_TEST_GROUP") ?? "fast";
  if (!GROUPS.includes(raw as TestGroup)) {
    fail(`invalid API_TEST_GROUP: "${raw}" (allowed: ${GROUPS.join(", ")})`);
  }
  return raw as TestGroup;
}

function resolveDbIsolation(env: ResolverEnv): TestDbIsolationMode {
  const raw = readString(env, "TEST_DB_ISOLATION") ?? "worker-database";
  if (!DB_ISOLATIONS.includes(raw as TestDbIsolationMode)) {
    fail(
      `invalid TEST_DB_ISOLATION: "${raw}" (allowed: ${DB_ISOLATIONS.join(", ")})`,
    );
  }
  return raw as TestDbIsolationMode;
}

function resolveQueueMode(env: ResolverEnv, group: TestGroup): TestQueueMode {
  const explicit = readString(env, "TEST_QUEUE_MODE");
  if (explicit !== undefined) {
    if (!QUEUE_MODES.includes(explicit as TestQueueMode)) {
      fail(
        `invalid TEST_QUEUE_MODE: "${explicit}" (allowed: ${QUEUE_MODES.join(", ")})`,
      );
    }
    return explicit as TestQueueMode;
  }
  // ADR-007: background tests need real workers; others are producer-only /
  // disabled by default. `all` follows the ordinary default (producer-only).
  if (group === "background") return "worker-enabled";
  return "producer-only";
}

/**
 * Validate a derived PostgreSQL database name. Only safe characters and a
 * sane length are allowed; we never silently sanitize a derived name.
 */
function assertPgNameSafe(name: string): void {
  if (!PG_NAME_SAFE_RE.test(name)) {
    fail(
      `derived postgres database name contains unsafe characters: "${name}"`,
    );
  }
  if (name.length === 0) {
    fail("derived postgres database name is empty");
  }
  if (name.length > PG_NAME_MAX_LEN) {
    fail(
      `derived postgres database name exceeds ${PG_NAME_MAX_LEN} chars: "${name}" (${name.length})`,
    );
  }
  if (/^[0-9]/.test(name)) {
    fail(
      `derived postgres database name must not start with a digit: "${name}"`,
    );
  }
}

/** Dedicated single-namespace groups (no worker / shard suffix). */
function isDedicatedGroup(
  group: TestGroup,
): group is "background" | "concurrency" | "e2e" {
  return group === "background" || group === "concurrency" || group === "e2e";
}

/**
 * Resolve the full test scope from the given environment (defaults to
 * `process.env`). Pure function: no I/O, no side effects.
 */
export function resolveTestScope(
  env: ResolverEnv = process.env,
): ResolvedTestScope {
  const group = resolveGroup(env);
  const dbIsolation = resolveDbIsolation(env);
  const queueMode = resolveQueueMode(env, group);

  const scopeInfra = readString(env, "TEST_INFRA_SCOPE");
  const isCi =
    scopeInfra === "ci" ||
    readString(env, "CI") === "true" ||
    readString(env, "GITHUB_ACTIONS") === "true";

  let kind: TestInfraScopeKind;
  let scopeId: string;
  let namespaceSegment: string;
  let shardIndex: string;
  let workerId: string;

  if (isDedicatedGroup(group)) {
    kind = group;
    scopeId = group;
    namespaceSegment = group;
    // Dedicated scopes are single-namespace; shard/worker are informational
    // only and do not appear in the scope id or derived names.
    shardIndex = SHARD_LOCAL;
    workerId = group;
  } else {
    workerId = resolveWorkerId(env);
    shardIndex = resolveShardIndex(env, isCi);
    if (isCi) {
      kind = "ci-shard-worker";
      scopeId = `s${shardIndex}_w${workerId}`;
      namespaceSegment = `s${shardIndex}:w${workerId}`;
    } else {
      kind = "local-worker";
      scopeId = `local_w${workerId}`;
      namespaceSegment = `local:w${workerId}`;
    }
  }

  const postgresDatabaseName = derivePostgresDatabaseName({
    group,
    dbIsolation,
    isCi,
    shardIndex,
    workerId,
  });

  // Redis / Queue prefixes use the colon-separated namespace segment
  // (e.g. `exam:test:local:w2:`, `exam:test:s3:w2:`), NOT the underscore
  // scopeId. The scopeId is an opaque identifier; the prefix is a readable,
  // hierarchically-scoped Redis key prefix per ADR-007 §3/§4.
  const redisPrefix = deriveRedisPrefix({ namespaceSegment });
  const queuePrefix = deriveQueuePrefix({ namespaceSegment });

  return {
    scopeId,
    kind,
    group,
    dbIsolation,
    postgresDatabaseName,
    redisPrefix,
    queuePrefix,
    queueMode,
    shardIndex,
    workerId,
    isCi,
  };
}

interface DeriveNameInput {
  group: TestGroup;
  dbIsolation: TestDbIsolationMode;
  isCi: boolean;
  shardIndex: string;
  workerId: string;
}

/**
 * Derive the PostgreSQL database name.
 *
 * Returns `null` when isolation is `file-schema` (the legacy path owns no
 * worker database). For dedicated groups, the name is `exam_test_<group>`.
 * For ordinary groups, it is `exam_test_w{worker}` locally and
 * `exam_test_s{shard}_w{worker}` in CI.
 */
function derivePostgresDatabaseName(input: DeriveNameInput): string | null {
  if (input.dbIsolation === "file-schema") return null;

  let name: string;
  if (isDedicatedGroup(input.group)) {
    name = `exam_test_${input.group}`;
  } else if (input.isCi) {
    name = `exam_test_s${input.shardIndex}_w${input.workerId}`;
  } else {
    name = `exam_test_w${input.workerId}`;
  }
  assertPgNameSafe(name);
  return name;
}

interface PrefixInput {
  namespaceSegment: string;
}

/** Derive the Redis key prefix for the scope; always ends with `:`. */
function deriveRedisPrefix({ namespaceSegment }: PrefixInput): string {
  return `exam:test:${namespaceSegment}:`;
}

/** Derive the queue prefix for the scope; never ends with `:`. */
function deriveQueuePrefix({ namespaceSegment }: PrefixInput): string {
  return `exam:test:${namespaceSegment}`;
}

/**
 * Resolve the PostgreSQL database name for a resolved scope.
 * Returns `null` when the scope is in `file-schema` isolation.
 */
export function resolvePostgresDatabaseName(
  scope: ResolvedTestScope,
): string | null {
  return scope.postgresDatabaseName;
}

/** Resolve the Redis key prefix for a resolved scope. */
export function resolveRedisPrefix(scope: ResolvedTestScope): string {
  return scope.redisPrefix;
}

/** Resolve the queue prefix for a resolved scope. */
export function resolveQueuePrefix(scope: ResolvedTestScope): string {
  return scope.queuePrefix;
}

/**
 * Resolve the legacy file-schema fallback. When `TEST_DB_ISOLATION=file-schema`,
 * callers should keep using the existing `testIsolation.ts` per-file schema
 * helper against whatever `TEST_DATABASE_URL` / `DATABASE_URL` points at.
 * This resolver does not derive a worker database in that mode.
 */
export function isLegacyFileSchemaMode(scope: ResolvedTestScope): boolean {
  return scope.dbIsolation === "file-schema";
}

/**
 * Constants exported for callers / tests that need to reason about the
 * allowed sets without hardcoding them.
 */
export const TEST_SCOPE_CONSTANTS = {
  groups: GROUPS,
  dbIsolations: DB_ISOLATIONS,
  queueModes: QUEUE_MODES,
  pgNameMaxLen: PG_NAME_MAX_LEN,
} as const;
