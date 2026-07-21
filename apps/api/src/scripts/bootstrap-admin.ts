/**
 * Local script: create the first Admin for the internal default organization.
 *
 * Phase 1 does NOT expose public self-register. The first Admin must be
 * created locally via this script. Subsequent Admins can be created through
 * the Admin UI (POST /users with role=Admin).
 *
 * Usage:
 *   pnpm --filter @exam/api bootstrap:admin \
 *     --username admin --password 'ChangeMe123!' --name 'System Admin'
 *
 * Safety: refuses if an active Admin already exists unless --force is passed.
 */

import { executeInTransaction } from "@exam/db/src/types.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { recordAtomicSystemAudit } from "../audit/auditWriter.js";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";
import { eq } from "drizzle-orm";

export interface BootstrapAdminParams {
  username: string;
  password: string;
  name: string;
  force?: boolean;
}

export interface BootstrapAdminResult {
  user: {
    id: string;
    username: string;
    name: string;
    role: string;
    isActive: boolean;
  };
}

/**
 * Create the first Admin for the given organization.
 * Throws if an active Admin already exists (unless force=true).
 * Writes an admin.bootstrap audit log with actor "system".
 */
export async function bootstrapAdmin(
  db: Database,
  organizationId: string,
  params: BootstrapAdminParams,
): Promise<BootstrapAdminResult> {
  const systemCtx = {
    organizationId,
    actorId: "system",
    role: "Admin" as const,
    permissions: [],
  };

  const passwordHash = await hashPassword(params.password);

  const { user } = await executeInTransaction(db, async (tx) => {
    const txUserRepo = createUserRepo(tx);
    // RBAC-M10-E: "already has an active admin" is an assignment-backed
    // question (a user whose users.role is Candidate but holds a secondary
    // active Admin assignment IS an admin authority-wise). P0-7.
    const activeAdminCount = await txUserRepo.countEffectiveActiveUsersWithRole(
      systemCtx,
      "Admin",
    );
    if (activeAdminCount > 0 && !params.force) {
      throw new Error(
        `An active Admin already exists in this organization. ` +
          `Use --force to create an additional Admin.`,
      );
    }
    const user = await txUserRepo.createUnique(systemCtx, {
      username: params.username,
      passwordHash,
      name: params.name,
      role: "Admin",
      isActive: true,
    });
    // RBAC-M10-E: create the primary Admin assignment in the SAME transaction
    // so the bootstrap user is authority-complete before the txn commits.
    await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
      tx,
      systemCtx,
      {
        userId: user.id,
        role: "Admin",
        isPrimary: true,
        isActive: true,
      },
    );
    await recordAtomicSystemAudit(
      tx,
      { tenant: systemCtx },
      {
        action: "admin.bootstrap",
        targetType: "user",
        targetId: user.id,
        metadata: {
          username: user.username,
          name: user.name,
          source: "local_script",
        },
      },
    );
    return { user };
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    },
  };
}

// ── CLI entry point ──────────────────────────────────────────────

function parseArgs(argv: string[]): BootstrapAdminParams {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") {
      args.force = "true";
      continue;
    }
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
  if (!args.name) throw new Error("--name is required");

  return {
    username: args.username,
    password: args.password,
    name: args.name,
    force: args.force === "true",
  };
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
    const result = await bootstrapAdmin(conn.db, orgId, params);
    process.stdout.write(
      `Admin created successfully.\n` +
        `  id:       ${result.user.id}\n` +
        `  username: ${result.user.username}\n` +
        `  name:     ${result.user.name}\n` +
        `  role:     ${result.user.role}\n`,
    );
  } catch (err) {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await conn.sql.end();
  }
}

// Run CLI only when invoked directly, not when imported by tests
const isDirectInvocation =
  process.argv[1]?.endsWith("bootstrap-admin.ts") ||
  process.argv[1]?.endsWith("bootstrap-admin.js");
if (isDirectInvocation) {
  void main();
}
