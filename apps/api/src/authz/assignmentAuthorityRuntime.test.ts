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
import candidateRoutes from "../routes/candidate.js";
import questionRoutes from "../routes/question.js";
import scoreRoutes from "../routes/scores.js";
import systemRoutes from "../routes/system.js";
import { registerCandidateAttemptRoutes } from "../routes/attempts.candidate.js";
import {
  buildTestApp,
  uniquePrefix,
  createAssignedUserForTest,
  createCandidateViaApi,
  submitExamAsCandidate,
} from "../routes/testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import { buildExamPayload } from "../routes/attempts/attempts.testHelpers.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(examRoutes);
  await fastify.register(candidateRoutes);
  // E19 needs a publishable exam, which requires >=1 question; the question
  // routes are registered so E19 can create one via the API.
  await fastify.register(questionRoutes);
  await fastify.register(async (scope) => {
    registerCandidateAttemptRoutes(scope);
  });
  await fastify.register(scoreRoutes);
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
    role: args.role,
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
      "Candidate",
      "e1-cache-admin",
    );
    // Flip users.role to Admin (the stale cache); primary assignment stays
    // Candidate (the authority). Runtime must follow the assignment.
    await ctx.db
      .update(schema.users)
      .set({ role: "Admin", updatedAt: new Date() })
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
      .set({ role: "Candidate", updatedAt: new Date() })
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
      "Candidate",
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
      "Candidate",
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
      "Candidate",
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
      "Candidate",
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
      "Candidate",
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

  // ── E12 (DB-resolver layer) — multiple active primaries fail-closed ────
  // Spec §12 E12: "directly DB-insert multiple active primary assignments
  //               bypassing the repo → request fails closed."
  //
  // Two layers protect this invariant:
  //   1. DB partial unique index `user_role_assignments_active_primary_unique`
  //      (migration 0015 step 5) — the production backstop. A direct
  //      insert of a SECOND active primary is rejected with a 23505
  //      unique-violation, so the corrupt state can never exist in prod.
  //   2. Runtime resolver `deriveAssignmentAuthority` (assignmentAuthority.ts)
  //      — returns `multiple_primary` and the caller fail-closes.
  //
  // This test proves layer 1: a direct DB insert of a second active primary
  // is REJECTED by the partial unique index (Drizzle wraps the underlying
  // PostgresError under `.cause`, so we walk the chain). The pure-kernel E12
  // test (assignmentAuthority.test.ts "fails closed on multiple active
  // primaries") proves layer 2 in isolation with hand-built rows.
  //
  // The combination kills spec §16 Mutation I (`.limit(1)` on
  // listActiveForUser): even if the repo query masked corruption, the index
  // prevents the corrupt rows from existing in the first place.
  it("E12: DB rejects a second active primary via the partial unique index (23505)", async () => {
    const { user } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      "e12-index-backstop",
    );
    // createAssignedUserForTest already seeded one active primary. Attempt a
    // SECOND active primary directly via DB; the partial unique index must
    // reject it.
    let pgCode: string | undefined;
    try {
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId: user.id,
        role: "Admin",
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      // Drizzle wraps the underlying PostgresError multiple levels deep.
      let cursor: unknown = err;
      const visited = new Set<unknown>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const c = (cursor as { code?: unknown }).code;
        if (typeof c === "string") {
          pgCode = c;
          break;
        }
        cursor = (cursor as { cause?: unknown }).cause;
      }
    }
    // 23505 = unique_violation; the partial unique index fired.
    expect(pgCode).toBe("23505");
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

  // ── E17 — scoped gate with multi-role: primary Candidate + secondary
  // Admin. The scoped gate consults the capability union (not the primary
  // role). This kills spec §16 Mutation E: a role-based predicate would
  // see "Candidate" (not in ADMINISH_ROLES) and deny, but the union
  // includes Admin's ExamView.
  it("E17: scoped gate allows when primary role lacks the permission but secondary role grants it", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      "e17-scoped-multi-role",
    );
    // Grant a secondary Admin assignment. Admin's preset includes ExamView
    // (gated by requireScopedCapability). Primary Candidate alone lacks it.
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Admin",
      isPrimary: false,
      isActive: true,
    });

    // Resource setup MUST use ctx.adminToken, NOT the multi-role token. The
    // eventual scoped-gate exercise is GET /api/exams/:id; everything before
    // it (course create, exam create) runs through the FLAT requireCapability
    // decorator on different permissions (ExamCreate). If the multi-role token
    // were used for setup, a Mutation E applied only at the scoped wiring
    // (presetAllows in plugins/authz.ts) would NOT kill E17 — the flat
    // ExamCreate check would still pass (Admin is in the union) and the test
    // would only fail (or pass) for the wrong reason. By using adminToken for
    // setup, the multi-role token is exercised ONLY at the scoped GET, so a
    // scoped-wiring mutation is observable in isolation.
    const courseId = await createCourse(ctx.app, ctx.adminToken, "E17 Course");
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
      payload: buildExamPayload({
        title: "E17 Exam",
        courseId,
        questionIds: [],
        durationMinutes: 60,
      }),
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    const examId = examRes.json().id;

    // GET /api/exams/:id is gated by requireScopedCapability(ExamView).
    // The union includes ExamView (from Admin), so 200 is expected. The
    // multi-role token is exercised ONLY here — the scoped gate is the
    // sole authority site this assertion reaches.
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": token },
    });
    expect(getRes.statusCode).toBe(200);
  });

  // ── E18 — candidate-context gate with multi-role: primary Teacher +
  // secondary Candidate. The candidate-context gate consults the capability
  // union (ExamTake), NOT the primary role name. This kills spec §16
  // Mutation F: a role-based predicate (ctx.role === "Candidate") would
  // see "Teacher" and deny, but the union includes ExamTake from the
  // secondary Candidate assignment.
  it("E18: candidate-context gate allows when primary role is not Candidate but secondary assignment grants Candidate permissions", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "e18-cc-multi-role",
    );
    // Grant a secondary Candidate assignment. Candidate's preset includes
    // ExamTake (gated by requireCandidateContext). Primary Teacher alone
    // lacks it — but the union now includes it.
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Candidate",
      isPrimary: false,
      isActive: true,
    });

    // GET /api/candidate/exams is gated by requireCandidateContext(ExamTake).
    // The union includes ExamTake (from Candidate), so 200 is expected
    // (empty list — no candidate profile or enrollments). Under Mutation F
    // the gate would check ctx.role === "Candidate" → false → 403.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": token },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── E19 — score gate with multi-role: primary Candidate + secondary
  // Teacher. The score gate consults the capability union for ScoreAllView,
  // NOT the primary role's preset. This kills spec §16 Mutation G: a
  // primary-role preset would yield only ScoreOwnView (Candidate's preset),
  // but the union includes ScoreAllView from the Teacher assignment.
  //
  // Role choice note: Teacher is the secondary role because Teacher is the
  // non-Admin assignable role whose preset includes ScoreAllView; Grader's
  // preset only carries Grading* permissions and does NOT include
  // ScoreAllView, so Grader cannot serve as the ScoreAllView-granting
  // secondary.
  it("E19: score gate grants ScoreAllView when primary role lacks it but secondary role grants it", async () => {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      "e19-score-multi-role",
    );
    // Grant a secondary Teacher assignment. Teacher's preset includes
    // ScoreAllView. The union now includes ScoreAllView (Teacher) +
    // ScoreOwnView / ExamTake (Candidate).
    await insertAssignmentDirectly(ctx.db, {
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Teacher",
      isPrimary: false,
      isActive: true,
    });

    // Create a course + a publishable question + exam via the admin token.
    // Publish requires >=1 question, and submitExamAsCandidate needs a real
    // question to answer, so a question must exist before publish.
    const courseId = await createCourse(ctx.app, ctx.adminToken, "E19 Course");
    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "E19 question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(qRes.statusCode, qRes.body).toBe(201);
    const questionId = qRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
      payload: buildExamPayload({
        title: "E19 Exam",
        courseId,
        questionIds: [questionId],
        durationMinutes: 60,
      }),
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    const examId = examRes.json().id;

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode, publishRes.body).toBe(200);

    // Submit the exam as a SEPARATE candidate so the scores route has a real
    // attempt to resolve.
    await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examId,
      `e19-${uniquePrefix()}`,
    );

    // GET /exams/:id/scores additionally requires the exam to have ended
    // (canOpenScoreList: status closed/archived OR now >= closeAt). Move
    // closeAt into the past so the "examEnded" branch is satisfied without
    // a real-time wait. (startAttempt already happened inside
    // submitExamAsCandidate while the window was still open.)
    await ctx.db
      .update(schema.exams)
      .set({ closeAt: new Date(Date.now() - 1000) })
      .where(eq(schema.exams.id, examId));

    // GET /api/exams/:examId/scores is gated by
    // requireCapability(Permission.ScoreAllView). The union includes
    // ScoreAllView (from Teacher), so the gate grants access and the handler
    // returns the submitted score.
    // Under Mutation G, permissionsForRole("Candidate") would only yield
    // ScoreOwnView, and the gate would deny — but the multi-role user is not
    // the owner of the attempt created by submitExamAsCandidate (which
    // creates a SEPARATE candidate), so ScoreOwnView would also deny. Only
    // the cap-union path (ScoreAllView from Teacher) grants access.
    const scoreRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores`,
      cookies: { "auth-token": token },
    });
    expect(scoreRes.statusCode, scoreRes.body).toBe(200);
  });
});
