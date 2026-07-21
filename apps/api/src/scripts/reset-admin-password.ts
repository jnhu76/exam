/**
 * Local script: reset an Admin's password.
 *
 * Phase 1 does NOT implement email password reset. When an Admin forgets
 * their password, it must be reset locally via this script.
 *
 * This script can ONLY reset Admin passwords. Candidate passwords are reset
 * by an Admin through the API (POST /users/:id/reset-password).
 *
 * Usage:
 *   pnpm --filter @exam/api reset:admin-password \
 *     --username admin --password 'NewStrongPassword123!'
 */

import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { recordAtomicSystemAudit } from "../audit/auditWriter.js";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";
import { eq } from "drizzle-orm";

export interface ResetAdminPasswordParams {
  username: string;
  newPassword: string;
}

export interface ResetAdminPasswordResult {
  userId: string;
  username: string;
}

/**
 * Reset an Admin's password in the given organization.
 * Throws if the user is not found or is not an Admin.
 * Writes an admin.password_reset.local audit log with actor "system".
 */
export async function resetAdminPassword(
  db: Database,
  organizationId: string,
  params: ResetAdminPasswordParams,
): Promise<ResetAdminPasswordResult> {
  const userRepo = createUserRepo(db);
  const systemCtx = {
    organizationId,
    actorId: "system",
    role: "Admin" as const,
    permissions: [],
  };

  const user = await userRepo.findByOrganizationAndUsername(
    systemCtx,
    params.username,
  );
  if (!user) {
    throw new Error(`User "${params.username}" not found.`);
  }
  const assignmentRepo = createUserRoleAssignmentRepo(db);
  const activeAssignments = await assignmentRepo.listActiveForUser(
    systemCtx,
    user.id,
  );
  const isEffectiveAdmin = activeAssignments.some((a) => a.role === "Admin");
  if (!isEffectiveAdmin) {
    throw new Error(
      `User "${params.username}" is not an effective Admin. ` +
        `This script can only reset Admin passwords.`,
    );
  }

  const newHash = await hashPassword(params.newPassword);
  await executeInTransaction(db, async (tx) => {
    await createUserRepo(tx).update(systemCtx, user.id, {
      passwordHash: newHash,
    });
    await recordAtomicSystemAudit(
      tx,
      { tenant: systemCtx },
      {
        action: "admin.password_reset.local",
        targetType: "user",
        targetId: user.id,
        metadata: {
          username: user.username,
          source: "local_script",
        },
      },
    );
  });

  return { userId: user.id, username: user.username };
}

// ── CLI entry point ──────────────────────────────────────────────

function parseArgs(argv: string[]): ResetAdminPasswordParams {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }

  if (!args.username) throw new Error("--username is required");
  if (!args.password) throw new Error("--password is required");

  return { username: args.username, newPassword: args.password };
}

async function resolveDefaultOrgId(db: Database): Promise<string> {
  const rows = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, "default"));
  if (rows.length === 0) {
    throw new Error(
      "Default organization not found. Run migrations and seed first.",
    );
  }
  return rows[0]!.id;
}

async function main() {
  loadRootEnv();

  let databaseUrl: string;
  try {
    databaseUrl = resolveDatabaseUrlFromEnv(process.env);
  } catch (err) {
    process.stderr.write(`FATAL: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const conn = await createDatabase(databaseUrl);
  try {
    const params = parseArgs(process.argv.slice(2));
    const orgId = await resolveDefaultOrgId(conn.db);
    await resetAdminPassword(conn.db, orgId, params);
    process.stdout.write(
      `Admin password reset successfully.\n` +
        `  username: ${params.username}\n`,
    );
  } catch (err) {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await conn.sql.end();
  }
}

const isDirectInvocation =
  process.argv[1]?.endsWith("reset-admin-password.ts") ||
  process.argv[1]?.endsWith("reset-admin-password.js");
if (isDirectInvocation) {
  void main();
}
