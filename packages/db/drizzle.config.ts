import { isAbsolute, resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL ?? "sqlite:./dev.db";

if (!databaseUrl.startsWith("sqlite:")) {
  throw new Error(
    "SQLite Drizzle config requires DATABASE_URL to start with sqlite:",
  );
}

const filename = databaseUrl.slice("sqlite:".length);

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/sqlite.ts",
  out: "./migrations/sqlite",
  dbCredentials: {
    url:
      filename === ":memory:" || isAbsolute(filename)
        ? filename
        : resolve("../..", filename),
  },
});
