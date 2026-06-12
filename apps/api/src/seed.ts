import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { seed } from "@exam/db/src/seed.js";
import { hashPassword } from "@exam/auth/src/password.js";

const conn = await createDatabase();

process.stdout.write("Running migrations...\n");
await migratePostgres(conn.db);

process.stdout.write("Seeding database...\n");
await seed(conn.db, hashPassword);
process.stdout.write(
  "\nDone! Login credentials:\n" +
    "  SuperAdmin: superadmin / admin123\n" +
    "  Admin:      admin / admin123\n" +
    "  Teacher:    teacher / teacher123\n" +
    "  Candidate:  candidate / candidate123\n",
);

await conn.sql.end();
