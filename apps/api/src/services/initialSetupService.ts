/**
 * P7-C1 C1.6 — Initial setup service (canonical first-Admin bootstrap command).
 *
 * This is the SINGLE canonical owner of the "create the first Admin for the
 * internal default organization" state change. Two adapters call it:
 *   - `apps/api/src/scripts/bootstrap-admin.ts` (operator CLI fallback)
 *   - `apps/api/src/routes/launchpad.ts` (HTTP first-install handoff)
 *
 * One state change, one canonical command owner (Exam platform invariant).
 *
 * The body (resolve/create org → first Admin → primary assignment →
 * `admin.bootstrap` audit, all in ONE transaction) was extracted verbatim
 * from the former `bootstrapAdminOnFreshDb` so the CLI path is unchanged.
 *
 * The launchpad HTTP path additionally takes a transaction-scoped advisory
 * lock to serialize concurrent first-Admin creation (P2-5): the existing DB
 * unique constraints only produce a loser for SAME-username concurrent
 * requests; different usernames would both commit (two admins). See
 * {@link bootstrapInitialAdminWithLock}.
 */
import { sql } from "drizzle-orm";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { recordAtomicSystemAudit } from "../audit/auditWriter.js";
import {
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_SLUG,
  type BootstrapAdminOrganizationOptions,
  type BootstrapAdminParams,
  type BootstrapAdminResult,
} from "../scripts/bootstrap-admin.js";

export {
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_SLUG,
  type BootstrapAdminOrganizationOptions,
  type BootstrapAdminParams,
  type BootstrapAdminResult,
};

/**
 * Provenance marker recorded in the `admin.bootstrap` audit metadata.
 * Distinguishes the CLI operator path from the HTTP launchpad path.
 */
export type BootstrapSource = "local_script" | "launchpad_http";

/**
 * A transaction-scoped PostgreSQL advisory lock key that serializes the
 * launchpad first-Admin creation (P2-5). Uses `hashtext()` for a stable
 * 32-bit key derived from a constant name. Transaction-scoped locks are
 * automatically released at COMMIT/ROLLBACK, so the second concurrent request
 * blocks until the first commits, then its post-acquire fresh-check sees the
 * now-non-fresh installation and returns 409 LAUNCHPAD_ALREADY_COMPLETED.
 *
 * NB: this is deliberately narrow — it serializes ONLY launchpad bootstrap,
 * not a generic lease/startup-lock framework.
 */
export const LAUNCHPAD_BOOTSTRAP_ADVISORY_KEY_NAME = "exam.launchpad.bootstrap";

/**
 * Resolve/create the internal default organization inside a transaction.
 * Accepts either a top-level Database or a transaction so it can run inside
 * the same transaction as the Admin/assignment/audit writes. Uses
 * `onConflictDoUpdate` on slug to make the insert idempotent under concurrency.
 *
 * Extracted verbatim from the former bootstrapAdminOnFreshDb helper.
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
 * Create the first Admin for the internal default organization.
 *
 * Canonical command (P7-C1 C1.6): resolve/create org → first Admin → primary
 * assignment → `admin.bootstrap` audit, all in ONE transaction. If any step
 * fails, none of them land (no orphan org, user, assignment, or audit).
 *
 * The {@link source} provenance marker is recorded in the audit metadata so
 * the CLI and launchpad paths are distinguishable in the audit trail.
 *
 * Refuses to create a second active Admin unless `params.force` is set.
 *
 * @param db - Database connection (the CLI passes its top-level connection).
 * @param params - Admin credentials + display name (+ optional force).
 * @param options - Organization name/display-name overrides.
 * @param source - Audit provenance: "local_script" (CLI) or "launchpad_http".
 */
export async function bootstrapInitialAdmin(
  db: Database,
  params: BootstrapAdminParams,
  options: BootstrapAdminOrganizationOptions = {},
  source: BootstrapSource = "local_script",
): Promise<BootstrapAdminResult> {
  const passwordHash = await hashPassword(params.password);

  const result = await executeInTransaction(db, async (tx) => {
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
          source,
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

/**
 * Determine whether the installation is genuinely fresh (never initialized).
 *
 * "Fresh" = NO organization exists AND NO user exists. Once any org/user has
 * EVER existed, the installation is permanently initialized — the launchpad
 * never reopens, even if all Admins are later disabled/deleted (no privilege
 * takeover). This is the durable precondition for the launchpad gate.
 *
 * Uses the cheapest probes: `SELECT 1 ... LIMIT 1` on each table.
 *
 * @returns true iff the installation has never been initialized.
 */
export async function isInstallationFresh(db: Database): Promise<boolean> {
  const orgRows = await db
    .select({ one: sql<1>`1` })
    .from(schema.organizations)
    .limit(1);
  if (orgRows.length > 0) return false;
  const userRows = await db
    .select({ one: sql<1>`1` })
    .from(schema.users)
    .limit(1);
  return userRows.length === 0;
}

/**
 * Launchpad single-winner bootstrap (P2-5).
 *
 * Takes a transaction-scoped advisory lock as the FIRST statement inside the
 * transaction, then re-checks installation-freshness under the lock. Under
 * concurrent launchpad bootstrap requests with DIFFERENT usernames, the
 * existing DB unique constraints do NOT produce a loser (both would commit two
 * different admins). The advisory lock serializes them: the second request
 * blocks until the first commits, then its post-acquire fresh-check sees the
 * now-non-fresh installation and the caller returns 409
 * LAUNCHPAD_ALREADY_COMPLETED.
 *
 * Throws {@link InstallationAlreadyCompletedError} when the installation is no
 * longer fresh after acquiring the lock (the caller maps this to 409).
 */
export async function bootstrapInitialAdminWithLock(
  db: Database,
  params: BootstrapAdminParams,
  options: BootstrapAdminOrganizationOptions,
): Promise<BootstrapAdminResult> {
  return executeInTransaction(db, async (tx) => {
    // Acquire the launchpad bootstrap advisory lock as the first statement.
    // pg_advisory_xact_lock takes a bigint; we derive a stable 32-bit key via
    // hashtext() so the key is deterministic across processes/connections.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${LAUNCHPAD_BOOTSTRAP_ADVISORY_KEY_NAME}))`,
    );

    // Re-check freshness UNDER the lock. If another bootstrap committed
    // between the outer status-check and lock-acquisition, this is no longer
    // fresh → the caller must return 409 LAUNCHPAD_ALREADY_COMPLETED.
    const orgRows = await tx
      .select({ one: sql<1>`1` })
      .from(schema.organizations)
      .limit(1);
    const userRows = await tx
      .select({ one: sql<1>`1` })
      .from(schema.users)
      .limit(1);
    if (orgRows.length > 0 || userRows.length > 0) {
      throw new InstallationAlreadyCompletedError(
        "Launchpad bootstrap aborted: installation is no longer fresh " +
          "(another bootstrap completed concurrently).",
      );
    }

    // Freshness re-confirmed under the lock → run the canonical bootstrap.
    // We inline the body here (rather than calling bootstrapInitialAdmin) so
    // the whole thing runs in THIS locked transaction (bootstrapInitialAdmin
    // opens its own transaction, which would not hold the advisory lock).
    const passwordHash = await hashPassword(params.password);
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
    const user = await txUserRepo.createUnique(systemCtx, {
      username: params.username,
      passwordHash,
      name: params.name,
      role: "Admin",
      isActive: true,
    });
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
          source: "launchpad_http",
        },
      },
    );
    return {
      organization,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      },
    };
  });
}

/**
 * Thrown by {@link bootstrapInitialAdminWithLock} when the installation is no
 * longer fresh after acquiring the advisory lock (concurrent winner). The
 * launchpad route maps this to 409 LAUNCHPAD_ALREADY_COMPLETED.
 */
export class InstallationAlreadyCompletedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallationAlreadyCompletedError";
  }
}
