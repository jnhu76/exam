import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { quoteIdent } from "./testIsolation.js";
import { schema } from "./schema/pg.js";

/** Returns true if the URL uses the `postgresql://` or `postgres://` scheme. */
export function isPostgresqlUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/** A PostgreSQL database connection holding the raw `sql` driver and typed `db` instance. */
export interface PostgresDatabaseConnection {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof schema>;
}

/**
 * Opens a PostgreSQL connection via `postgres` and returns a typed Drizzle
 * instance bound to the schema.
 * @param databaseUrl - Full PostgreSQL connection string.
 * @param searchPath - Optional schema name for test isolation. When set,
 *   creates a single-connection pool and sets `search_path` to the given
 *   schema (without `public`, to avoid `CREATE TABLE IF NOT EXISTS` skipping
 *   when tables already exist in the `public` schema).
 */
export async function createPostgresDatabase(
  databaseUrl: string,
  searchPath?: string,
): Promise<PostgresDatabaseConnection> {
  const sql = searchPath
    ? postgres(databaseUrl, { max: 1 })
    : postgres(databaseUrl);
  if (searchPath) {
    // NOTE: deliberately omit `, public` from search_path here, because
    // Drizzle's migration SQL files use `CREATE TABLE IF NOT EXISTS` and
    // PostgreSQL checks the entire search_path for existing relations before
    // creating. If `public` is in the path and the table already exists there,
    // the creation is silently skipped and the isolated schema stays empty.
    // Test queries that need to access the isolated schema AND fall back to
    // public must set search_path explicitly per-connection (e.g. in
    // testHelpers that use the URL's search_path or raw SET after connect).
    await sql.unsafe(`SET search_path TO ${quoteIdent(searchPath)}`);
  }
  const db = drizzle(sql, { schema });
  return { sql, db };
}

/**
 * Options for {@link migratePostgres}.
 */
export interface MigratePostgresOptions {
  /**
   * PostgreSQL schema to store the `__drizzle_migrations` tracking table.
   * When provided, each isolated test schema gets its own migration tracking
   * table, so Drizzle re-applies migrations instead of skipping them (as it
   * would when the shared `drizzle` schema already has the same migration
   * hashes recorded).
   */
  migrationsSchema?: string;
}

/**
 * Runs pending Drizzle migrations against the PostgreSQL database.
 * Silently ignores `42P07` (duplicate table) errors that occur when
 * concurrent workers apply migrations simultaneously.
 * @param db - Drizzle database instance to migrate.
 * @param options - Optional. When `migrationsSchema` is set, Drizzle stores
 *   the `__drizzle_migrations` tracking table in that schema instead of the
 *   shared `drizzle` schema, allowing per-schema isolation.
 */
export async function migratePostgres(
  db: PostgresJsDatabase<typeof schema>,
  options?: MigratePostgresOptions,
): Promise<void> {
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations/postgres", import.meta.url),
      ),
      ...(options?.migrationsSchema
        ? { migrationsSchema: options.migrationsSchema }
        : {}),
    });
  } catch (err: unknown) {
    if (isDuplicateTableDuringMigration(err)) {
      // concurrent worker already applied — safe to ignore
    } else {
      throw err;
    }
  }
}

/** Checks whether an error is a PostgreSQL `42P07` duplicate-table error. */
function isDuplicateTableDuringMigration(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    code?: string;
    message?: string;
    cause?: { code?: string };
  };
  return e.code === "42P07" || e.cause?.code === "42P07";
}

/**
 * The default PostgreSQL migrations folder, resolved relative to this compiled
 * module exactly as {@link migratePostgres} resolves it. Used by
 * {@link readImageMigrationSet} and any caller (e.g. the C1.3 preflight) that
 * must inspect the image's bundled migration journal at runtime.
 */
const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../migrations/postgres", import.meta.url),
);

/**
 * One migration as known to the image (the bundled journal + its .sql file).
 *
 * The authority key for DB/image comparison is `(when, hash)` (P7-C1 C1.3):
 * drizzle persists only `id, hash, created_at(=when)` in
 * `drizzle.__drizzle_migrations`; `tag` is source-side display metadata used
 * to print divergent entries. `hash` is `sha256(sqlFileContent)` matching
 * drizzle's own algorithm (`drizzle-orm` `migrator.cjs`).
 */
export interface ImageMigration {
  /** Journal index (0-based, contiguous). Display metadata only. */
  idx: number;
  /** Journal tag, e.g. `0022_engine_policy_seam`. Display metadata only. */
  tag: string;
  /** Journal `when` (epoch millis) — equals the DB `created_at` column. */
  when: number;
  /** sha256 of the .sql file content — equals the DB `hash` column. */
  hash: string;
}

/**
 * The image-side migration set: the entries from `meta/_journal.json` plus the
 * sha256 hash of each `.sql` file, and the maximum `when` (the frontier the
 * image expects a fully-migrated DB to have reached).
 */
export interface ImageMigrationSet {
  entries: ImageMigration[];
  /** max(entries.when), or -Infinity when entries is empty. */
  maxWhen: number;
}

/**
 * Read the image-side migration set from the bundled migrations folder.
 *
 * Resolves the folder the same way {@link migratePostgres} does (relative to
 * this compiled module via `import.meta.url`), so the preflight and the
 * migrator read the SAME journal. The hash is `sha256(sqlFileContent)`
 * matching drizzle's algorithm so DB/image comparison is apples-to-apples.
 *
 * @param migrationsFolder - Optional explicit folder (mainly for tests).
 *   Defaults to the bundled `../migrations/postgres` relative to this module.
 */
export function readImageMigrationSet(
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): ImageMigrationSet {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journalRaw = readFileSync(journalPath, "utf8");
  const journal = JSON.parse(journalRaw) as {
    version?: string;
    dialect?: string;
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  if (!Array.isArray(journal.entries)) {
    throw new Error(
      `readImageMigrationSet: journal.entries is not an array (${journalPath})`,
    );
  }
  const entries: ImageMigration[] = journal.entries.map((e) => {
    const sqlPath = join(migrationsFolder, `${e.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    return {
      idx: e.idx,
      tag: e.tag,
      when: e.when,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });
  const maxWhen = entries.reduce(
    (max, e) => (e.when > max ? e.when : max),
    -Infinity,
  );
  return { entries, maxWhen };
}

/**
 * List the numbered `.sql` files in a migrations folder (for orphan checks).
 * Returns tags like `["0000_cultured_fantastic_four", ...]`.
 */
export function listMigrationSqlTags(
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): string[] {
  return readdirSync(migrationsFolder)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}
