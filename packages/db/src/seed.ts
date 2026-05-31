import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes } from "node:crypto";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { sqliteSchema } from "./schema/sqlite.js";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const now = new Date();

const org = {
  id: randomUUID(),
  name: process.env.SEED_ORG_NAME || "Default Organization",
  displayName:
    process.env.SEED_ORG_DISPLAY_NAME ||
    process.env.SEED_ORG_NAME ||
    "Default Organization",
  slug: "default",
  createdAt: now,
  updatedAt: now,
};

const users = [
  {
    id: randomUUID(),
    organizationId: org.id,
    username: process.env.SEED_ADMIN_USERNAME || "admin",
    passwordHash: hashPassword(process.env.SEED_ADMIN_PASSWORD || "admin123"),
    name: process.env.SEED_ADMIN_NAME || "Admin",
    role: "SuperAdmin" as const,
    isActive: true,
    createdAt: now,
    updatedAt: now,
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
    createdAt: now,
    updatedAt: now,
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
    createdAt: now,
    updatedAt: now,
  },
];

async function seed() {
  const { db } = createDatabase();
  migrateSqlite(db);

  console.log("Seeding database...");

  db.insert(sqliteSchema.organizations).values(org).run();
  console.log(`  Organization: ${org.name} (${org.slug})`);

  for (const user of users) {
    db.insert(sqliteSchema.users).values(user).run();
    console.log(
      `  User: ${user.username} / ${user.username}123 (${user.role})`,
    );
  }

  console.log("\nDone! Login credentials:");
  console.log("  Admin:     admin / admin123");
  console.log("  Teacher:   teacher / teacher123");
  console.log("  Candidate: candidate / candidate123");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
