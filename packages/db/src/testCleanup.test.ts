import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import {
  cleanupBusinessData,
  cleanupOrganizationChildData,
  cleanupOrganizationTestData,
  isForeignKeyViolation,
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

  it("cleans up an org with a pre-existing audit log (baseline for the FK-race retry)", async () => {
    // Regression context for the candidateField.test.ts cleanup race: a
    // production route writes its audit log via the fire-and-forget
    // recordAudit() helper, whose insert is NOT awaited by the request. When
    // the test tears the org down, a pending insert can commit between this
    // helper's audit_logs delete and its organizations delete, triggering an
    // audit_logs_organization_id_organizations_id_fk violation. The helper
    // handles this with a bounded retry that re-deletes audit_logs. This test
    // pins the baseline contract (a committed audit log is deleted before the
    // org); the FK-violation detection that drives the retry is covered
    // deterministically by isForeignKeyViolation() unit tests below.
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

    await expect(
      cleanupOrganizationTestData(db, organizationId),
    ).resolves.toBeUndefined();

    const orgRow = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(orgRow).toEqual([]);
    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));
    expect(auditRows).toEqual([]);
  });
});

describe("isForeignKeyViolation", () => {
  // The retry loop in cleanupOrganizationTestData keys on this predicate. These
  // deterministic unit tests prove the retry is triggered exactly for PG
  // SQLSTATE 23503 (foreign_key_violation) and nothing else, which is what
  // makes the late-landing-audit race recoverable instead of fatal.
  it("returns true for a Postgres foreign-key violation (SQLSTATE 23503)", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
  });

  it("returns false for other Postgres errors", () => {
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false); // unique violation
    expect(isForeignKeyViolation({ code: "42P01" })).toBe(false); // undefined table
  });

  it("returns false for non-pg errors, null, and primitives", () => {
    expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation("23503")).toBe(false);
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

describe("cleanupBusinessData", () => {
  it("removes exam business data but keeps org, users, and candidate data intact", async () => {
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const examId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Business Cleanup Org",
      displayName: "Business Cleanup Org",
      slug: `biz-cleanup-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: userId,
      organizationId,
      username: `biz-user-${organizationId}`,
      passwordHash: "hash",
      name: "Biz User",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: "Biz Course",
      code: `biz-course-${organizationId}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId,
      courseId,
      title: "Biz Exam",
      description: "",
      status: "draft",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(Date.now() + 86400000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: false,
      },
      retakePolicy: "no_retake",
      scoreStrategy: "best",
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      organizationId,
      actorId: userId,
      action: "biz.test",
      targetType: "exam",
      targetId: examId,
      metadata: {},
      ipAddress: null,
      userAgent: null,
      createdAt: now,
    });

    await cleanupBusinessData(db, organizationId);

    const orgRow = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    const userRow = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const examRows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.organizationId, organizationId));
    const courseRows = await db
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.organizationId, organizationId));
    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));

    expect(orgRow).toHaveLength(1);
    expect(userRow).toHaveLength(1);
    expect(examRows).toEqual([]);
    expect(courseRows).toEqual([]);
    expect(auditRows).toEqual([]);

    await cleanupOrganizationTestData(db, organizationId);
  });

  it("is idempotent and safe to run on an already-cleaned organization", async () => {
    const { db } = await getTestDb();
    const organizationId = crypto.randomUUID();
    const now = new Date();

    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Idempotent Biz Org",
      displayName: "Idempotent Biz Org",
      slug: `idempotent-biz-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });

    await cleanupBusinessData(db, organizationId);
    await expect(
      cleanupBusinessData(db, organizationId),
    ).resolves.toBeUndefined();

    await cleanupOrganizationTestData(db, organizationId);
  });
});
