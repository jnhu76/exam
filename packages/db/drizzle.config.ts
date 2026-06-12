import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://exam:exam@localhost:5432/exam";

if (
  !databaseUrl.startsWith("postgresql://") &&
  !databaseUrl.startsWith("postgres://")
) {
  throw new Error(
    "Drizzle config requires DATABASE_URL to start with postgresql:// or postgres://",
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
