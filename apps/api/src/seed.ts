import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { seed } from "@exam/db/src/seed.js";
import { hashPassword } from "@exam/auth/src/password.js";

const conn = createDatabase();
if (conn.kind !== "sqlite") {
  throw new Error("Seed command only supports SQLite databases");
}
migrateSqlite(conn.db);

process.stdout.write("Seeding database...\n");
await seed(conn.db, hashPassword);
process.stdout.write(
  "\nDone! Login credentials:\n" +
    "  Admin:     admin / admin123\n" +
    "  Teacher:   teacher / teacher123\n" +
    "  Candidate: candidate / candidate123\n",
);
