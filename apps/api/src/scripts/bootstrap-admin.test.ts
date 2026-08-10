import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { and, eq, sql } from "drizzle-orm";
import { verifyPassword } from "@exam/auth/src/password.js";
import { AdminAlreadyExistsError } from "@exam/domain";
import {
  bootstrapAdmin,
  bootstrapAdminOnFreshDb,
  DEFAULT_ORG_SLUG,
  resolveOrCreateDefaultOrganization,
} from "./bootstrap-admin.js";

let _counter = 0;
async function freshOrg(db: Database): Promise<string> {
  _counter++;
  const rows = await db
    .insert(schema.organizations)
    .values({
      id: crypto.randomUUID(),
      name: `Boot Org ${_counter}`,
      displayName: `Boot Org ${_counter}`,
      slug: `boot-org-${Date.now()}-${_counter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: schema.organizations.id });
  return rows[0]!.id;
}

async function installBootstrapAuditFailure(
  db: Database,
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_bootstrap_audit_${suffix}`;
  const triggerName = `fail_bootstrap_audit_trigger_${suffix}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected bootstrap audit failure';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = 'admin.bootstrap')
      EXECUTE FUNCTION ${functionName}()
    `),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

describe("bootstrapAdmin service", () => {
  let db: Database;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap",
      databaseUrl: resolveTestDbUrl(),
    });
    cleanup = iso.cleanup;
    conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    db = conn.db;
    await migratePostgres(db, { migrationsSchema: iso.schemaName });
  });

  afterAll(async () => {
    await conn.sql.end();
    await cleanup();
  });

  it("creates first Admin with hashed password", async () => {
    const orgId = await freshOrg(db);
    const username = `boot-${Date.now()}`;
    const result = await bootstrapAdmin(db, orgId, {
      username,
      password: "StrongPass123!",
      name: "First Admin",
    });

    expect(result.user.username).toBe(username);
    expect(result.user.role).toBe("Admin");
    expect(result.user.isActive).toBe(true);

    const stored = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.user.id));
    expect(stored[0]!.passwordHash).not.toBe("StrongPass123!");
    expect(
      await verifyPassword("StrongPass123!", stored[0]!.passwordHash),
    ).toBe(true);
  });

  it("writes admin.bootstrap audit log without password", async () => {
    const orgId = await freshOrg(db);
    const username = `boot-audit-${Date.now()}`;
    const result = await bootstrapAdmin(db, orgId, {
      username,
      password: "StrongPass123!",
      name: "Audited Admin",
    });

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, result.user.id));
    const bootstrapAudit = auditRows.find(
      (r) => r.action === "admin.bootstrap",
    );
    expect(bootstrapAudit).toBeDefined();
    expect(bootstrapAudit!.actorId).toBe("system");
    expect(bootstrapAudit!.targetType).toBe("user");
    const metadata = bootstrapAudit!.metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain("password");
    expect(JSON.stringify(metadata)).not.toContain("StrongPass123!");
    expect(metadata.username).toBe(username);
  });

  it("rolls back the CLI-created identity when the audit insert fails", async () => {
    const orgId = await freshOrg(db);
    const username = `boot-rollback-${Date.now()}`;
    const removeFailure = await installBootstrapAuditFailure(db);
    try {
      await expect(
        bootstrapAdmin(db, orgId, {
          username,
          password: "StrongPass123!",
          name: "Rolled Back Admin",
        }),
      ).rejects.toThrow();

      const users = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.organizationId, orgId),
            eq(schema.users.username, username),
          ),
        );
      expect(users).toHaveLength(0);
      const audits = await db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.organizationId, orgId),
            eq(schema.auditLogs.action, "admin.bootstrap"),
          ),
        );
      expect(audits).toHaveLength(0);
    } finally {
      await removeFailure();
    }
  });

  it("refuses when an active Admin already exists", async () => {
    const orgId = await freshOrg(db);
    await bootstrapAdmin(db, orgId, {
      username: `boot-dup-${Date.now()}`,
      password: "StrongPass123!",
      name: "Existing Admin",
    });

    await expect(
      bootstrapAdmin(db, orgId, {
        username: `boot-dup2-${Date.now()}`,
        password: "StrongPass123!",
        name: "Second Admin",
      }),
    ).rejects.toThrow(/active.*[Aa]dmin.*exists/);
  });

  it("allows --force to create additional Admin", async () => {
    const orgId = await freshOrg(db);
    await bootstrapAdmin(db, orgId, {
      username: `boot-force-${Date.now()}`,
      password: "StrongPass123!",
      name: "Force Admin 1",
    });

    const result = await bootstrapAdmin(db, orgId, {
      username: `boot-force2-${Date.now()}`,
      password: "StrongPass123!",
      name: "Force Admin 2",
      force: true,
    });
    expect(result.user.role).toBe("Admin");
  });

  it("does not create SuperAdmin or Teacher", async () => {
    const orgId = await freshOrg(db);
    const username = `boot-role-${Date.now()}`;
    const result = await bootstrapAdmin(db, orgId, {
      username,
      password: "StrongPass123!",
      name: "Role Check Admin",
    });
    expect(result.user.role).toBe("Admin");
    expect(result.user.role).not.toBe("SuperAdmin");
    expect(result.user.role).not.toBe("Teacher");
  });
});

// ──────────────────────────────────────────────────────────────────────
// P6-008: production-safe first-Admin bootstrap (fresh-DB path).
// These tests verify bootstrapAdminOnFreshDb against a migrated-but-empty
// DB (no "default" organization yet), which is the real production
// bootstrap surface. The canonical production path must NOT use the
// baseline dev/test seed (which ships known default credentials).
// ──────────────────────────────────────────────────────────────────────

describe("bootstrapAdminOnFreshDb (production bootstrap path)", () => {
  let freshDb: Database;
  let freshConn: Awaited<ReturnType<typeof createDatabase>>;
  let freshCleanup: () => Promise<void>;

  beforeAll(async () => {
    // A totally fresh isolated schema simulates a migrated-but-empty
    // production DB: migrations applied, no organization, no users.
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-fresh",
      databaseUrl: resolveTestDbUrl(),
    });
    freshCleanup = iso.cleanup;
    freshConn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    freshDb = freshConn.db;
    await migratePostgres(freshDb, { migrationsSchema: iso.schemaName });
  });

  afterAll(async () => {
    await freshConn.sql.end();
    await freshCleanup();
  });

  it("creates the default organization when none exists", async () => {
    // Precondition: no "default" organization exists yet.
    const preOrgs = await freshDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, DEFAULT_ORG_SLUG));
    expect(preOrgs).toHaveLength(0);

    const username = `fresh-boot-${Date.now()}`;
    const result = await bootstrapAdminOnFreshDb(
      freshDb,
      {
        username,
        password: "StrongPass123!",
        name: "Fresh Admin",
      },
      { organizationName: "Fresh Org" },
    );

    // Organization was created with the supplied name.
    expect(result.organization.created).toBe(true);
    expect(result.organization.slug).toBe(DEFAULT_ORG_SLUG);
    expect(result.organization.name).toBe("Fresh Org");
    expect(result.organization.displayName).toBe("Fresh Org");

    // The org row exists in the DB.
    const orgs = await freshDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, result.organization.id));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.slug).toBe(DEFAULT_ORG_SLUG);
  });

  it("creates the first Admin with the primary Admin role assignment", async () => {
    // Re-use the Admin created by the previous test (first bootstrap).
    const admins = await freshDb
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, "Admin"));
    expect(admins.length).toBeGreaterThanOrEqual(1);
    const adminId = admins[0]!.id;

    // Primary Admin role assignment exists in the same transaction.
    const assignments = await freshDb
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, adminId));
    expect(assignments.length).toBeGreaterThanOrEqual(1);
    const primary = assignments.find((a) => a.isPrimary);
    expect(primary).toBeDefined();
    expect(primary!.role).toBe("Admin");
    expect(primary!.isActive).toBe(true);
  });

  it("writes admin.bootstrap audit evidence", async () => {
    const admins = await freshDb
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, "Admin"));
    const adminId = admins[0]!.id;

    const auditRows = await freshDb
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, adminId));
    const bootstrapAudit = auditRows.find(
      (r) => r.action === "admin.bootstrap",
    );
    expect(bootstrapAudit).toBeDefined();
    expect(bootstrapAudit!.actorId).toBe("system");
    expect(bootstrapAudit!.targetType).toBe("user");
    // Password must never appear in audit metadata.
    const metadata = bootstrapAudit!.metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain("password");
    expect(JSON.stringify(metadata)).not.toContain("StrongPass123!");
  });

  it("hashes the explicit password (never stores plaintext)", async () => {
    const admins = await freshDb
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, "Admin"));
    const admin = admins[0]!;
    expect(admin.passwordHash).not.toBe("StrongPass123!");
    expect(await verifyPassword("StrongPass123!", admin.passwordHash)).toBe(
      true,
    );
  });

  it("resolves the existing default organization when one exists", async () => {
    // The first test created "default"; this call must NOT overwrite it.
    const username = `fresh-boot2-${Date.now()}`;
    const result = await bootstrapAdminOnFreshDb(
      freshDb,
      {
        username,
        password: "StrongPass123!",
        name: "Fresh Admin 2",
        // An active Admin already exists from the first bootstrap, so
        // force is required to create another.
        force: true,
      },
      // Supply a DIFFERENT name to prove the existing org is preserved.
      { organizationName: "Should Be Ignored" },
    );

    expect(result.organization.created).toBe(false);
    expect(result.organization.name).toBe("Fresh Org"); // preserved
  });

  it("refuses a second Admin without --force", async () => {
    // An active Admin already exists from the first bootstrap.
    // bootstrapAdminOnFreshDb must refuse a new Admin unless force=true.
    await expect(
      bootstrapAdminOnFreshDb(freshDb, {
        username: `fresh-dup-${Date.now()}`,
        password: "StrongPass123!",
        name: "Dup Admin",
      }),
    ).rejects.toThrow(/active.*[Aa]dmin.*exists/);
  });

  it("rolls back org + user + assignment when the audit insert fails (atomic)", async () => {
    // P6-008: org, Admin, assignment, and audit must commit atomically in ONE
    // transaction. Inject an audit failure on a fresh schema and prove that
    // NONE of org/user/assignment land (no orphan org, no orphan user).
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-atomic",
      databaseUrl: resolveTestDbUrl(),
    });
    try {
      const conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
      const atomicDb = conn.db;
      await migratePostgres(atomicDb, {
        migrationsSchema: iso.schemaName,
      });
      const removeFailure = await installBootstrapAuditFailure(atomicDb);
      try {
        await expect(
          bootstrapAdminOnFreshDb(atomicDb, {
            username: `atomic-${Date.now()}`,
            password: "StrongPass123!",
            name: "Atomic Admin",
          }),
        ).rejects.toThrow();

        // The org must NOT have been committed (no "default" org row).
        const orgs = await atomicDb
          .select({ id: schema.organizations.id })
          .from(schema.organizations)
          .where(eq(schema.organizations.slug, DEFAULT_ORG_SLUG));
        expect(orgs).toHaveLength(0);

        // No user, no assignment, no audit either.
        const users = await atomicDb
          .select({ id: schema.users.id })
          .from(schema.users);
        expect(users).toHaveLength(0);
        const audits = await atomicDb
          .select({ id: schema.auditLogs.id })
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.action, "admin.bootstrap"));
        expect(audits).toHaveLength(0);
      } finally {
        await removeFailure();
        await conn.sql.end();
      }
    } finally {
      await iso.cleanup();
    }
  });

  it("allows --force to create an additional Admin", async () => {
    const username = `fresh-force-${Date.now()}`;
    const result = await bootstrapAdminOnFreshDb(freshDb, {
      username,
      password: "StrongPass123!",
      name: "Force Admin",
      force: true,
    });
    expect(result.user.role).toBe("Admin");
    expect(result.user.isActive).toBe(true);
  });

  it("does not create Candidate accounts", async () => {
    // The production bootstrap creates Admins only. Candidate accounts
    // are created by the Admin via POST /api/admin/candidates, never by
    // the bootstrap path. Verify no Candidate-role user exists.
    const candidates = await freshDb
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, "Candidate"));
    // The fresh schema started empty; bootstrap never adds Candidates.
    expect(candidates).toHaveLength(0);
  });

  it("records the adapter source in the admin.bootstrap audit metadata", async () => {
    // The canonical mutation accepts an explicit source so the audit
    // reflects the real entry point (CLI = local_script, HTTP launchpad =
    // launchpad) instead of a single hardcoded value.
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-source",
      databaseUrl: resolveTestDbUrl(),
    });
    try {
      const conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
      const sourceDb = conn.db;
      await migratePostgres(sourceDb, { migrationsSchema: iso.schemaName });
      try {
        const username = `source-${Date.now()}`;
        await bootstrapAdminOnFreshDb(
          sourceDb,
          {
            username,
            password: "StrongPass123!",
            name: "Source Admin",
          },
          { organizationName: "Source Org" },
          "launchpad",
        );
        const audits = await sourceDb
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.action, "admin.bootstrap"));
        expect(audits).toHaveLength(1);
        const metadata = audits[0]!.metadata as Record<string, unknown>;
        expect(metadata.source).toBe("launchpad");
      } finally {
        await conn.sql.end();
      }
    } finally {
      await iso.cleanup();
    }
  });

  it("serializes concurrent first-install attempts: exactly one winner, one Admin, one audit", async () => {
    // Two non-force bootstrap attempts race on a migrated-but-empty schema.
    // The transaction-scoped advisory lock makes the serialization domain
    // explicit: exactly one attempt commits; the loser re-reads the Admin
    // authority inside its own (now-serialized) transaction and refuses
    // with the typed AdminAlreadyExistsError — never a silent second Admin.
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-race",
      databaseUrl: resolveTestDbUrl(),
    });
    try {
      const conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
      const raceDb = conn.db;
      await migratePostgres(raceDb, { migrationsSchema: iso.schemaName });
      try {
        const ts = Date.now();
        const [a, b] = await Promise.allSettled([
          bootstrapAdminOnFreshDb(
            raceDb,
            {
              username: `race-a-${ts}`,
              password: "StrongPass123!",
              name: "Race Admin A",
            },
            { organizationName: "Race Org" },
            "local_script",
          ),
          bootstrapAdminOnFreshDb(
            raceDb,
            {
              username: `race-b-${ts}`,
              password: "StrongPass123!",
              name: "Race Admin B",
            },
            { organizationName: "Race Org" },
            "launchpad",
          ),
        ]);

        const winner = a.status === "fulfilled" ? a : b;
        const loser = a.status === "rejected" ? a : b;
        expect(winner.status).toBe("fulfilled");
        if (loser.status === "rejected") {
          expect(loser.reason).toBeInstanceOf(AdminAlreadyExistsError);
        } else {
          expect.unreachable("the race loser must reject");
        }

        // Exactly one Admin authority.
        const admins = await raceDb
          .select()
          .from(schema.users)
          .where(eq(schema.users.role, "Admin"));
        expect(admins).toHaveLength(1);

        // Exactly one primary Admin assignment.
        const assignments = await raceDb
          .select()
          .from(schema.userRoleAssignments);
        const primaryAdmins = assignments.filter(
          (x) => x.role === "Admin" && x.isPrimary && x.isActive,
        );
        expect(primaryAdmins).toHaveLength(1);

        // Exactly one first-bootstrap audit, sourced from the winner's
        // adapter (the loser's transaction rolled back).
        const audits = await raceDb
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.action, "admin.bootstrap"));
        expect(audits).toHaveLength(1);
        const metadata = audits[0]!.metadata as Record<string, unknown>;
        const winnerSource =
          winner.status === "fulfilled" &&
          winner.value.user.username === `race-a-${ts}`
            ? "local_script"
            : "launchpad";
        expect(metadata.source).toBe(winnerSource);
      } finally {
        await conn.sql.end();
      }
    } finally {
      await iso.cleanup();
    }
  });
});

describe("resolveOrCreateDefaultOrganization", () => {
  let orgDb: Database;
  let orgConn: Awaited<ReturnType<typeof createDatabase>>;
  let orgCleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-org",
      databaseUrl: resolveTestDbUrl(),
    });
    orgCleanup = iso.cleanup;
    orgConn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    orgDb = orgConn.db;
    await migratePostgres(orgDb, { migrationsSchema: iso.schemaName });
  });

  afterAll(async () => {
    await orgConn.sql.end();
    await orgCleanup();
  });

  it("uses the documented non-secret default name when none is supplied", async () => {
    const result = await resolveOrCreateDefaultOrganization(orgDb);
    expect(result.created).toBe(true);
    expect(result.slug).toBe(DEFAULT_ORG_SLUG);
    // The default name is a documented non-secret display string.
    expect(result.name).toBe("Default Organization");
    expect(result.displayName).toBe("Default Organization");
  });

  it("preserves the existing organization on a second call (no overwrite)", async () => {
    const result = await resolveOrCreateDefaultOrganization(orgDb, {
      organizationName: "Different Name",
    });
    expect(result.created).toBe(false);
    expect(result.name).toBe("Default Organization"); // preserved
  });

  it("uses organizationDisplayName when supplied", async () => {
    // Use a different schema namespace so we can create a fresh org.
    const iso = await setupIsolatedTestDb({
      namespace: "script-bootstrap-org-display",
      databaseUrl: resolveTestDbUrl(),
    });
    try {
      const c = await createDatabase(resolveTestDbUrl(), iso.schemaName);
      const d = c.db;
      await migratePostgres(d, { migrationsSchema: iso.schemaName });
      try {
        const result = await resolveOrCreateDefaultOrganization(d, {
          organizationName: "Internal Name",
          organizationDisplayName: "Display Name",
        });
        expect(result.name).toBe("Internal Name");
        expect(result.displayName).toBe("Display Name");
      } finally {
        await c.sql.end();
      }
    } finally {
      await iso.cleanup();
    }
  });
});
