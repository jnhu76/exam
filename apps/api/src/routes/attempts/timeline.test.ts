import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAuditLogTestRepo } from "@exam/db/src/testHelpers/auditLogTestRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { RequestContext, Role } from "@exam/domain";
import { buildExamPayload } from "./__tests__/attempts.testHelpers.js";

const TIMELINE_TEST_PREFIX = "timeline-test-";

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

  describe("GET /api/admin/attempts/:attemptId/timeline", () => {
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
      const slug = `${TIMELINE_TEST_PREFIX}${uniquePrefix()}`;
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

      const admin = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: crypto.randomUUID(),
            organizationId: org.id,
            username: `admin-${slug}`,
            passwordHash,
            name: "TL Admin",
            role: "Admin",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const candidate = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: crypto.randomUUID(),
            organizationId: org.id,
            username: `candidate-${slug}`,
            passwordHash,
            name: "TL Candidate",
            role: "Candidate",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      // RBAC-M10-E: authenticate resolves authority from ACTIVE
      // user_role_assignments. Seed one active primary per user so the
      // matrix-of-roles-under-test authenticates and gates run as written.
      await ctx.db.insert(schema.userRoleAssignments).values([
        {
          id: crypto.randomUUID(),
          organizationId: org.id,
          userId: admin.id,
          role: "Admin" as never,
          isPrimary: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          organizationId: org.id,
          userId: candidate.id,
          role: "Candidate" as never,
          isPrimary: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);

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
            name: `TL Course ${slug}`,
            code: `TL-${slug}`,
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
          authEpoch: 0,
        },
        jwtSecret,
      );
      const candidateToken = signJWT(
        {
          actorId: candidate.id,
          role: candidate.role as Role,
          organizationId: org.id,
          authEpoch: 0,
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
      const localExamId = exam.json().id as string;
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
      return { attemptId: startRes.json().id as string };
    }

    function makeAdminCtx(t: IsolatedTestOrg): RequestContext {
      return {
        actorId: t.adminUserId,
        organizationId: t.orgId,
        role: "Admin",
        permissions: [],
        sessionId: "test",
        targetOrganizationId: t.orgId,
      };
    }

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${TIMELINE_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${TIMELINE_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("requires authentication (401 without token)", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${crypto.randomUUID()}/timeline`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("rejects Candidate role with 403", async () => {
      const t = await createIsolatedTestOrg();
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${crypto.randomUUID()}/timeline`,
        cookies: { "auth-token": t.candidateToken },
      });
      expect(response.statusCode).toBe(403);
    });

    it("returns 404 NOT_FOUND for a nonexistent attempt UUID", async () => {
      const t = await createIsolatedTestOrg();
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${crypto.randomUUID()}/timeline`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("returns events for an attempt ordered chronologically", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Timeline Ordered Exam",
      );
      await ctx.drainAuditWrites();

      const repo = createAuditLogTestRepo(ctx.db);
      const adminCtx = makeAdminCtx(t);
      // Runtime attempt.start is canonical domain state, not a compliance
      // audit. Seed three privileged audit records to verify ordering.
      const misconductEvent = await repo.create(adminCtx, {
        actorId: t.adminUserId,
        action: "attempt.misconductFlagged",
        targetType: "attempt",
        targetId: attemptId,
        metadata: { severity: "low" },
      });
      const extendEvent = await repo.create(adminCtx, {
        actorId: t.adminUserId,
        action: "attempt.extendTime",
        targetType: "attempt",
        targetId: attemptId,
        metadata: { additionalMinutes: 5 },
      });
      const forceEvent = await repo.create(adminCtx, {
        actorId: t.adminUserId,
        action: "attempt.forceSubmit",
        targetType: "attempt",
        targetId: attemptId,
        metadata: { reason: "proctor" },
      });
      const seededEvents = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const seededMisconductEvent = seededEvents.find(
        (event) => event.id === misconductEvent.id,
      );
      expect(seededMisconductEvent).toBeDefined();
      await ctx.db
        .update(schema.auditLogs)
        .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
        .where(eq(schema.auditLogs.id, seededMisconductEvent!.id));
      await ctx.db
        .update(schema.auditLogs)
        .set({ createdAt: new Date("2026-01-01T00:00:01.000Z") })
        .where(eq(schema.auditLogs.id, extendEvent.id));
      await ctx.db
        .update(schema.auditLogs)
        .set({ createdAt: new Date("2026-01-01T00:00:02.000Z") })
        .where(eq(schema.auditLogs.id, forceEvent.id));

      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/timeline`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const actions = body.events.map((e: { action: string }) => e.action);
      const misconductIdx = actions.indexOf("attempt.misconductFlagged");
      const extendIdx = actions.indexOf("attempt.extendTime");
      const forceIdx = actions.indexOf("attempt.forceSubmit");
      expect(misconductIdx).toBeGreaterThanOrEqual(0);
      expect(extendIdx).toBeGreaterThan(misconductIdx);
      expect(forceIdx).toBeGreaterThan(extendIdx);
      // Shape check on the last event.
      expect(body.events[0]).toMatchObject({
        id: expect.any(String),
        action: expect.any(String),
        targetType: "attempt",
        targetId: attemptId,
        actorId: expect.any(String),
        metadata: expect.any(Object),
        createdAt: expect.any(String),
      });
    });

    it("does not leak another organization's audit rows (org boundary)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Timeline Boundary Exam",
      );

      // A second isolated org seeds an audit row for the SAME targetId.
      const other = await createIsolatedTestOrg();
      const otherCtx: RequestContext = {
        actorId: other.adminUserId,
        organizationId: other.orgId,
        role: "Admin",
        permissions: [],
        sessionId: "test",
        targetOrganizationId: other.orgId,
      };
      await createAuditLogTestRepo(ctx.db).create(otherCtx, {
        actorId: other.adminUserId,
        action: "attempt.forceSubmit",
        targetType: "attempt",
        targetId: attemptId,
        metadata: { leaked: true },
      });

      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/timeline`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Every event must belong to t's org; the other-org row must not leak.
      expect(
        body.events.every(
          (e: { organizationId: string }) => e.organizationId === t.orgId,
        ),
      ).toBe(true);
      expect(
        body.events.some((e: { action: string }) =>
          JSON.stringify(e).includes("leaked"),
        ),
      ).toBe(false);
    });
  });
});
