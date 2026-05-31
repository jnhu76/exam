import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { seed } from "@exam/db/src/seed.js";
import { hashPassword } from "@exam/auth/src/password.js";

const { db } = createDatabase();
migrateSqlite(db);

console.log("Seeding database...");
await seed(db, hashPassword);
console.log("\nDone! Login credentials:");
console.log("  Admin:     admin / admin123");
console.log("  Teacher:   teacher / teacher123");
console.log("  Candidate: candidate / candidate123");
