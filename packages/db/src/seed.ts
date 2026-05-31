import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes } from "node:crypto";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { sqliteSchema } from "./schema/sqlite.js";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const now = new Date();

const org = {
  id: randomUUID(),
  name: "默认机构",
  displayName: "默认机构",
  slug: "default",
  createdAt: now,
  updatedAt: now,
};

const users = [
  {
    id: randomUUID(),
    organizationId: org.id,
    username: "admin",
    passwordHash: hashPassword("admin123"),
    name: "管理员",
    role: "SuperAdmin" as const,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: randomUUID(),
    organizationId: org.id,
    username: "teacher",
    passwordHash: hashPassword("teacher123"),
    name: "教师",
    role: "Teacher" as const,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: randomUUID(),
    organizationId: org.id,
    username: "candidate",
    passwordHash: hashPassword("candidate123"),
    name: "考生",
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
    console.log(`  User: ${user.username} / ${user.username}123 (${user.role})`);
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
