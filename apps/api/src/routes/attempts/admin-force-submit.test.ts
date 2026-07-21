import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { materializeGradingWorkset } from "@exam/exam-engine";
import { createGradingWorksetRepoAdapter } from "../../adapters/repoAdapters.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const FORCE_SUBMIT_TEST_PREFIX = "force-submit-test-";

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

  describe("POST /api/admin/attempts/:attemptId/force-submit", () => {
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
      const slug = `${FORCE_SUBMIT_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "FS Admin",
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
            name: "FS Candidate",
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
            name: `FS Course ${slug}`,
            code: `FS-${slug}`,
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
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${FORCE_SUBMIT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${FORCE_SUBMIT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("force-submits an in_progress attempt, grades it, and audits the admin action (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit InProgress Exam",
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: { reason: "candidate abandoned exam" },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("graded");
      expect(body.id).toBe(attemptId);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();

      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const forceSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.forceSubmit",
      );
      expect(forceSubmitRows).toHaveLength(1);
      expect(forceSubmitRows[0]!.actorId).toBe(t.adminUserId);
      expect(forceSubmitRows[0]!.targetType).toBe("attempt");
      expect(forceSubmitRows[0]!.metadata).toMatchObject({
        reason: "candidate abandoned exam",
      });
    });

    it("force-submits a disrupted attempt and grades it (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Disrupted Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "disrupted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.gradedAt).toBeDefined();
    });

    it("is idempotent for an already-graded attempt (200, no re-grade, no duplicate audit)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Idempotent Exam",
      );
      // First force-submit grades it.
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });
      const first = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const firstGradedAt = first?.gradedAt;

      // Second force-submit: idempotent.
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());

      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      // Only the first (state-changing) force-submit emits an audit row; the
      // idempotent second call is a no-op and must NOT duplicate the audit.
      const forceSubmitCount = auditRows.filter(
        (r) => r.action === "attempt.forceSubmit",
      ).length;
      expect(forceSubmitCount).toBe(1);
    });

    it("recovers a submitted-but-not-graded attempt to graded in one tx (no submitted-only state)", async () => {
      // Crash-recovery contract (single-tx submit+grade): an attempt left
      // `submitted` by a crashed earlier operation is recovered to `graded`
      // by a force-submit, with no audit row (no state *transition* off the
      // in_progress/disrupted baseline — only grading completes).
      //
      // Slice 4: the submit freeze barrier materializes grading workset
      // entries atomically with the status flip, so a real crashed-after-submit
      // row ALWAYS carries its workset. Simulate that faithfully: raw-flip the
      // row to `submitted`, then materialize the workset via the same production
      // helper the crashed submit would have used.
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Recovery Submitted Exam",
      );
      // Faithfully simulate a crashed-after-submit row: the status flip AND the
      // frozen submittedAnswers snapshot are both persisted by the submit freeze
      // barrier, so a real crashed-after-submit attempt carries both. (Slice 4
      // also requires the materialized workset, which we seed below.)
      const frozenAttemptForAnswers = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          submittedAnswers: {
            schemaVersion: 1,
            answers: frozenAttemptForAnswers!.answers.map((a) => ({
              questionId: a.questionId,
              value: a.answer,
            })),
          },
          gradingStatus: "auto_graded",
        })
        .where(eq(schema.examAttempts.id, attemptId));

      const adminCtx = makeAdminCtx(t);
      const frozenAttempt = await createAttemptRepo(ctx.db).findById(
        adminCtx,
        attemptId,
      );
      await materializeGradingWorkset(
        frozenAttempt! as never,
        createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(ctx.db),
          adminCtx,
        ),
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("graded");
      expect(after?.gradedAt).not.toBeNull();

      // No real submit transition occurred (the row was already submitted), so
      // no forceSubmit audit row is emitted.
      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const forceSubmitCount = auditRows.filter(
        (r) => r.action === "attempt.forceSubmit",
      ).length;
      expect(forceSubmitCount).toBe(0);
    });

    it("is idempotent for a grading attempt (200, no re-grade)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Idempotent Grading Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "grading" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("grading");
    });
    it("rejects a voided attempt with 409 INVALID_STATE", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Voided Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(409);
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
    });

    it("returns 404 for a non-existent attempt", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${crypto.randomUUID()}/force-submit`,
        payload: {},
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
