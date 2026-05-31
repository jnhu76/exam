import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { SqliteDatabase } from "./sqlite.js";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { sqliteSchema } from "./schema/sqlite.js";
import dotenv from "dotenv";

dotenv.config();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seed(db: SqliteDatabase) {
  const timestamp = new Date();

  const slug = "default";
  const existingOrg = db
    .select()
    .from(sqliteSchema.organizations)
    .where(eq(sqliteSchema.organizations.slug, slug))
    .get();

  const orgId = existingOrg?.id ?? randomUUID();

  const org = {
    id: orgId,
    name: process.env.SEED_ORG_NAME || "Default Organization",
    displayName:
      process.env.SEED_ORG_DISPLAY_NAME ||
      process.env.SEED_ORG_NAME ||
      "Default Organization",
    slug,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (!existingOrg) {
    db.insert(sqliteSchema.organizations).values(org).run();
  }

  const users = [
    {
      id: randomUUID(),
      organizationId: org.id,
      username: process.env.SEED_ADMIN_USERNAME || "admin",
      passwordHash: hashPassword(
        process.env.SEED_ADMIN_PASSWORD || "admin123",
      ),
      name: process.env.SEED_ADMIN_NAME || "Admin",
      role: "SuperAdmin" as const,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: randomUUID(),
      organizationId: org.id,
      username: process.env.SEED_TEACHER_USERNAME || "teacher",
      passwordHash: hashPassword(
        process.env.SEED_TEACHER_PASSWORD || "teacher123",
      ),
      name: process.env.SEED_TEACHER_NAME || "Teacher",
      role: "Teacher" as const,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: randomUUID(),
      organizationId: org.id,
      username: process.env.SEED_CANDIDATE_USERNAME || "candidate",
      passwordHash: hashPassword(
        process.env.SEED_CANDIDATE_PASSWORD || "candidate123",
      ),
      name: process.env.SEED_CANDIDATE_NAME || "Candidate",
      role: "Candidate" as const,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  db.insert(sqliteSchema.organizations)
    .values(org)
    .onConflictDoNothing()
    .run();

  for (const user of users) {
    const existing = db
      .select()
      .from(sqliteSchema.users)
      .where(
        and(
          eq(sqliteSchema.users.organizationId, org.id),
          eq(sqliteSchema.users.username, user.username),
        ),
      )
      .get();
    if (!existing) {
      db.insert(sqliteSchema.users).values(user).run();
    }
  }
}

async function main() {
  const { db } = createDatabase();
  migrateSqlite(db);

  console.log("Seeding database...");
  await seed(db);
  console.log("\nDone! Login credentials:");
  console.log("  Admin:     admin / admin123");
  console.log("  Teacher:   teacher / teacher123");
  console.log("  Candidate: candidate / candidate123");
}

if (
  process.argv[1]?.includes("seed") &&
  !process.argv[1]?.includes("test")
) {
  main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
