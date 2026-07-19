/**
 * RBAC-M10-E — assignment-backed runtime authority: ADVERSARIAL INTEGRATION
 * MATRIX (spec §12 E1–E16, real HTTP routes).
 *
 * These tests prove the runtime flip end-to-end against real Fastify routes:
 *
 *   - `users.role` is NO LONGER authoritative (E1, E2).
 *   - the JWT `role` claim is NO LONGER authoritative (E3, E4).
 *   - grant / revoke take effect on the NEXT authenticated request, with no
 *     re-login (E8, E9).
 *   - an INACTIVE assignment does NOT widen access even if it would grant
 *     more than the active set (E7, HTTP layer).
 *   - no active assignments → 401 on the next request (E10, HTTP layer).
 *   - the System actor still bypasses the human-assignment table (E15).
 *   - scoped resource resolvers still deny when the capability union allows
 *     but the resource/ownership check does not (E16).
 *
 * Pure-kernel coverage of E5 (multi-role union), E6 (primary does not constrain
 * union), E11 (cross-org ignored), E12 (multiple primary), E13 (zero primary),
 * E14 (DB failure) lives in `assignmentAuthority.test.ts`. This file extends
 * E1–E4 / E7–E10 / E15–E16 to the HTTP layer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import examRoutes from "../routes/exam.js";
import courseRoutes from "../routes/course.js";
import systemRoutes from "../routes/system.js";
import {
  buildTestApp,
  uniquePrefix,
  createAssignedUserForTest,
} from "../routes/testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import { buildExamPayload } from "../routes/attempts/attempts.testHelpers.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(examRoutes);
  await fastify.register(systemRoutes);
};

/**
 * Inserts an assignment row directly via the DB (bypassing the repo) so the
 * test can construct adversarial states (a secondary the API wouldn't add,
 * an inactive primary the API wouldn't create, etc.).
 */
async function insertAssignmentDirectly(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
  args: {
    organizationId: string;
    userId: string;
    role: "Admin" | "Teacher" | "Proctor" | "Grader" | "Candidate";
    isPrimary: boolean;
    isActive: boolean;
  },
) {
  const now = new Date();
  await db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: args.organizationId,
    userId: args.userId,
    role: args.role as never,
    isPrimary: args.isPrimary,
    isActive: args.isActive,
    createdAt: now,
    updatedAt: now,
  });
}

/** Creates a course via the API; returns the new course id. */
async function createCourse(
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  token: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/courses",
    cookies: { "auth-token": token },
    payload: {
      name,
      code: `${name.toLowerCase().replace(/\s+/g, "-")}-${uniquePrefix()}`,
      description: "",
    },
  });
  expect(res.statusCode, `createCourse ${name}: ${res.body}`).toBe(201);
  return res.json().id;
}

describe("RBAC-M10-E — assignment-backed runtime authority (E1–E16 HTTP)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── E1 — users.role=Admin but primary assignment=Candidate ──────────────
  // The runtime MUST follow the assignment, NOT users.role.
  it("E1: users.role=Admin but primary assignment=Candidate → Admin route denied", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e1-cache-admin",
    );
    // Flip users.role to Admin (the stale cache); primary assignment stays
    // Candidate (the authority). Runtime must follow the assignment.
    await ctx.db
      .update(schema.users)
      .set({ role: "Admin" as never, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    // ExamCreate is Admin-gated (not in Candidate's preset).
    const courseId = await createCourse(
      ctx.app,
      ctx.adminToken,
      "E1 Course Anchor",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": token },
      payload: buildExamPayload({
        title: "E1 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });

  // ── E2 — users.role=Candidate but primary assignment=Admin ──────────────
  // The runtime MUST grant Admin authority from the assignment, NOT deny
  // based on users.role=Candidate.
  it("E2: users.role=Candidate but primary assignment=Admin → Admin route allowed", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "e2-cache-candidate",
    );
    await ctx.db
      .update(schema.users)
      .set({ role: "Candidate" as never, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    const courseId = await createCourse(ctx.app, token, "E2 Course");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": token },
      payload: buildExamPayload({
        title: "E2 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  // ── E3 — stale JWT role=Admin, assignment=Candidate ─────────────────────
  it("E3: JWT role=Admin but active assignment=Candidate → Admin route denied", async () => {
    const { user, token: candidateToken } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e3-jwt-admin",
    );
    // Re-sign with role: "Admin" for the same actor. authenticate verifies
    // the JWT then re-resolves authority from assignments; the Admin claim
    // must NOT widen access.
    const staleAdminToken = signJWT(
      {
        actorId: user.id,
        role: "Admin",
        organizationId: user.organizationId,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );
    // Sanity: the two tokens differ (the new one carries role=Admin).
    expect(staleAdminToken).not.toBe(candidateToken);

    const courseId = await createCourse(
      ctx.app,
      ctx.adminToken,
      "E3 Course Anchor",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": staleAdminToken },
      payload: buildExamPayload({
        title: "E3 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── E4 — stale JWT role=Candidate, assignment=Admin ─────────────────────
  it("E4: JWT role=Candidate but active assignment=Admin → Admin route allowed", async () => {
    const { user, token: adminToken } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "e4-jwt-candidate",
    );
    // Re-sign with role: "Candidate" for the same Admin actor.
    const staleCandidateToken = signJWT(
      {
        actorId: user.id,
        role: "Candidate",
        organizationId: user.organizationId,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );
    expect(staleCandidateToken).not.toBe(adminToken);

    // Create a course via the stale-Candidate JWT: runtime follows the
    // Admin assignment, so the route is allowed.
    const courseId = await createCourse(
      ctx.app,
      staleCandidateToken,
      "E4 Course",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": staleCandidateToken },
      payload: buildExamPayload({
        title: "E4 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  // ── E8 — grant takes effect on the NEXT request, no re-login ────────────
  it("E8: adding an active assignment grants its capability on the next request (no re-login)", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e8-before-grant",
    );
    // Candidate lacks CourseCreate. Confirm denied.
    const before = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      cookies: { "auth-token": token },
      payload: {
        name: "E8 Before",
        code: `e8before-${uniquePrefix()}`,
        description: "",
      },
    });
    expect(before.statusCode).toBe(403);

    // Grant a SECONDARY Teacher assignment directly via DB. Teacher preset
    // includes CourseCreate. No re-login — same JWT.
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Teacher",
      isPrimary: false,
      isActive: true,
    });

    const after = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      cookies: { "auth-token": token },
      payload: {
        name: "E8 After",
        code: `e8after-${uniquePrefix()}`,
        description: "",
      },
    });
    expect(after.statusCode, after.body).toBe(201);
  });

  // ── E9 — revoke takes effect on the NEXT request, no re-login ───────────
  it("E9: deactivating an assignment revokes its capability on the next request (no re-login)", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e9-before-revoke",
    );
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Teacher",
      isPrimary: false,
      isActive: true,
    });
    // Confirm Teacher's CourseCreate is granted.
    const before = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      cookies: { "auth-token": token },
      payload: {
        name: "E9 Before",
        code: `e9before-${uniquePrefix()}`,
        description: "",
      },
    });
    expect(before.statusCode, before.body).toBe(201);

    // Deactivate ONLY the Teacher assignment; primary Candidate stays.
    const rows = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, user.id));
    const teacher = rows.find((r) => r.role === "Teacher" && r.isActive);
    expect(teacher).toBeDefined();
    await ctx.db
      .update(schema.userRoleAssignments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.userRoleAssignments.id, teacher!.id));

    // Same JWT — runtime re-resolves authority from the now-smaller active
    // set; CourseCreate is gone.
    const after = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      cookies: { "auth-token": token },
      payload: {
        name: "E9 After",
        code: `e9after-${uniquePrefix()}`,
        description: "",
      },
    });
    expect(after.statusCode).toBe(403);
  });

  // ── E7 (HTTP layer) — inactive Admin assignment does NOT widen access ───
  it("E7: an INACTIVE secondary Admin assignment does not grant Admin capabilities", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e7-inactive-admin",
    );
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Admin",
      isPrimary: false,
      isActive: false,
    });
    const courseId = await createCourse(ctx.app, ctx.adminToken, "E7 Anchor");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": token },
      payload: buildExamPayload({
        title: "E7 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── E10 (HTTP layer) — every assignment deactivated → 401 ───────────────
  it("E10: with every assignment deactivated, an existing JWT gets 401 AUTH_REQUIRED", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate" as never,
      "e10-all-inactive",
    );
    await ctx.db
      .update(schema.userRoleAssignments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.userRoleAssignments.userId, user.id));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_REQUIRED");
  });

  // ── E15 — System actor path does NOT consult user_role_assignments ─────
  it("E15: createSystemRequestContext does not require a user_role_assignments row", async () => {
    const c = createSystemRequestContext(
      ctx.org.id,
      SYSTEM_ACTOR_IDS.DeadlineScanner,
    );
    expect(c.actorId).toBe(SYSTEM_ACTOR_IDS.DeadlineScanner);
    expect(c.role).toBe("System");
    // No user_role_assignments row exists for "system:*" by design.
    const system = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, c.actorId));
    expect(system).toEqual([]);
  });

  // ── E16 — scoped resource resolver is NOT bypassed by capability union ─
  it("E16: capability-allowed but resource-not-owned → still denied (scoped resolver preserved)", async () => {
    // Admin's preset includes ExamView, so the capability gate passes. The
    // scoped resolver then runs the resource lookup; with no row it returns
    // 404 RESOURCE_NOT_FOUND — proving the resolver was reached and not
    // short-circuited by the capability union.
    const { token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "e16-resolver-preserved",
    );
    const fakeId = crypto.randomUUID();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${fakeId}`,
      cookies: { "auth-token": token },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  // Positive control for E16 (NOT a mutation, per spec §16): an existing
  // exam is reachable when Admin has ExamView. Proves the 404 above is a
  // resolver decision, not a capability decision.
  it("E16 positive control: Admin CAN view an existing exam (ExamView preset)", async () => {
    const { token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "e16-positive",
    );
    const courseId = await createCourse(ctx.app, token, "E16 PC Course");
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": token },
      payload: buildExamPayload({
        title: "E16 PC Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    const examId = examRes.json().id;

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": token },
    });
    expect(getRes.statusCode).toBe(200);
  });
});
