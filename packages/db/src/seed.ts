import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AnyDatabase } from "./types.js";
import { isSqlite } from "./types.js";
import { sqliteSchema } from "./schema/sqlite.js";
import dotenv from "dotenv";

dotenv.config();

export type HashFunction = (password: string) => string | Promise<string>;

function defaultHash(password: string): string {
  return `$scrypt$${Buffer.from(password).toString("base64")}`;
}

export async function seed(
  db: AnyDatabase,
  hashFn: HashFunction = defaultHash,
) {
  if (!isSqlite(db)) {
    throw new Error(
      "seed() only supports SQLite databases. Use migrations for PostgreSQL.",
    );
  }
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
      passwordHash: await hashFn(process.env.SEED_ADMIN_PASSWORD || "admin123"),
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
      passwordHash: await hashFn(
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
      passwordHash: await hashFn(
        process.env.SEED_CANDIDATE_PASSWORD || "candidate123",
      ),
      name: process.env.SEED_CANDIDATE_NAME || "Candidate",
      role: "Candidate" as const,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

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

// CLI entry point moved to apps/api/src/seed.ts
// This file exports the seed function for programmatic use
