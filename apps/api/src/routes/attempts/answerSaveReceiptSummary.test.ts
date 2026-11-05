import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createAuditLogTestRepo } from "@exam/db/testHelpers/auditLogTestRepo";
import { signJWT } from "@exam/auth/session";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import { hashPassword } from "@exam/auth/password";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { RequestContext, Role } from "@exam/domain";
import { buildExamPayload } from "./__tests__/attempts.testHelpers.js";

const RECEIPT_SUMMARY_PREFIX = "receipt-summary-test-";

describe("attempt routes — answer-save-receipt summary (#866)", () => {
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

  describe("GET /api/admin/attempts/:attemptId/answer-save-receipt-summary", () => {
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
      const slug = `${RECEIPT_SUMMARY_PREFIX}${uniquePrefix()}`;
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

      // Authenticate resolves authority from ACTIVE
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
        .where(like(schema.organizations.slug, `${RECEIPT_SUMMARY_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${RECEIPT_SUMMARY_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("requires authentication (401 without token)", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${crypto.randomUUID()}/answer-save-receipt-summary`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects Candidate role with 403", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "RS Candidate 403");
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/answer-save-receipt-summary`,
        cookies: { "auth-token": t.candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 NOT_FOUND for a nonexistent attempt UUID", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${crypto.randomUUID()}/answer-save-receipt-summary`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });

    it("an attempt with no accepted saves summarizes to zeros/nulls — never 'never saved'", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "RS Empty");
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/answer-save-receipt-summary`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        receiptCount: 0,
        maxClientSeq: null,
        lastSavedAt: null,
      });
    });

    it("aggregates count / MAX clientSeq / last savedAt over planted receipts, exposing ONLY the three summary fields", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "RS Aggregate");
      const base = new Date("2026-11-04T10:00:00Z");
      const rows = [
        { questionId: t.questionId, clientSeq: 1, offsetMs: 0 },
        { questionId: t.questionId, clientSeq: 2, offsetMs: 1_500 },
        { questionId: t.questionId, clientSeq: 3, offsetMs: 3_000 },
      ];
      await ctx.db.insert(schema.examAnswerSaveReceipts).values(
        rows.map((r) => ({
          organizationId: t.orgId,
          attemptId,
          questionId: r.questionId,
          clientSeq: r.clientSeq,
          answerIdentity: `sha256-fixture-${r.clientSeq}`,
          acceptedVersion: r.clientSeq,
          savedAt: new Date(base.getTime() + r.offsetMs),
        })),
      );

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/answer-save-receipt-summary`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Exactly the three summary fields — no answer content, no identity
      // digest, no per-question breakdown (#866: deliberately weak).
      expect(Object.keys(body).sort()).toEqual([
        "lastSavedAt",
        "maxClientSeq",
        "receiptCount",
      ]);
      expect(body.receiptCount).toBe(3);
      expect(body.maxClientSeq).toBe(3);
      expect(body.lastSavedAt).toBe(
        new Date(base.getTime() + 3_000).toISOString(),
      );
    });

    it("does not leak another organization's receipts (org boundary, 404)", async () => {
      const orgA = await createIsolatedTestOrg();
      const orgB = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(orgA, "RS OrgB");
      // A receipt exists in org A…
      await ctx.db.insert(schema.examAnswerSaveReceipts).values({
        organizationId: orgA.orgId,
        attemptId,
        questionId: orgA.questionId,
        clientSeq: 1,
        answerIdentity: "sha256-fixture-x",
        acceptedVersion: 1,
        savedAt: new Date("2026-11-04T10:00:00Z"),
      });
      // …but org B's admin cannot even see the attempt.
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/answer-save-receipt-summary`,
        cookies: { "auth-token": orgB.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
