import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeInTransaction,
  type Database,
  type TenantContext,
} from "./types.js";
import { schema, ASSIGNABLE_ROLES } from "./schema/pg.js";
import type { AssignableRole } from "./schema/pg.js";
import { createUserRoleAssignmentRepo } from "./repository/userRoleAssignmentRepo.js";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

/** Function signature for a password hashing function used during seeding. */
export type HashFunction = (password: string) => string | Promise<string>;

/** IDs of the seed users created by {@link seed}. */
export interface SeedUserIds {
  adminId: string;
  candidateId: string;
  candidate2Id: string;
}

/** Return value of {@link seed}, containing the organization ID and user IDs. */
export interface SeedResult {
  orgId: string;
  users: SeedUserIds;
}

/** Default credentials for seed users (admin, candidate, candidate2). */
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

/** Default slug for the seed organization. */
export const SEED_ORG_SLUG = "default";
/** Default display name for the seed organization. */
export const SEED_ORG_NAME = "Default Organization";

/** Internal user definitions with env-var overrides and defaults. */
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

/**
 * Seeds the baseline database with a default organization and three users
 * (admin, candidate, candidate2). Idempotent — re-running upserts on
 * conflict by username.
 * @param db - Database instance.
 * @param hashFn - Password hashing function.
 * @returns Created organization ID and user IDs.
 */
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

  const seedCtx: TenantContext = {
    organizationId: orgId,
    actorId: "seed",
    role: "Admin",
    permissions: [],
  };

  const assignableRoleSet = new Set<string>(ASSIGNABLE_ROLES);

  for (const def of USER_DEFS) {
    const username = process.env[def.envUsername] || def.defaults.username;
    const password = process.env[def.envPassword] || def.defaults.password;
    const name = process.env[def.envName] || def.nameDefault;
    const passwordHash = await hashFn(password);

    let seededUserId: string | undefined;
    await executeInTransaction(
      db,
      async (tx) => {
        const userRows = await tx
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
            set: { passwordHash, name, updatedAt: timestamp },
          })
          .returning({ id: schema.users.id, role: schema.users.role });

        const user = userRows[0]!;
        seededUserId = user.id;

        const assignmentRepo = createUserRoleAssignmentRepo(tx);
        const assignments = await assignmentRepo.listForUser(seedCtx, user.id);
        const hasActive = assignments.some((a) => a.isActive);
        if (hasActive) return;
        const hasAny = assignments.length > 0;
        if (hasAny) return;

        if (assignableRoleSet.has(user.role)) {
          await assignmentRepo.ensurePrimaryAssignmentWithinTransaction(
            tx,
            seedCtx,
            {
              userId: user.id,
              role: user.role as AssignableRole,
            },
          );
        }
      },
      "read committed",
    );
    userIds.push(seededUserId!);
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

/** Detects whether this file is the entry point (directly invoked). */
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  let conn:
    | Awaited<ReturnType<typeof import("./database.js").createDatabase>>
    | undefined;
  try {
    const { createDatabase } = await import("./database.js");
    const { hashPassword } = await import("@exam/auth/src/password.js");

    conn = await createDatabase();
    process.stdout.write("Seeding database...\n");
    const result = await seed(conn.db, hashPassword);
    process.stdout.write(
      `Done! Created org=${result.orgId}, admin=${result.users.adminId}\n`,
    );
  } catch (err) {
    process.stderr.write(`Seed failed: ${String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await conn?.sql.end();
  }
}
