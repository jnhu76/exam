/**
 * Production-safe first-Admin bootstrap (P6-008).
 *
 * Phase 1 does NOT expose public self-register. The first Admin must be
 * created via this script. Subsequent Admins can be created through the
 * Admin UI (POST /users with role=Admin) or by re-running this script
 * with --force.
 *
 * Production bootstrap contract:
 *
 *   1. locate the internal organization with slug "default";
 *   2. if it does not exist, create it atomically using an explicitly
 *      supplied organization name/display name or a documented non-secret
 *      default;
 *   3. create the first Admin using required explicit CLI arguments
 *      (--username, --password, --name);
 *   4. create the primary Admin role assignment in the same transaction;
 *   5. write admin.bootstrap audit evidence;
 *   6. refuse a second active Admin unless --force is supplied.
 *
 * The password is ALWAYS explicitly supplied (`--password`). There is no
 * default Admin password. The baseline dev/test seed (`packages/db/seed.ts`)
 * is dev/test infrastructure and MUST NOT be used as the production
 * bootstrap path (see the production-seed refusal guard in `seed.ts`).
 *
 * Usage:
 *   pnpm --filter @exam/api bootstrap:admin \
 *     --username admin --password 'ChangeMe123!' --name 'System Admin' \
 *     --organization-name 'My Organization'
 *
 * Built artifact (used by the runbook):
 *   node dist/scripts/bootstrap-admin.js \
 *     --username admin --password '<STRONG_PASSWORD>' --name 'System Admin' \
 *     --organization-name 'My Organization'
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

/** Default slug for the internal organization (single-tenant Phase 1). */
export const DEFAULT_ORG_SLUG = "default";
/**
 * Documented non-secret default organization name. Used only when the
 * operator does not supply --organization-name AND no default organization
 * exists yet. This is an organization display name, not a secret.
 */
export const DEFAULT_ORG_NAME = "Default Organization";

export interface BootstrapAdminParams {
  username: string;
  password: string;
  name: string;
  force?: boolean;
}

export interface BootstrapAdminOrganizationOptions {
  /**
   * Explicit organization name. When omitted and the default organization
   * does not yet exist, {@link DEFAULT_ORG_NAME} is used. When the default
   * organization already exists, this value is ignored (the existing
   * organization identity is preserved).
   */
  organizationName?: string;
  /** Optional display name override; falls back to the organization name. */
  organizationDisplayName?: string;
}

export interface BootstrapAdminResult {
  organization: {
    id: string;
    name: string;
    displayName: string;
    slug: string;
    created: boolean;
  };
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
 *
 * NOTE: this function does NOT create the organization. Use
 * {@link bootstrapAdminOnFreshDb} for the full production bootstrap path
 * (organization + admin in one call).
 */
export async function bootstrapAdmin(
  db: Database,
  organizationId: string,
  params: BootstrapAdminParams,
): Promise<{
  user: BootstrapAdminResult["user"];
}> {
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

/**
 * Resolve or create the internal default organization (slug "default")
 * atomically. When the organization already exists, the existing identity
 * is preserved (no overwrite of name/displayName). When it does not exist,
 * it is created with the supplied or default name.
 *
 * This overload runs OUTSIDE a transaction. It is retained for callers that
 * only need the organization (e.g. the {@link resolveOrCreateDefaultOrganization}
 * tests). The production bootstrap path ({@link bootstrapAdminOnFreshDb})
 * uses the transaction-internal variant so the org, Admin, assignment, and
 * audit all commit atomically.
 *
 * Returns the organization row plus a `created` flag.
 */
export async function resolveOrCreateDefaultOrganization(
  db: Database,
  options: BootstrapAdminOrganizationOptions = {},
): Promise<BootstrapAdminResult["organization"]> {
  return resolveOrCreateDefaultOrganizationInTx(db, options);
}

/**
 * Transaction-internal org resolver. Accepts either a top-level
 * {@link Database} or a {@link TransactionDatabase} so it can run inside the
 * same transaction as the Admin/assignment/audit writes. Uses
 * `onConflictDoUpdate` on slug to make the insert idempotent under
 * concurrency (a race where another bootstrap created the org between the
 * SELECT and INSERT resolves to the existing row, preserving its identity).
 */
async function resolveOrCreateDefaultOrganizationInTx(
  db: Database | import("@exam/db/src/types.js").TransactionDatabase,
  options: BootstrapAdminOrganizationOptions,
): Promise<BootstrapAdminResult["organization"]> {
  const name =
    options.organizationName?.trim() ||
    options.organizationDisplayName?.trim() ||
    DEFAULT_ORG_NAME;
  const displayName = options.organizationDisplayName?.trim() || name;

  // Check existence first (cheap path; also works inside a txn).
  const existing = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, DEFAULT_ORG_SLUG));
  if (existing.length > 0) {
    const org = existing[0]!;
    return {
      id: org.id,
      name: org.name,
      displayName: org.displayName,
      slug: org.slug,
      created: false,
    };
  }

  // Create atomically; onConflictDoUpdate handles the race where another
  // bootstrap invocation created the org between our check and insert.
  const timestamp = new Date();
  const rows = await db
    .insert(schema.organizations)
    .values({
      id: crypto.randomUUID(),
      name,
      displayName,
      slug: DEFAULT_ORG_SLUG,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      // Preserve admin-configured organization identity on conflict.
      target: schema.organizations.slug,
      set: { updatedAt: timestamp },
    })
    .returning();
  const org = rows[0]!;
  return {
    id: org.id,
    name: org.name,
    displayName: org.displayName,
    slug: org.slug,
    created: true,
  };
}

/**
 * Full production bootstrap: resolve/create the internal default
 * organization, create the first Admin, the primary Admin assignment, and
 * the `admin.bootstrap` audit — all in ONE transaction so they commit
 * atomically. If any step fails, none of them land (no orphan org, no
 * orphan user, no orphan assignment, no orphan audit).
 *
 * This is the canonical production bootstrap path (P6-008). The baseline
 * dev/test seed (`packages/db/src/seed.ts`) is NOT the production path.
 */
export async function bootstrapAdminOnFreshDb(
  db: Database,
  params: BootstrapAdminParams,
  options: BootstrapAdminOrganizationOptions = {},
): Promise<BootstrapAdminResult> {
  const passwordHash = await hashPassword(params.password);

  const result = await executeInTransaction(db, async (tx) => {
    // 1. Resolve/create the default org INSIDE this transaction so the
    //    org, Admin, assignment, and audit commit atomically.
    const organization = await resolveOrCreateDefaultOrganizationInTx(
      tx,
      options,
    );

    const systemCtx = {
      organizationId: organization.id,
      actorId: "system",
      role: "Admin" as const,
      permissions: [],
    };

    const txUserRepo = createUserRepo(tx);
    // RBAC-M10-E: "already has an active admin" is an assignment-backed
    // question. P0-7.
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
    // 2. Create the first Admin with the explicit (hashed) password.
    const user = await txUserRepo.createUnique(systemCtx, {
      username: params.username,
      passwordHash,
      name: params.name,
      role: "Admin",
      isActive: true,
    });
    // 3. Create the primary Admin assignment in the SAME transaction.
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
    // 4. Write admin.bootstrap audit evidence in the SAME transaction.
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
    return { organization, user };
  });

  return {
    organization: result.organization,
    user: {
      id: result.user.id,
      username: result.user.username,
      name: result.user.name,
      role: result.user.role,
      isActive: result.user.isActive,
    },
  };
}

// ── CLI entry point ──────────────────────────────────────────────

interface ParsedCliArgs extends BootstrapAdminParams {
  organizationName: string | undefined;
  organizationDisplayName: string | undefined;
}

function parseArgs(argv: string[]): ParsedCliArgs {
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
      if (!value || value.startsWith("--")) {
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
    organizationName: args["organization-name"],
    organizationDisplayName: args["organization-display-name"],
  };
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
    const orgOptions: BootstrapAdminOrganizationOptions = {};
    if (params.organizationName) {
      orgOptions.organizationName = params.organizationName;
    }
    if (params.organizationDisplayName) {
      orgOptions.organizationDisplayName = params.organizationDisplayName;
    }
    const result = await bootstrapAdminOnFreshDb(conn.db, params, orgOptions);
    const orgVerb = result.organization.created ? "Created" : "Resolved";
    process.stdout.write(
      `Organization ${orgVerb}.\n` +
        `  id:          ${result.organization.id}\n` +
        `  name:        ${result.organization.name}\n` +
        `  displayName: ${result.organization.displayName}\n` +
        `  slug:        ${result.organization.slug}\n` +
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
