import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import { cleanupOrganizationTestData } from "./testCleanup.js";
import { schema } from "./schema/pg.js";

describe("cleanupOrganizationTestData", () => {
  it("removes audit logs before organizations and keeps other organizations", async () => {
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values([
      {
        id: organizationId,
        name: "Cleanup Test Organization",
        displayName: "Cleanup Test Organization",
        slug: `cleanup-test-${organizationId}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherOrganizationId,
        name: "Other Cleanup Test Organization",
        displayName: "Other Cleanup Test Organization",
        slug: `cleanup-test-${otherOrganizationId}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(schema.auditLogs).values([
      {
        id: crypto.randomUUID(),
        organizationId,
        actorId: crypto.randomUUID(),
        action: "cleanup.test",
        targetType: "organization",
        targetId: organizationId,
        metadata: {},
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: otherOrganizationId,
        actorId: crypto.randomUUID(),
        action: "cleanup.test",
        targetType: "organization",
        targetId: otherOrganizationId,
        metadata: {},
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      },
    ]);

    await cleanupOrganizationTestData(db, organizationId);
    await cleanupOrganizationTestData(db, organizationId);

    const deletedOrg = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    const deletedAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));
    const otherOrg = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, otherOrganizationId));
    const otherAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, otherOrganizationId));

    expect(deletedOrg).toEqual([]);
    expect(deletedAudits).toEqual([]);
    expect(otherOrg).toHaveLength(1);
    expect(otherAudits).toHaveLength(1);

    await cleanupOrganizationTestData(db, otherOrganizationId);
  });
});
