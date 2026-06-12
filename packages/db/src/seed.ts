import { randomUUID } from "node:crypto";
import type { Database } from "./types.js";
import { schema } from "./schema/pg.js";
import dotenv from "dotenv";

dotenv.config();

export type HashFunction = (password: string) => string | Promise<string>;

export interface SeedUserIds {
  superAdminId: string;
  adminId: string;
  teacherId: string;
  candidateId: string;
}

export interface SeedResult {
  orgId: string;
  users: SeedUserIds;
}

export const SEED_CREDENTIALS = {
  superadmin: {
    username: "superadmin",
    password: "admin123",
    role: "SuperAdmin" as const,
  },
  admin: { username: "admin", password: "admin123", role: "Admin" as const },
  teacher: {
    username: "teacher",
    password: "teacher123",
    role: "Teacher" as const,
  },
  candidate: {
    username: "candidate",
    password: "candidate123",
    role: "Candidate" as const,
  },
};

export const SEED_ORG_SLUG = "default";
export const SEED_ORG_NAME = "Default Organization";

const USER_DEFS = [
  {
    envUsername: "SEED_SUPERADMIN_USERNAME",
    envPassword: "SEED_SUPERADMIN_PASSWORD",
    envName: "SEED_SUPERADMIN_NAME",
    defaults: SEED_CREDENTIALS.superadmin,
    nameDefault: "Super Admin",
  },
  {
    envUsername: "SEED_ADMIN_USERNAME",
    envPassword: "SEED_ADMIN_PASSWORD",
    envName: "SEED_ADMIN_NAME",
    defaults: SEED_CREDENTIALS.admin,
    nameDefault: "Admin",
  },
  {
    envUsername: "SEED_TEACHER_USERNAME",
    envPassword: "SEED_TEACHER_PASSWORD",
    envName: "SEED_TEACHER_NAME",
    defaults: SEED_CREDENTIALS.teacher,
    nameDefault: "Teacher",
  },
  {
    envUsername: "SEED_CANDIDATE_USERNAME",
    envPassword: "SEED_CANDIDATE_PASSWORD",
    envName: "SEED_CANDIDATE_NAME",
    defaults: SEED_CREDENTIALS.candidate,
    nameDefault: "Candidate",
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
      superAdminId: userIds[0]!,
      adminId: userIds[1]!,
      teacherId: userIds[2]!,
      candidateId: userIds[3]!,
    },
  };
}
