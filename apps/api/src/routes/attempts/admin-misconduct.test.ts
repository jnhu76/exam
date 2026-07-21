import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const MISCONDUCT_FLAG_TEST_PREFIX = "misconduct-flag-test-";

describe("attempt routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("POST /api/admin/attempts/:attemptId/misconduct", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      adminUserId: string;
      candidateToken: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${MISCONDUCT_FLAG_TEST_PREFIX}${uniquePrefix()}`;
      const now = new Date();

      const org = (
        await ctx.db
          .insert(schema.organizations)
          .values({
            id: crypto.randomUUID(),
            name: slug,
            displayName: slug,
            slug,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const passwordHash = await hashPassword("password123");

      const adminId = crypto.randomUUID();
      const admin = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: adminId,
            organizationId: org.id,
            username: `admin-${slug}`,
            passwordHash,
            name: "MF Admin",
            role: "Admin",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: adminId,
        role: "Admin",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const candidateId = crypto.randomUUID();
      const candidate = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: candidateId,
            organizationId: org.id,
            username: `candidate-${slug}`,
            passwordHash,
            name: "MF Candidate",
            role: "Candidate",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: candidateId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const profile = (
        await ctx.db
          .insert(schema.candidateProfiles)
          .values({
            id: crypto.randomUUID(),
            organizationId: org.id,
            userId: candidate.id,
            fields: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const course = (
        await ctx.db
          .insert(schema.courses)
          .values({
            id: crypto.randomUUID(),
            organizationId: org.id,
            name: `MF Course ${slug}`,
            code: `MF-${slug}`,
            description: "",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const question = (
        await ctx.db
          .insert(schema.questions)
          .values({
            id: crypto.randomUUID(),
            organizationId: org.id,
            courseId: course.id,
            type: "single_choice",
            content: "What is 1+1?",
            options: [
              { id: "a", content: "1" },
              { id: "b", content: "2" },
              { id: "c", content: "3" },
            ],
            standardAnswer: "b",
            attachments: [],
            score: 100,
            difficulty: 1,
            tags: [],
            gradingRule: {
              multiSelectScoring: "all_correct_full",
              fillBlankMatchMode: "exact",
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const { jwtSecret } = getRuntimeConfig().authSecret;
      const adminToken = signJWT(
        {
          actorId: admin.id,
          role: admin.role as Role,
          organizationId: org.id,
        },
        jwtSecret,
      );
      const candidateToken = signJWT(
        {
          actorId: candidate.id,
          role: candidate.role as Role,
          organizationId: org.id,
        },
        jwtSecret,
      );

      return {
        orgId: org.id,
        adminToken,
        adminUserId: admin.id,
        candidateToken,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    async function createStartedAttempt(
      t: IsolatedTestOrg,
      examTitle: string,
    ): Promise<{ attemptId: string }> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: examTitle,
          courseId: t.courseId,
          questionIds: [t.questionId],
          durationMinutes: 60,
        }),
        cookies: { "auth-token": t.adminToken },
      });
      const localExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${localExamId}/publish`,
        cookies: { "auth-token": t.adminToken },
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${localExamId}/enrollments`,
        payload: { candidateIds: [t.candidateProfileId] },
        cookies: { "auth-token": t.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${localExamId}/start`,
        cookies: { "auth-token": t.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      return { attemptId };
    }

    function makeAdminCtx(t: IsolatedTestOrg) {
      return {
        actorId: t.adminUserId,
        organizationId: t.orgId,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: t.orgId,
      };
    }

    beforeEach(async () => {
      await ctx.drainAuditWrites();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${MISCONDUCT_FLAG_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWrites();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${MISCONDUCT_FLAG_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("flags misconduct on an in_progress attempt, persists the flag, and audits the action (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Flag Exam",
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: { severity: "serious", notes: "candidate looked at notes" },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.misconduct).toMatchObject({
        severity: "serious",
        notes: "candidate looked at notes",
        flaggedBy: t.adminUserId,
      });
      expect(attempt?.misconduct?.flaggedAt).toBeDefined();
      // Flag does not change status.
      expect(attempt?.status).toBe("in_progress");

      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const flagRows = auditRows.filter(
        (r) => r.action === "attempt.misconductFlagged",
      );
      expect(flagRows).toHaveLength(1);
      expect(flagRows[0]!.actorId).toBe(t.adminUserId);
      expect(flagRows[0]!.metadata).toMatchObject({
        severity: "serious",
        notes: "candidate looked at notes",
      });
    });

    it("allows flagging a voided attempt (any state per P2C-J4 §16, 200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Flag Voided Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: { severity: "warning", notes: "x" },
        cookies: { "auth-token": t.adminToken },
      });

      // §16: "Allowed states: any attempt status" — voided is flaggable.
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 for a non-existent attempt", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${crypto.randomUUID()}/misconduct`,
        payload: { severity: "warning", notes: "x" },
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("rejects a non-admin (candidate) with 403", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Flag Forbidden Exam",
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: { severity: "warning", notes: "x" },
        cookies: { "auth-token": t.candidateToken },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });
  });
});
