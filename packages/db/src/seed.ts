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
import { parseAppMode } from "./databaseUrl.js";
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
 * P6-008: refuse to run the baseline seed in production. The baseline seed
 * ships known default credentials (admin/admin123, candidate/candidate123)
 * and is dev/test infrastructure only. The canonical production bootstrap
 * is `apps/api/src/scripts/bootstrap-admin.ts` (explicit credentials, no
 * Candidate accounts, audit evidence).
 *
 * This guard is fail-closed: it throws when `APP_MODE=production` (or
 * `NODE_ENV=production` when APP_MODE is unset). It does NOT throw in
 * development, test, e2e, or ci modes, so dev/E2E seed behavior is
 * unchanged.
 *
 * @param env - Process environment to read from (defaults to process.env).
 * @throws Error when the resolved runtime mode is production.
 */
export function assertNotProductionSeed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const mode = parseAppMode(env);
  if (mode === "production") {
    throw new Error(
      "Refusing to run the baseline seed in production (APP_MODE=production). " +
        "The baseline seed ships known default credentials and is dev/test " +
        "infrastructure only. Use the production bootstrap instead: " +
        "'node dist/scripts/bootstrap-admin.js --username <admin> " +
        "--password <STRONG_PASSWORD> --name <name> " +
        "--organization-name <org>'.",
    );
  }
}

/**
 * Seeds the baseline database with a default organization and three users
 * (admin, candidate, candidate2). Idempotent — re-running upserts on
 * conflict by username.
 *
 * Phase 1 minimal authentication/dev seed: creates `organizations` + `users` +
 * `user_role_assignments` only. Does NOT create `candidate_profiles`,
 * `candidate_fields`, `organization_settings`, courses, exams, or attempts.
 * Use `demo-seed.ts` for a complete interactive demo. A `Candidate`-role user
 * created by this seed can authenticate but has no CandidateProfile —
 * `POST /users/:id/reset-password` will reject it (target identity check
 * requires a profile).
 *
 * Production safety (P6-008): this function refuses to run when
 * `APP_MODE=production`. Use {@link assertNotProductionSeed} directly when
 * you need to guard without invoking the seed.
 *
 * @param db - Database instance.
 * @param hashFn - Password hashing function.
 * @returns Created organization ID and user IDs.
 */
export async function seed(
  db: Database,
  hashFn: HashFunction,
): Promise<SeedResult> {
  // P6-008: production fail-closed guard. The baseline seed is dev/test
  // infrastructure and ships known default credentials (admin/admin123,
  // candidate/candidate123). It MUST NOT be used as the production
  // bootstrap path. The canonical production bootstrap is
  // apps/api/src/scripts/bootstrap-admin.ts. This guard refuses to seed
  // when APP_MODE=production so a misconfigured entrypoint (RUN_SEED=1
  // in production) cannot silently introduce default credentials.
  assertNotProductionSeed();

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
      // Conflict branch only updates `updatedAt` — deliberately does NOT
      // overwrite `name`/`displayName`, to preserve admin-configured
      // organization identity on re-seed.
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
            // Conflict branch only resets `passwordHash`/`name` — deliberately
            // does NOT overwrite `role`/`isActive`, to preserve (a) authority
            // changes made via the role-assignment surface since the last seed,
            // and (b) account-disable state (RBAC-M10-E authority preservation,
            // commit 9f0261a).
            target: [schema.users.organizationId, schema.users.username],
            // #325 classification decision: this re-seed DOES rewrite the
            // stored credential, but it deliberately does NOT advance
            // users.auth_epoch. Seed is dev/demo tooling outside the product
            // login surface — every buildTestApp/seed run would otherwise
            // invalidate all outstanding fixtures for shared seeded rows.
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

  // P7-E2A (ADR-017 D14): seed must never leave committed state with an
  // actor holding both active Admin and active Maintainer assignments
  // (e.g. a Maintainer secondary assignment added via the assignment surface
  // before a re-seed). Fail loudly instead of silently producing the
  // forbidden combination.
  const violations =
    await createUserRoleAssignmentRepo(
      db,
    ).findAdminMaintainerExclusionViolations(seedCtx);
  if (violations.length > 0) {
    throw new Error(
      `Seed aborted: user ${violations[0]!.userId} holds both active Admin and active Maintainer assignments (ADMIN_MAINTAINER_EXCLUSION).`,
    );
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
