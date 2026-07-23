import type { Database } from "./types.js";
import type { HashFunction, DemoIds } from "./demo-seed.js";
import { seed, SEED_CREDENTIALS } from "./seed.js";
import { seedDemo } from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";

export interface E2eSeedLogger {
  write(message: string): void;
}

const defaultLogger: E2eSeedLogger = {
  write(message: string): void {
    process.stdout.write(message);
  },
};

export interface E2eSeedResult {
  ok: boolean;
  errors: string[];
}

/** Injected workflow functions for testability. Defaults use real modules. */
export interface E2eSeedWorkflow {
  seedFn: (db: Database, hashFn: HashFunction) => Promise<unknown>;
  seedDemoFn: (db: Database, hashFn: HashFunction) => Promise<DemoIds>;
  verifyDemoSeedFn: (db: Database, ids: DemoIds) => Promise<string[]>;
}

const defaultWorkflow: E2eSeedWorkflow = {
  seedFn: seed,
  seedDemoFn: seedDemo,
  verifyDemoSeedFn: verifyDemoSeed,
};

export interface E2eSeedOptions {
  skipMigrate?: boolean;
  migrateFn?: (db: Database) => Promise<void>;
  logger?: E2eSeedLogger;
  workflow?: Partial<E2eSeedWorkflow>;
}

/**
 * Runs the canonical E2E seed workflow: migrate → seed → seedDemo → verify.
 *
 * The caller is responsible for creating the database connection and
 * optionally running migrations before calling this function.
 *
 * @param db - Drizzle database instance.
 * @param hashFn - Password hashing function.
 * @param opts.skipMigrate - When false, run migrations before seeding.
 * @param opts.migrateFn - Optional migration function override.
 * @param opts.logger - Optional logger for progress messages.
 * @param opts.workflow - Optional workflow overrides for testing.
 */
export async function runE2eSeed(
  db: Database,
  hashFn: HashFunction,
  opts?: E2eSeedOptions,
): Promise<E2eSeedResult> {
  const {
    skipMigrate = false,
    migrateFn,
    logger = defaultLogger,
    workflow = {},
  } = opts ?? {};
  const { seedFn, seedDemoFn, verifyDemoSeedFn } = {
    ...defaultWorkflow,
    ...workflow,
  };

  if (!skipMigrate) {
    logger.write("Running migrations...\n");
    const { migratePostgres } = await import("./postgres.js");
    const migrate = migrateFn ?? ((d: Database) => migratePostgres(d));
    await migrate(db);
  } else {
    logger.write("Skipping migrations (--skip-migrate)\n");
  }

  logger.write("Running baseline seed...\n");
  await seedFn(db, hashFn);

  logger.write("Running demo seed...\n");
  const ids = await seedDemoFn(db, hashFn);

  logger.write("Verifying demo seed...\n");
  const errors = await verifyDemoSeedFn(db, ids);

  return { ok: errors.length === 0, errors };
}

/**
 * Builds the credential output string from effective seed configuration.
 * Reads SEED_ADMIN_* and SEED_CANDIDATE_* env vars (same as seed()),
 * falling back to defaults. Demo accounts (candidate1..4) always use
 * the fixed default password since they have no env overrides.
 */
export function buildE2eSeedOutput(): string {
  const adminUser =
    process.env.SEED_ADMIN_USERNAME || SEED_CREDENTIALS.admin.username;
  const adminPass =
    process.env.SEED_ADMIN_PASSWORD || SEED_CREDENTIALS.admin.password;
  const candidateUser =
    process.env.SEED_CANDIDATE_USERNAME || SEED_CREDENTIALS.candidate.username;
  const candidatePass =
    process.env.SEED_CANDIDATE_PASSWORD || SEED_CREDENTIALS.candidate.password;

  return [
    "",
    "Done! E2E seed credentials:",
    `  Admin:      ${adminUser.padEnd(10)} / ${adminPass}`,
    `  Candidate:  ${candidateUser.padEnd(10)} / ${candidatePass}`,
    "  Demo:       candidate1 / candidate123 = in_progress/resume",
    "  Demo:       candidate2 / candidate123 = available/start",
    "  Demo:       candidate3 / candidate123 = resumable/resume",
    "  Demo:       candidate4 / candidate123 = graded/view_result",
    "",
  ].join("\n");
}
