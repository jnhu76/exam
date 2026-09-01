import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createTeacherCourseAssignmentRepo } from "./teacherCourseAssignmentRepo.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface Fixture {
  organizationId: string;
  actorId: string;
  adminId: string;
  teacherId: string;
  courseAId: string;
  courseBId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const teacherId = randomUUID();
  const courseAId = randomUUID();
  const courseBId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Org ${suffix}`,
    displayName: `Org ${suffix}`,
    slug: `org-${suffix}-${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    {
      id: adminId,
      organizationId,
      username: `admin-${suffix}-${adminId}`,
      passwordHash: "hash",
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: teacherId,
      organizationId,
      username: `teacher-${suffix}-${teacherId}`,
      passwordHash: "hash",
      name: "Teacher",
      role: "Teacher",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.courses).values([
    {
      id: courseAId,
      organizationId,
      name: "Course A",
      code: `CA-${suffix}-${courseAId}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: courseBId,
      organizationId,
      name: "Course B",
      code: `CB-${suffix}-${courseBId}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return {
    organizationId,
    actorId: adminId,
    adminId,
    teacherId,
    courseAId,
    courseBId,
    ctx: context(organizationId, adminId),
  };
}

/** Extract the PostgreSQL constraint name from a 23505 error chain. */
function constraintNameOf(err: unknown): string | null {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        return String(e.constraint ?? e.constraint_name ?? "");
      }
      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return null;
}

describe("teacher course assignment persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;
  let repo: ReturnType<typeof createTeacherCourseAssignmentRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("teacher-course-assignment-persist");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
    repo = createTeacherCourseAssignmentRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  const now = () => new Date("2026-02-01T00:00:00.000Z");

  /** Inserts a fresh Teacher user (each test gets its own to stay independent). */
  async function newTeacher(organizationId: string): Promise<string> {
    const teacherId = randomUUID();
    await db.insert(schema.users).values({
      id: teacherId,
      organizationId,
      username: `teacher-${teacherId}`,
      passwordHash: "hash",
      name: "Teacher",
      role: "Teacher",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
    return teacherId;
  }

  it("insert + read back an active episode", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(row.status).toBe("active");
    expect(row.organizationId).toBe(alpha.organizationId);
    expect(row.revokedBy).toBeNull();
    expect(row.revokedAt).toBeNull();

    const found = await repo.findActiveByTeacherAndCourse(
      alpha.ctx,
      teacherId,
      alpha.courseAId,
    );
    expect(found?.id).toBe(row.id);
    // Cross-course lookup must not match.
    expect(
      await repo.findActiveByTeacherAndCourse(
        alpha.ctx,
        teacherId,
        alpha.courseBId,
      ),
    ).toBeNull();
  });

  it("one-active partial unique rejects a second active episode for the same triple", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // The constraint name is the deterministic arbiter (not message text).
    await repo
      .insertAssignment(alpha.ctx, {
        teacherUserId: teacherId,
        courseId: alpha.courseAId,
        assignedBy: alpha.adminId,
        assignedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      })
      .catch((err: unknown) => {
        expect(constraintNameOf(err)).toBe(
          "teacher_course_assignments_active_unique",
        );
      });
    // A DIFFERENT course for the same teacher is still allowed.
    const other = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseBId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(other.status).toBe("active");
    expect(row.status).toBe("active");
  });

  it("revoke flips the episode and the triple becomes reassignable", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const revoked = await repo.revokeAssignment(alpha.ctx, row.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedBy).toBe(alpha.adminId);

    expect(
      await repo.findActiveByTeacherAndCourse(
        alpha.ctx,
        teacherId,
        alpha.courseAId,
      ),
    ).toBeNull();

    // Revoke target resolution: no active episode → null (deterministic 404).
    expect(
      await repo.resolveRevokeTarget(
        alpha.ctx,
        teacherId,
        alpha.courseAId,
        false,
      ),
    ).toBeNull();

    // A new episode (same triple) is allowed after revocation.
    const reassigned = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(reassigned.status).toBe("active");
    // History is preserved: exactly two episodes now.
    const episodes = await repo.listByTeacher(alpha.ctx, teacherId);
    const forCourseA = episodes.filter((e) => e.courseId === alpha.courseAId);
    expect(forCourseA).toHaveLength(2);
  });

  it("hasActiveAssignment is true only for an active episode", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    expect(
      await repo.hasActiveAssignment(alpha.ctx, alpha.courseAId, teacherId),
    ).toBe(false);
    await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(
      await repo.hasActiveAssignment(alpha.ctx, alpha.courseAId, teacherId),
    ).toBe(true);
    expect(
      await repo.hasActiveAssignment(alpha.ctx, alpha.courseBId, teacherId),
    ).toBe(false);
  });

  it("listActiveCourseIdsByTeacher returns only the assigned active courses", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const ids = await repo.listActiveCourseIdsByTeacher(alpha.ctx, teacherId);
    expect(ids).toEqual([alpha.courseAId]);

    // Assign B, revoke A → only B remains.
    const episodeB = await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseBId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const episodeA = await repo.resolveRevokeTarget(
      alpha.ctx,
      teacherId,
      alpha.courseAId,
      false,
    );
    await repo.revokeAssignment(alpha.ctx, episodeA!.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    const after = await repo.listActiveCourseIdsByTeacher(alpha.ctx, teacherId);
    expect(after.sort()).toEqual([alpha.courseBId].sort());
    expect(episodeB.status).toBe("active");
  });

  it("tenant boundary: cross-org lookups never match", async () => {
    const teacherId = await newTeacher(alpha.organizationId);
    await repo.insertAssignment(alpha.ctx, {
      teacherUserId: teacherId,
      courseId: alpha.courseAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // The same (teacher, course) ids do not exist in beta's org.
    expect(
      await repo.findActiveByTeacherAndCourse(
        beta.ctx,
        teacherId,
        alpha.courseAId,
      ),
    ).toBeNull();
    expect(
      await repo.hasActiveAssignment(beta.ctx, alpha.courseAId, teacherId),
    ).toBe(false);
    // beta can assign its own teacher within its own org (plain users(id)
    // FK mirrors ADR-015 §15: org consistency is the command layer's job,
    // so the repo itself only fails closed on lookups).
    const row = await repo.insertAssignment(beta.ctx, {
      teacherUserId: beta.teacherId,
      courseId: beta.courseAId,
      assignedBy: beta.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(row.organizationId).toBe(beta.organizationId);
  });
});
