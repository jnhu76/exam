import { randomUUID } from "node:crypto";
import type { Database } from "./types.js";
import { schema } from "./schema/pg.js";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

dotenv.config();

export type HashFunction = (password: string) => string | Promise<string>;

export interface SeedUserIds {
  adminId: string;
  candidateId: string;
  candidate2Id: string;
}

export interface SeedResult {
  orgId: string;
  users: SeedUserIds;
}

export const SEED_CREDENTIALS = {
  admin: { username: "admin", password: "admin123", role: "Admin" as const },
  candidate: {
    username: "candidate",
    password: "candidate123",
    role: "Candidate" as const,
  },
  candidate2: {
    username: "candidate2",
    password: "candidate123",
    role: "Candidate" as const,
  },
};

export const SEED_ORG_SLUG = "default";
export const SEED_ORG_NAME = "Default Organization";

const USER_DEFS = [
  {
    envUsername: "SEED_ADMIN_USERNAME",
    envPassword: "SEED_ADMIN_PASSWORD",
    envName: "SEED_ADMIN_NAME",
    defaults: SEED_CREDENTIALS.admin,
    nameDefault: "Admin",
  },
  {
    envUsername: "SEED_CANDIDATE_USERNAME",
    envPassword: "SEED_CANDIDATE_PASSWORD",
    envName: "SEED_CANDIDATE_NAME",
    defaults: SEED_CREDENTIALS.candidate,
    nameDefault: "Candidate",
  },
  {
    envUsername: "SEED_CANDIDATE2_USERNAME",
    envPassword: "SEED_CANDIDATE2_PASSWORD",
    envName: "SEED_CANDIDATE2_NAME",
    defaults: SEED_CREDENTIALS.candidate2,
    nameDefault: "Candidate 2",
  },
] as const;

export async function seed(
  db: Database,
  hashFn: HashFunction,
): Promise<SeedResult> {
  const timestamp = new Date();

  const orgRows = await db
    .insert(schema.organizations)
    .values({
      id: randomUUID(),
      name: process.env.SEED_ORG_NAME || SEED_ORG_NAME,
      displayName:
        process.env.SEED_ORG_DISPLAY_NAME ||
        process.env.SEED_ORG_NAME ||
        SEED_ORG_NAME,
      slug: SEED_ORG_SLUG,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.organizations.slug,
      set: { updatedAt: timestamp },
    })
    .returning({ id: schema.organizations.id });
  const orgId = orgRows[0]!.id;

  const userIds: string[] = [];

  for (const def of USER_DEFS) {
    const username = process.env[def.envUsername] || def.defaults.username;
    const password = process.env[def.envPassword] || def.defaults.password;
    const name = process.env[def.envName] || def.nameDefault;
    const passwordHash = await hashFn(password);

    const userRows = await db
      .insert(schema.users)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        username,
        passwordHash,
        name,
        role: def.defaults.role,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [schema.users.organizationId, schema.users.username],
        set: { passwordHash, isActive: true, updatedAt: timestamp },
      })
      .returning({ id: schema.users.id });

    userIds.push(userRows[0]!.id);
  }

  return {
    orgId,
    users: {
      adminId: userIds[0]!,
      candidateId: userIds[1]!,
      candidate2Id: userIds[2]!,
    },
  };
}

const isMain = process.argv[1]?.endsWith("seed.ts");
if (isMain) {
  const { createDatabase } = await import("./database.js");
  const { hashPassword } = await import("@exam/auth/src/password.js");

  const conn = await createDatabase();
  process.stdout.write("Seeding database...\n");
  const result = await seed(conn.db, hashPassword);
  process.stdout.write(
    `Done! Created org=${result.orgId}, admin=${result.users.adminId}\n`,
  );
  await conn.sql.end();
}
