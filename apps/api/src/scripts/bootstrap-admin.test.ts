import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@exam/auth/src/password.js";
import { bootstrapAdmin } from "./bootstrap-admin.js";

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
