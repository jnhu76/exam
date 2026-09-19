/**
 * #550 harness shared configuration (RESEARCH ONLY).
 *
 * Every value here is the FROZEN canonical configuration from
 * 02-methodology.md unless a runner documents a NON_CANONICAL override.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** docs/research/exam-550-final-capacity-reproof-1 */
export const RESEARCH_DIR = dirname(dirname(__dirname));
export const RESULTS_DIR = join(RESEARCH_DIR, "results");
export const LOGS_DIR = join(RESEARCH_DIR, "logs");
/** repo root */
export const REPO_ROOT = join(RESEARCH_DIR, "..", "..", "..");

export const BASE_SHA = "fbf5bd41bfa6e12ef9fbe4a271c458cbf37d416e";

/**
 * Evidence campaign marker (EXAM-550-CORRECTIVE-1). Corrective runs stamp
 * this into meta.json so aggregate.ts and the docs select ONLY post-corrective
 * production-mode runs as authoritative; pre-corrective artifacts stay in
 * place marked SUPERSEDED_PRE_CORRECTIVE_EVIDENCE.
 */
export const CAMPAIGN = "corrective-1";

/** Repo HEAD at run time — provenance stamp for every meta.json. */
export function headSha(): string {
  return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
}

/**
 * Dedicated run database. NAME-GUARDED: the harness refuses to touch anything
 * that does not match this prefix (AGENTS.md §6 — never a dev database).
 * The "_e2e" suffix also satisfies the repo's own test-branch name guard
 * (databaseUrl.ts requires test|e2e|ci in the name for APP_MODE=e2e).
 */
export const RUN_DB_PREFIX = "exam_550";
export const RUN_DB = process.env.CAPACITY_DB?.startsWith(RUN_DB_PREFIX)
  ? process.env.CAPACITY_DB
  : "exam_550_e2e";
export const MAINT_URL =
  process.env.CAPACITY_MAINT_URL ??
  "postgres://exam:exam@127.0.0.1:5432/postgres";
export const RUN_DB_URL = `postgres://exam:exam@127.0.0.1:5432/${RUN_DB}`;

/** API process defaults for a run. */
export const API_PORT = Number(process.env.CAPACITY_API_PORT ?? 3300);
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
/** The API's configured allowed origin (CORS_ORIGIN) — every driver request
 * carries it like a real browser would (production-mode CSRF check). */
export const API_ORIGIN = `http://localhost:${API_PORT}`;

/** Seeded admin credentials — the repo's own canonical seed (packages/db seed.ts). */
export const ADMIN = { username: "admin", password: "admin123" };
/** Candidate password: ONE argon2id hash reused across fixture rows. */
export const CANDIDATE_PASSWORD = "pass-550-cap";

/** Postgres.js pool shape under test — never overridden anywhere in #550. */
export const DB_POOL_MAX = 10;

/** Default steady-state duration (seconds) for lifecycle runs. */
export const DEFAULT_STEADY_SECONDS = 90;

/** Batch release contract from the #549 admission workload. */
export const ADMISSION_BATCH_SIZE = 20;
export const ADMISSION_BATCH_INTERVAL_S = 15;

export function jwtSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Simple `--key=value` argv parse. */
export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
