import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForDisruptedAttempts } from "../../plugins/heartbeat.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import {
  buildExamPayload,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
  disruptAttempt,
} from "./__tests__/attempts.testHelpers.js";

const HEARTBEAT_SCANNER_TEST_PREFIX = "heartbeat-scanner-test-";

describe("attempt routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    const fixture = await buildSharedAttemptFixture();
    ctx = fixture.ctx;
    examId = fixture.examId;
    courseId = fixture.courseId;
    questionId = fixture.questionId;
    candidateProfileId = fixture.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("POST /attempts/:attemptId/heartbeat", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam5 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Heartbeat Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId5 = exam5.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId5}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId5);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId5}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("updates lastActivityAt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/heartbeat`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(typeof body.serverNow).toBe("string");
    });

    it("marks stale attempts as disrupted during the background scan", async () => {
      const result = await scanDatabaseForDisruptedAttempts(
        ctx.app,
        new Date(Date.now() + 61_000),
        60,
      );
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx,
        attemptId,
      );

      expect(result.markedCount).toBeGreaterThan(0);
      expect(attempt?.status).toBe("disrupted");
    }, 15_000);
  });
});

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

  describe("heartbeat scanner — scanDatabaseForDisruptedAttempts", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      candidateToken: string;
      candidateUserId: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${HEARTBEAT_SCANNER_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "HB Admin",
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
            name: "HB Candidate",
            role: "Candidate",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      // RBAC-M10-E: authenticate resolves authority from ACTIVE
      // user_role_assignments. Seed one active primary assignment per test user
      // so the admin/candidate tokens authenticate with their role's preset.
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
            name: `HB Course ${slug}`,
            code: `HB-${slug}`,
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
        candidateToken,
        candidateUserId: candidate.id,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    function makeCandidateCtx(t: IsolatedTestOrg) {
      return {
        actorId: t.candidateUserId,
        organizationId: t.orgId,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: t.orgId,
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
          durationMinutes: 1,
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

    /** Backdates lastActivityAt so the heartbeat scan sees the attempt as stale. */
    async function backdateHeartbeat(attemptId: string): Promise<void> {
      const stale = new Date(Date.now() - 120_000);
      await ctx.db
        .update(schema.examAttempts)
        .set({ lastActivityAt: stale, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
    }

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${HEARTBEAT_SCANNER_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${HEARTBEAT_SCANNER_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("uses canonical attempt state without an attempt.disrupted compliance audit", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Heartbeat Disrupted Audit Exam",
      );
      await backdateHeartbeat(attemptId);

      await scanDatabaseForDisruptedAttempts(ctx.app, new Date(), 60);

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const disruptedRows = auditRows.filter(
        (r) => r.action === "attempt.disrupted",
      );
      expect(disruptedRows).toHaveLength(0);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("disrupted");
    });

    it("does NOT write a phantom attempt.disrupted audit when the row is already disrupted at lock time (race no-op)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Heartbeat Disrupted Race Exam",
      );
      await backdateHeartbeat(attemptId);
      await disruptAttempt(ctx.db, t.orgId, attemptId);

      await scanDatabaseForDisruptedAttempts(ctx.app, new Date(), 60);

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const disruptedRows = auditRows.filter(
        (r) => r.action === "attempt.disrupted",
      );
      expect(disruptedRows).toHaveLength(0);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("disrupted");
    });

    it("leaves a still-stale in_progress attempt for the next scan when this scan finds nothing to disrupt", async () => {
      // Establishes the retry invariant: a stale in_progress attempt that is
      // NOT picked up this cycle stays in_progress and stale, so the next scan
      // catches it. (Directly injecting a transient markDisrupted failure would
      // require monkeypatching internals; the observable contract is that the
      // attempt remains retryable until a scan actually disrupts it.)
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Heartbeat Disrupted Retry Exam",
      );
      await backdateHeartbeat(attemptId);

      // A scan with an out-of-reach timeout (attempt is NOT stale relative to it)
      // behaves like a no-op cycle: nothing disrupted, attempt stays retryable.
      const first = await scanDatabaseForDisruptedAttempts(
        ctx.app,
        new Date(),
        999,
      );
      expect(first.markedCount).toBe(0);

      let attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");

      // Next scan with the real timeout disrupts it (retried successfully).
      const second = await scanDatabaseForDisruptedAttempts(
        ctx.app,
        new Date(),
        60,
      );
      expect(second.markedCount).toBeGreaterThanOrEqual(1);

      attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("disrupted");

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const disruptedRows = auditRows.filter(
        (r) => r.action === "attempt.disrupted",
      );
      expect(disruptedRows).toHaveLength(0);
    });
  });
});
