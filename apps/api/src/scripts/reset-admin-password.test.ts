import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";
import { resetAdminPassword } from "./reset-admin-password.js";

let _counter = 0;
async function freshOrg(db: Database): Promise<string> {
  _counter++;
  const rows = await db
    .insert(schema.organizations)
    .values({
      id: crypto.randomUUID(),
      name: `Reset Org ${_counter}`,
      displayName: `Reset Org ${_counter}`,
      slug: `reset-org-${Date.now()}-${_counter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: schema.organizations.id });
  return rows[0]!.id;
}

async function insertUser(
  db: Database,
  orgId: string,
  role: string,
  username: string,
  password: string,
) {
  const userId = crypto.randomUUID();
  const rows = await db
    .insert(schema.users)
    .values({
      id: userId,
      organizationId: orgId,
      username,
      passwordHash: await hashPassword(password),
      name: `${role} User`,
      role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  // RBAC-M10-E: a user's authority comes from active assignments, not the
  // users.role compatibility projection. The reset-admin script now checks
  // effective Admin via assignments, so the fixture must seed an active
  // primary assignment for the user to be a valid target.
  await db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId,
    role: role as never,
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return rows[0]!;
}

describe("resetAdminPassword service", () => {
  let db: Database;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-reset-pwd",
      databaseUrl: resolveTestDbUrl(),
    });
    cleanup = iso.cleanup;
    conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    db = conn.db;
    await migratePostgres(db, { migrationsSchema: iso.schemaName });
  }, 30_000);

  afterAll(async () => {
    await conn.sql.end();
    await cleanup();
  }, 30_000);

  it("resets Admin password successfully", async () => {
    const orgId = await freshOrg(db);
    const username = `reset-admin-${Date.now()}`;
    const user = await insertUser(db, orgId, "Admin", username, "OldPass123!");

    await resetAdminPassword(db, orgId, {
      username,
      newPassword: "NewStrongPass456!",
    });

    const updated = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(updated[0]!.passwordHash).not.toBe(user.passwordHash);
    expect(
      await verifyPassword("NewStrongPass456!", updated[0]!.passwordHash),
    ).toBe(true);
    expect(await verifyPassword("OldPass123!", updated[0]!.passwordHash)).toBe(
      false,
    );
  });

  it("rejects resetting a Candidate password", async () => {
    const orgId = await freshOrg(db);
    const username = `reset-cand-${Date.now()}`;
    await insertUser(db, orgId, "Candidate", username, "CandPass123!");

    await expect(
      resetAdminPassword(db, orgId, { username, newPassword: "NewPass456!" }),
    ).rejects.toThrow(/Admin/i);
  });

  it("rejects when user does not exist", async () => {
    const orgId = await freshOrg(db);
    await expect(
      resetAdminPassword(db, orgId, {
        username: "nonexistent-user",
        newPassword: "NewPass456!",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("writes audit log without password", async () => {
    const orgId = await freshOrg(db);
    const username = `reset-audit-${Date.now()}`;
    const user = await insertUser(db, orgId, "Admin", username, "OldPass123!");

    await resetAdminPassword(db, orgId, {
      username,
      newPassword: "NewStrongPass456!",
    });

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, user.id));
    const resetAudit = auditRows.find(
      (r) => r.action === "admin.password_reset.local",
    );
    expect(resetAudit).toBeDefined();
    expect(resetAudit!.actorId).toBe("system");
    expect(resetAudit!.targetType).toBe("user");
    const metadata = resetAudit!.metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain("password");
    expect(JSON.stringify(metadata)).not.toContain("NewStrongPass456!");
    expect(metadata.username).toBe(username);
    expect(metadata.source).toBe("local_script");
  });
});
