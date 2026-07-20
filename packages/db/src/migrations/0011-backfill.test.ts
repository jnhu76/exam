import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedTestDb } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import { migratePostgres } from "../postgres.js";
import { schema } from "../schema/pg.js";
import { eq, and } from "drizzle-orm";
import { type IsolatedTestDb } from "../testIsolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract the SQL statement between BEGIN 0011_BACKFILL_ASSIGNMENTS and
 * END 0011_BACKFILL_ASSIGNMENTS markers from the 0011 migration file.
 */
function extractBackfillSql(): string {
  const filePath = resolve(
    __dirname,
    "../../migrations/postgres/0011_true_silvermane.sql",
  );
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) =>
    l.includes("BEGIN 0011_BACKFILL_ASSIGNMENTS"),
  );
  const endIdx = lines.findIndex((l) =>
    l.includes("END 0011_BACKFILL_ASSIGNMENTS"),
  );
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      "Could not find BEGIN/END 0011_BACKFILL_ASSIGNMENTS markers in 0011 migration file",
    );
  }
  return lines
    .slice(startIdx + 1, endIdx)
    .join("\n")
    .trim();
}

/**
 * Set up an isolated test schema with migrations applied.
 */
async function setupIsolatedEnv() {
  const iso = await setupIsolatedTestDb({ namespace: "mig0011" });
  const conn = await createDatabase(iso.databaseUrl, iso.schemaName);
  await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });
  // Truncate user_role_assignments so we start with a clean slate for the backfill test
  await conn.db.delete(schema.userRoleAssignments);
  return { iso, conn };
}

async function teardownIsolatedEnv(env: {
  iso: IsolatedTestDb;
  conn: Awaited<ReturnType<typeof createDatabase>>;
}) {
  await env.conn.sql.end();
  await env.iso.cleanup();
}

describe("0011 backfill guard — assignable users only", () => {
  let env: Awaited<ReturnType<typeof setupIsolatedEnv>>;

  beforeAll(async () => {
    env = await setupIsolatedEnv();
  });

  afterAll(async () => {
    await teardownIsolatedEnv(env);
  });

  it("backfill skips SuperAdmin and only backfills assignable roles", async () => {
    const now = new Date();
    const orgId = "00000000-0000-4000-8000-000000000001";

    await env.conn.db.insert(schema.organizations).values({
      id: orgId,
      name: "Test Org",
      displayName: "Test Org",
      slug: "test-org",
      createdAt: now,
      updatedAt: now,
    });

    const adminId = "00000000-0000-4000-8000-000000000010";
    const candidateId = "00000000-0000-4000-8000-000000000011";
    const superAdminId = "00000000-0000-4000-8000-000000000012";

    await env.conn.db.insert(schema.users).values([
      {
        id: adminId,
        organizationId: orgId,
        username: "admin-user",
        passwordHash: "hash",
        name: "Admin User",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: candidateId,
        organizationId: orgId,
        username: "candidate-user",
        passwordHash: "hash",
        name: "Candidate User",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: superAdminId,
        organizationId: orgId,
        username: "superadmin-user",
        passwordHash: "hash",
        name: "SuperAdmin User",
        role: "SuperAdmin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Execute the backfill SQL
    const backfillSql = extractBackfillSql();
    await env.conn.sql.unsafe(backfillSql);

    // Admin has exactly one primary active assignment
    const adminAssignments = await env.conn.db
      .select()
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, adminId),
          eq(schema.userRoleAssignments.organizationId, orgId),
        ),
      );
    expect(adminAssignments.length).toBe(1);
    expect(adminAssignments[0].role).toBe("Admin");
    expect(adminAssignments[0].isPrimary).toBe(true);
    expect(adminAssignments[0].isActive).toBe(true);

    // Candidate has exactly one primary active assignment
    const candidateAssignments = await env.conn.db
      .select()
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, candidateId),
          eq(schema.userRoleAssignments.organizationId, orgId),
        ),
      );
    expect(candidateAssignments.length).toBe(1);
    expect(candidateAssignments[0].role).toBe("Candidate");
    expect(candidateAssignments[0].isPrimary).toBe(true);
    expect(candidateAssignments[0].isActive).toBe(true);

    // SuperAdmin has ZERO assignment rows (skipped by guard)
    const superAdminAssignments = await env.conn.db
      .select()
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, superAdminId),
          eq(schema.userRoleAssignments.organizationId, orgId),
        ),
      );
    expect(superAdminAssignments.length).toBe(0);
  });
});

describe("0011 backfill guard — all legacy non-assignable roles", () => {
  let env: Awaited<ReturnType<typeof setupIsolatedEnv>>;

  beforeAll(async () => {
    env = await setupIsolatedEnv();
  });

  afterAll(async () => {
    await teardownIsolatedEnv(env);
  });

  it("backfill with only non-assignable roles skips them all without CHECK violation", async () => {
    const now = new Date();
    const orgId = "00000000-0000-4000-8000-000000000002";

    await env.conn.db.insert(schema.organizations).values({
      id: orgId,
      name: "Test Org 2",
      displayName: "Test Org 2",
      slug: "test-org-2",
      createdAt: now,
      updatedAt: now,
    });

    // Insert users with roles outside the assignable set
    const legacyRoles = [
      { id: "00000000-0000-4000-8000-000000000020", role: "SuperAdmin" },
      { id: "00000000-0000-4000-8000-000000000021", role: "System" },
      { id: "00000000-0000-4000-8000-000000000022", role: "ContentManager" },
      { id: "00000000-0000-4000-8000-000000000023", role: "ResultViewer" },
    ];

    for (const u of legacyRoles) {
      await env.conn.db.insert(schema.users).values({
        id: u.id,
        organizationId: orgId,
        username: `user-${u.role}`,
        passwordHash: "hash",
        name: `${u.role} User`,
        role: u.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Also insert one valid Admin
    const adminId = "00000000-0000-4000-8000-000000000024";
    await env.conn.db.insert(schema.users).values({
      id: adminId,
      organizationId: orgId,
      username: "valid-admin",
      passwordHash: "hash",
      name: "Valid Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const backfillSql = extractBackfillSql();
    // Should not throw — the guard protects against CHECK violation
    const result = await env.conn.sql.unsafe(backfillSql);
    expect(result).toBeDefined();

    // Verify only Admin got an assignment
    const allAssignments = await env.conn.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.organizationId, orgId));
    expect(allAssignments.length).toBe(1);
    expect(allAssignments[0].role).toBe("Admin");
  });
});
