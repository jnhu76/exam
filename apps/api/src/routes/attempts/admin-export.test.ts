import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
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
import { buildExamPayload } from "./__tests__/attempts.testHelpers.js";

const EXPORT_TEST_PREFIX = "export-test-";

async function installAttemptExportAuditFailure(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_attempt_export_audit_${suffix}`;
  const triggerName = `fail_attempt_export_audit_trigger_${suffix}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected attempt export audit failure';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = 'attempt.exported')
      EXECUTE FUNCTION ${functionName}()
    `),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

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

  describe("GET /api/admin/attempts/:attemptId/export", () => {
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
      const slug = `${EXPORT_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "Export Admin",
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
            name: "Export Candidate",
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
            name: `Export Course ${slug}`,
            code: `EX-${slug}`,
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

    it("exports attempt detail as JSON (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Export JSON Exam");

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attemptId).toBe(attemptId);
      expect(body.examId).toBeDefined();
      expect(body.attemptNo).toBe(1);
      expect(body.status).toBe("in_progress");
      expect(body.questionResults).toHaveLength(1);
      expect(body.questionResults[0]!.order).toBe(0);
      expect(body.questionResults[0]!.type).toBe("single_choice");
      expect(body.questionResults[0]!.content).toBe("What is 1+1?");
    });

    it("exports attempt detail as CSV (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Export CSV Exam");

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export/csv`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      const body = res.body;
      expect(body).toContain("题号");
      expect(body).toContain("题型");
      expect(body).toContain("题目内容");
      expect(body).toContain("考生答案");
      expect(body).toContain("标准答案");
      expect(body).toContain("得分");
      expect(body).toContain("满分");
      expect(body).toContain("是否正确");
      expect(body).toContain("single_choice");
      expect(body).toContain("What is 1+1?");
    });

    it("returns 404 for non-existent attempt (JSON and CSV)", async () => {
      const t = await createIsolatedTestOrg();
      const missingId = crypto.randomUUID();
      const jsonRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${missingId}/export`,
        cookies: { "auth-token": t.adminToken },
      });
      const csvRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${missingId}/export/csv`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(jsonRes.statusCode).toBe(404);
      expect(csvRes.statusCode).toBe(404);
    });

    it("returns 403 for Candidate role (JSON and CSV)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Export Forbidden Exam",
      );

      const jsonRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export`,
        cookies: { "auth-token": t.candidateToken },
      });
      const csvRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export/csv`,
        cookies: { "auth-token": t.candidateToken },
      });

      expect(jsonRes.statusCode).toBe(403);
      expect(csvRes.statusCode).toBe(403);
    });

    it("returns 400 for malformed UUID", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/attempts/not-a-uuid/export",
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(400);
    });

    it("records audit log on export", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Export Audit Exam");

      await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export`,
        cookies: { "auth-token": t.adminToken },
      });

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const exportRows = auditRows.filter(
        (r: { action: string }) => r.action === "attempt.exported",
      );
      expect(exportRows).toHaveLength(1);
      expect(exportRows[0]!.actorId).toBe(t.adminUserId);
      expect(exportRows[0]!.targetType).toBe("attempt");
    });

    it("does not return sensitive export data before its audit insert succeeds", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Export Ordering Exam",
      );
      const removeFailure = await installAttemptExportAuditFailure(ctx.db);
      try {
        const response = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain("What is 1+1?");
        const rows = await ctx.db
          .select({ id: schema.auditLogs.id })
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, attemptId));
        expect(rows).toHaveLength(0);
      } finally {
        await removeFailure();
      }
    });

    it("exports graded attempt with question results", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Export Graded Exam");

      // Save correct answer ("b") before force-submitting.
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${t.questionId}`,
        payload: {
          attemptId,
          questionId: t.questionId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": t.candidateToken },
      });

      // Force-submit to trigger grading (operation-aware).
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: {
          operationId: crypto.randomUUID(),
          reason: "export fixture force-submit",
        },
        cookies: { "auth-token": t.adminToken },
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/export`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("graded");
      expect(body.score).toBeDefined();
      expect(body.passed).toBeDefined();
      expect(body.questionResults).toHaveLength(1);
      expect(body.questionResults[0]!.score).toBeGreaterThanOrEqual(0);
      expect(body.questionResults[0]!.maxScore).toBeGreaterThan(0);
      expect(body.questionResults[0]!.correct).toBe(true);
    });
    describe("answer-source authority (EXSEM-007/008/009: F8)", () => {
      /** Saves one candidate answer on the started attempt. */
      async function saveAnswer(
        t: IsolatedTestOrg,
        attemptId: string,
        answer: string,
      ) {
        const res = await ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${attemptId}/answers/${t.questionId}`,
          payload: {
            attemptId,
            questionId: t.questionId,
            answer,
            clientSeq: 1,
            clientSavedAt: new Date().toISOString(),
            baseVersion: 0,
          },
          cookies: { "auth-token": t.candidateToken },
        });
        expect(res.statusCode).toBe(200);
      }

      /** Force-submits (auto-grades) the attempt via the admin operation. */
      async function forceSubmit(t: IsolatedTestOrg, attemptId: string) {
        const res = await ctx.app.inject({
          method: "POST",
          url: `/api/admin/attempts/${attemptId}/force-submit`,
          payload: {
            operationId: crypto.randomUUID(),
            reason: "export authority fixture",
          },
          cookies: { "auth-token": t.adminToken },
        });
        expect(res.statusCode).toBe(200);
      }

      /** Rewrites the mutable draft `answers` column for one question. */
      async function tamperDraftAnswer(
        attemptId: string,
        questionId: string,
        answer: string,
      ) {
        const rows = await ctx.db
          .select({ answers: schema.examAttempts.answers })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, attemptId));
        const answers = rows[0]!.answers as {
          questionId: string;
          answer: unknown;
          version: number;
          savedAt: Date;
        }[];
        const next = answers.map((a) =>
          a.questionId === questionId ? { ...a, answer } : a,
        );
        await ctx.db
          .update(schema.examAttempts)
          .set({ answers: next, updatedAt: new Date() })
          .where(eq(schema.examAttempts.id, attemptId));
      }

      it("exports the frozen submitted value after submission when draft differs", async () => {
        const t = await createIsolatedTestOrg();
        const { attemptId } = await createStartedAttempt(
          t,
          "Export Submitted Authority Exam",
        );
        await saveAnswer(t, attemptId, "b");
        await forceSubmit(t, attemptId);
        // Competing representations deliberately differ (§6 methodology): the
        // draft column is rewritten AFTER the freeze so the test proves which
        // authority the export reads.
        await tamperDraftAnswer(attemptId, t.questionId, "a");

        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe("graded");
        expect(res.json().questionResults[0]!.candidateAnswer).toBe("b");
      });

      it("exports the frozen submitted value in CSV after submission", async () => {
        const t = await createIsolatedTestOrg();
        const { attemptId } = await createStartedAttempt(
          t,
          "Export Submitted Authority CSV Exam",
        );
        await saveAnswer(t, attemptId, "b");
        await forceSubmit(t, attemptId);
        await tamperDraftAnswer(attemptId, t.questionId, "a");

        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export/csv`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(res.statusCode).toBe(200);
        // Fixture fields are comma-free, so the data row splits cleanly. The
        // first eight columns are the frozen positional contract (题号,题型,
        // 题目内容,考生答案,标准答案,得分,满分,是否正确); D4 appended 考生答案模式
        // and 考生答案状态 after them, so index 3 still holds the answer.
        const dataRow = res.body.trimEnd().split("\n")[1]!.split(",");
        expect(dataRow[3]).toBe("b");
      });

      it("exports draft answers for an in-progress attempt (pre-submit source)", async () => {
        const t = await createIsolatedTestOrg();
        const { attemptId } = await createStartedAttempt(
          t,
          "Export PreSubmit Exam",
        );
        await saveAnswer(t, attemptId, "a");

        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe("in_progress");
        expect(res.json().questionResults[0]!.candidateAnswer).toBe("a");
      });

      it("uses draft answers only for legacy rows marked by a NULL submissionReason", async () => {
        const t = await createIsolatedTestOrg();
        const { attemptId } = await createStartedAttempt(
          t,
          "Export Legacy Row Exam",
        );
        await saveAnswer(t, attemptId, "b");
        await forceSubmit(t, attemptId);
        // Fabricate the pre-freeze historical shape: submitted_answers is NULL
        // AND submissionReason is NULL (the adopted legacy marker).
        await ctx.db
          .update(schema.examAttempts)
          .set({ submittedAnswers: null, submissionReason: null })
          .where(eq(schema.examAttempts.id, attemptId));

        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().questionResults[0]!.candidateAnswer).toBe("b");
      });

      it("fails closed when a submitted row lost its frozen answers without the legacy marker", async () => {
        const t = await createIsolatedTestOrg();
        const { attemptId } = await createStartedAttempt(
          t,
          "Export Corruption Exam",
        );
        await saveAnswer(t, attemptId, "b");
        await forceSubmit(t, attemptId);
        // Current-data corruption shape: submitted_answers is NULL but the row
        // carries a current submissionReason. NULL alone must NOT be treated as
        // a legitimate historical row (F8).
        await ctx.db
          .update(schema.examAttempts)
          .set({ submittedAnswers: null })
          .where(eq(schema.examAttempts.id, attemptId));

        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/admin/attempts/${attemptId}/export`,
          cookies: { "auth-token": t.adminToken },
        });

        expect(res.statusCode).toBe(500);
        expect(res.json().error.code).toBe("INTERNAL_ERROR");
      });
    });
  });
});
