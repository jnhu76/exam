import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrlFromEnv } from "./src/databaseUrl.js";

// #741: module-relative repository-root `.env` — cwd-independent (a relative
// path would resolve against the invoker's cwd). Drizzle admits the root
// development source ONLY: `.env.test.local`, `.env.production`, and any
// package-local env file are not drizzle sources.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

// Single-source resolution: respects APP_MODE (test/ci/e2e → TEST_DATABASE_URL,
// else DATABASE_URL). A missing URL fails fast rather than falling back to a
// hardcoded localhost default, so a missing .env cannot silently target the
// wrong database.
const databaseUrl = resolveDatabaseUrlFromEnv(process.env);

if (
  !databaseUrl.startsWith("postgresql://") &&
  !databaseUrl.startsWith("postgres://")
) {
  throw new Error(
    "Drizzle config requires a postgresql:// or postgres:// URL (resolved from DATABASE_URL / TEST_DATABASE_URL).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/pg.ts",
  out: "./migrations/postgres",
  dbCredentials: {
    url: databaseUrl,
  },
});
