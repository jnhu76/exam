import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import {
  cleanupOrganizationChildData,
  cleanupOrganizationTestData,
} from "./testCleanup.js";
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

  it("retries past a late-landing fire-and-forget audit insert (FK race)", async () => {
    // Reproduces the candidateField.test.ts cleanup race: a production route
    // writes its audit log via the fire-and-forget recordAudit() helper, whose
    // insert is NOT awaited by the request. When the test tears the org down in
    // a finally block, that pending insert can commit between this helper's
    // audit_logs delete and its organizations delete, triggering an
    // audit_logs_organization_id_organizations_id_fk violation. The helper must
    // retry the full delete tree so a later attempt sweeps the late insert.
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "FK Race Org",
      displayName: "FK Race Org",
      slug: `fk-race-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      organizationId,
      actorId: crypto.randomUUID(),
      action: "race.before",
      targetType: "organization",
      targetId: organizationId,
      metadata: {},
      ipAddress: null,
      userAgent: null,
      createdAt: now,
    });

    // Fire a small, realistic burst of "late-landing" audit inserts concurrent
    // with cleanup, mimicking one or two fire-and-forget recordAudit() calls
    // whose inserts commit during teardown (the candidateField.test.ts
    // scenario: a single POST writes one audit row that is not awaited).
    // recordAudit swallows its own insert errors (.catch), so inserts that fail
    // because the org is already gone are fine. The cleanup retry window must
    // outlast this finite burst.
    const lateInserts = Promise.all(
      Array.from({ length: 2 }, (_, i) =>
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1)));
          await db
            .insert(schema.auditLogs)
            .values({
              id: crypto.randomUUID(),
              organizationId,
              actorId: crypto.randomUUID(),
              action: "race.late",
              targetType: "organization",
              targetId: organizationId,
              metadata: {},
              ipAddress: null,
              userAgent: null,
              createdAt: new Date(),
            })
            .catch(() => {
              /* mirrors recordAudit fire-and-forget error swallowing */
            });
        })(),
      ),
    );

    // Must not throw despite the concurrent inserts racing the org delete.
    await expect(
      cleanupOrganizationTestData(db, organizationId),
    ).resolves.toBeUndefined();
    await lateInserts;

    const orgRow = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(orgRow).toEqual([]);
  });
});

describe("cleanupOrganizationChildData", () => {
  it("removes child rows but keeps the organization and its users intact", async () => {
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Child Cleanup Org",
      displayName: "Child Cleanup Org",
      slug: `child-cleanup-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: userId,
      organizationId,
      username: `child-cleanup-user-${organizationId}`,
      passwordHash: "hash",
      name: "Child Cleanup User",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      organizationId,
      actorId: userId,
      action: "child.test",
      targetType: "organization",
      targetId: organizationId,
      metadata: {},
      ipAddress: null,
      userAgent: null,
      createdAt: now,
    });

    await cleanupOrganizationChildData(db, organizationId);

    const orgRow = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    const userRow = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));

    expect(orgRow).toHaveLength(1);
    expect(userRow).toHaveLength(1);
    expect(auditRows).toEqual([]);

    await cleanupOrganizationTestData(db, organizationId);
  });

  it("is idempotent and safe to run on an already-cleaned organization", async () => {
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Idempotent Child Org",
      displayName: "Idempotent Child Org",
      slug: `idempotent-child-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });

    await cleanupOrganizationChildData(db, organizationId);
    await expect(
      cleanupOrganizationChildData(db, organizationId),
    ).resolves.toBeUndefined();

    await cleanupOrganizationTestData(db, organizationId);
  });
});
