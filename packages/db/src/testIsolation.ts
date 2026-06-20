import postgres from "postgres";

/**
 * Sanitize a string to be a valid PostgreSQL schema identifier.
 * Rules:
 *   - Only [a-zA-Z0-9_] allowed
 *   - Lowercased
 *   - Max 63 characters
 *   - Must not start with a digit
 */
export function sanitizeSchemaName(input: string): string {
  let cleaned = input
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+/, "");
  if (cleaned.length === 0 || /^[0-9]/.test(cleaned)) {
    cleaned = `s_${cleaned}`;
  }
  if (cleaned.length > 63) {
    cleaned = cleaned.slice(0, 63).replace(/_+$/, "");
  }
  return cleaned;
}

/**
 * Quote a PostgreSQL identifier safely (double-quote with escaped double-quotes).
 */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Build a schema name from parts.
 * Format: test_<namespace>_<worker>_<pid>_<random6>
 */
export function buildSchemaName(
  namespace: string,
  workerId?: string,
  pid?: number,
  random?: string,
): string {
  const parts = ["test", namespace];
  if (workerId) parts.push(workerId);
  if (pid !== undefined) parts.push(String(pid));
  if (random) parts.push(random);
  return sanitizeSchemaName(parts.join("_"));
}

const RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length = 6): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)];
  }
  return result;
}

let _nameCounter = 0;

/**
 * Generate a unique schema name with an auto-incrementing counter + random
 * suffix to guarantee uniqueness even within the same process.
 */
export function generateUniqueSchemaName(
  namespace: string,
  workerId?: string,
): string {
  _nameCounter++;
  const pid = process.pid;
  const rand = randomSuffix(6);
  return buildSchemaName(namespace, workerId, pid, `${_nameCounter}_${rand}`);
}

/**
 * Check if a URL already has query parameters.
 */
function hasQueryParams(url: string): boolean {
  return url.includes("?");
}

/**
 * Add `search_path` to a PostgreSQL connection URL.
 *
 * Uses the `?options=-c search_path=...` mechanism, which applies the setting
 * to every connection from the pool at startup time — not just the first one.
 *
 * @param databaseUrl - Original PG connection URL (e.g. postgresql://exam:exam@localhost:5432/exam_test)
 * @param schemaName  - The isolated schema name to set as first search_path entry
 * @returns URL with search_path appended
 */
export function addSearchPathToUrl(
  databaseUrl: string,
  schemaName: string,
): string {
  const separator = hasQueryParams(databaseUrl) ? "&" : "?";
  const encoded = encodeURIComponent(`-c search_path=${schemaName},public`);
  return `${databaseUrl}${separator}options=${encoded}`;
}

/**
 * Extract the base database URL (without search_path options) for admin
 * operations like CREATE/DROP SCHEMA.
 */
export function stripOptionsFromUrl(databaseUrl: string): string {
  return databaseUrl.replace(/[?&]options=[^&]+/, "").replace(/[?&]$/, "");
}

/**
 * Create a temporary connection for admin DDL operations (CREATE/DROP SCHEMA).
 */
async function withAdminConnection<T>(
  databaseUrl: string,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const adminUrl = stripOptionsFromUrl(databaseUrl);
  const sql = postgres(adminUrl);
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Create an isolated schema in the PostgreSQL database.
 * Idempotent — safe to call multiple times.
 */
export async function createTestSchema(
  databaseUrl: string,
  schemaName: string,
): Promise<void> {
  await withAdminConnection(databaseUrl, async (sql) => {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`);
  });
}

/**
 * Drop an isolated schema and all its contents.
 * Idempotent — safe to call multiple times.
 */
export async function dropTestSchema(
  databaseUrl: string,
  schemaName: string,
): Promise<void> {
  if (!schemaName.startsWith("test_")) {
    throw new Error(
      `Refusing to drop schema "${schemaName}" — does not start with "test_"`,
    );
  }
  await withAdminConnection(databaseUrl, async (sql) => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`);
  });
}

/**
 * Options for {@link setupIsolatedTestDb}.
 */
export interface TestDbIsolationOptions {
  /** Namespace for the schema (e.g. "api", "db", "api-coverage", "db-coverage"). */
  namespace: string;
  /** Optional worker/process identifier. */
  workerId?: string;
  /** Base database URL (without search_path). Falls back to TEST_DATABASE_URL then DATABASE_URL. */
  databaseUrl?: string;
  /** If true, the schema will NOT be dropped on cleanup (useful for debugging). */
  keepSchema?: boolean;
}

/**
 * Result of {@link setupIsolatedTestDb}.
 */
export interface IsolatedTestDb {
  /** The created schema name. */
  schemaName: string;
  /** The base database URL (without search_path). Pass as first arg to createDatabase(). */
  databaseUrl: string;
  /** Cleanup function that drops the schema (unless keepSchema is true). */
  cleanup: () => Promise<void>;
}

/**
 * Resolve the base database URL from options or environment.
 */
function resolveBaseUrl(options: TestDbIsolationOptions): string {
  if (options.databaseUrl) return stripOptionsFromUrl(options.databaseUrl);
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://exam:exam@localhost:5432/exam_test"
  );
}

/**
 * Set up an isolated test schema:
 * 1. Generate a unique schema name
 * 2. CREATE SCHEMA IF NOT EXISTS
 * 3. Return the schema name and base database URL
 *    (callers pass `schemaName` as the second arg to `createDatabase()`)
 * 4. Return cleanup() that DROP SCHEMA CASCADE
 */
export async function setupIsolatedTestDb(
  options: TestDbIsolationOptions,
): Promise<IsolatedTestDb> {
  const baseUrl = resolveBaseUrl(options);
  const schemaName = generateUniqueSchemaName(
    options.namespace,
    options.workerId,
  );

  await createTestSchema(baseUrl, schemaName);

  if (options.keepSchema) {
    process.stdout.write(
      `[testIsolation] KEEP schema ${schemaName} (TEST_DB_KEEP_SCHEMA=1)\n`,
    );
  }

  return {
    schemaName,
    databaseUrl: baseUrl,
    cleanup: async () => {
      if (options.keepSchema) {
        process.stdout.write(
          `[testIsolation] SKIP drop schema ${schemaName} (keepSchema=true)\n`,
        );
        return;
      }
      try {
        await dropTestSchema(baseUrl, schemaName);
      } catch (err) {
        process.stderr.write(
          `[testIsolation] WARN: failed to drop schema ${schemaName}: ${err}\n`,
        );
      }
    },
  };
}

/**
 * Run a function with an isolated test schema, then tear it down.
 * Convenience wrapper for `setupIsolatedTestDb` + `fn(ctx)` + `cleanup()`.
 */
export async function withIsolatedTestSchema<T>(
  options: TestDbIsolationOptions,
  fn: (ctx: { schemaName: string; databaseUrl: string }) => Promise<T>,
): Promise<T> {
  const db = await setupIsolatedTestDb(options);
  try {
    return await fn({
      schemaName: db.schemaName,
      databaseUrl: db.databaseUrl,
    });
  } finally {
    await db.cleanup();
  }
}

/**
 * Check whether test DB isolation is enabled.
 * Defaults to true when TEST_DB_ISOLATION is not set or set to "1".
 * Set TEST_DB_ISOLATION=0 to disable.
 */
export function isTestDbIsolationEnabled(): boolean {
  const val = process.env.TEST_DB_ISOLATION;
  if (val === undefined || val === "") return true;
  return val === "1" || val === "true";
}

/**
 * Resolve the test namespace from environment or defaults.
 */
export function resolveTestNamespace(fallback = "test"): string {
  return process.env.TEST_DB_NAMESPACE || fallback;
}
