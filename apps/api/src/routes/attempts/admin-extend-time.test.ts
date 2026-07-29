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
import { buildExamPayload, disruptAttempt } from "./attempts.testHelpers.js";

const GRANT_TEST_PREFIX = "time-grant-test-";

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

  describe("POST /api/admin/attempts/:attemptId/time-grants", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      adminUserId: string;
      proctorToken: string;
      candidateToken: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${GRANT_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "TG Admin",
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

      const proctorId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: proctorId,
        organizationId: org.id,
        username: `proctor-${slug}`,
        passwordHash,
        name: "TG Proctor",
        role: "Proctor",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: proctorId,
        role: "Proctor",
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
            name: "TG Candidate",
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
            name: `TG Course ${slug}`,
            code: `TG-${slug}`,
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
      const proctorToken = signJWT(
        {
          actorId: proctorId,
          role: "Proctor" as Role,
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
        proctorToken,
        candidateToken,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    async function createStartedAttempt(
      t: IsolatedTestOrg,
      examTitle: string,
      policy:
        | "strict"
        | "bounded_grace"
        | "operator_incident" = "operator_incident",
      durationMinutes = 60,
    ): Promise<{ attemptId: string; examId: string }> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        // The grant command requires an operator_incident policy snapshot, which
        // is frozen from the exam's interruptionTimePolicy at attempt creation.
        payload: {
          ...buildExamPayload({
            title: examTitle,
            courseId: t.courseId,
            questionIds: [t.questionId],
            durationMinutes,
          }),
          interruptionTimePolicy: policy,
        },
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
      return { attemptId, examId: localExamId };
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
        .where(like(schema.organizations.slug, `${GRANT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${GRANT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("grants operator time, writes the adjustment ledger row, audits, and returns the operation fact (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant InProgress");
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;
      const operationId = crypto.randomUUID();

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId,
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "Exam room network interruption",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("granted");
      expect(body.adjustment).not.toBeNull();
      expect(body.adjustment?.source).toBe("operator");
      expect(body.adjustment?.operationId).toBe(operationId);
      expect(body.adjustment?.addedSeconds).toBe(600);
      expect(body.adjustment?.reasonCode).toBe("technical_incident");
      expect(body.attempt.id).toBe(attemptId);

      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.deadlineAt?.getTime()).toBe(
        beforeDeadline.getTime() + 600_000,
      );

      // Domain adjustment ledger: exactly one operator row for this command.
      const adjustments = await ctx.db
        .select()
        .from(schema.attemptTimeAdjustments)
        .where(eq(schema.attemptTimeAdjustments.attemptId, attemptId));
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.source).toBe("operator");
      expect(adjustments[0]!.policy).toBe("operator_incident");
      expect(adjustments[0]!.operationId).toBe(operationId);
      expect(adjustments[0]!.actorId).toBe(t.adminUserId);

      // Compliance audit recorded in the same transaction, with the required
      // metadata. Audit does not replace the ledger — both exist.
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const grantRows = auditRows.filter(
        (r) => r.action === "attempt.timeGrant",
      );
      expect(grantRows).toHaveLength(1);
      expect(grantRows[0]!.actorId).toBe(t.adminUserId);
      expect(grantRows[0]!.metadata).toMatchObject({
        adjustmentId: adjustments[0]!.id,
        operationId,
        addedSeconds: 600,
        reasonCode: "technical_incident",
      });
    });

    it("replays idempotently for the same operationId + payload (200 idempotent_replay, no duplicate ledger/audit)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant Idempotent");
      const operationId = crypto.randomUUID();
      const payload = {
        operationId,
        addedSeconds: 300,
        reasonCode: "candidate_request",
        reasonText: "Candidate restroom break",
      };

      const first = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload,
        cookies: { "auth-token": t.adminToken },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().outcome).toBe("granted");

      // Retry with the same operationId + same payload -> idempotent replay.
      const retry = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload,
        cookies: { "auth-token": t.adminToken },
      });

      expect(retry.statusCode).toBe(200);
      expect(retry.json().outcome).toBe("idempotent_replay");
      expect(retry.json().adjustment?.operationId).toBe(operationId);

      // No duplicate ledger row, no duplicate audit row.
      const adjustments = await ctx.db
        .select()
        .from(schema.attemptTimeAdjustments)
        .where(eq(schema.attemptTimeAdjustments.operationId, operationId));
      expect(adjustments).toHaveLength(1);
      const grantRows = (
        await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, attemptId))
      ).filter((r) => r.action === "attempt.timeGrant");
      expect(grantRows).toHaveLength(1);
    });

    it("rejects an operationId reused with a differing payload (409 IDEMPOTENCY_CONFLICT)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant Conflict");
      const operationId = crypto.randomUUID();

      const first = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId,
          addedSeconds: 300,
          reasonCode: "candidate_request",
          reasonText: "first",
        },
        cookies: { "auth-token": t.adminToken },
      });
      expect(first.statusCode).toBe(200);

      const conflict = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId,
          addedSeconds: 999,
          reasonCode: "candidate_request",
          reasonText: "different payload",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error?.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("returns terminal (200) and grants nothing when the attempt is expired on entry", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant Terminal");
      // Expire the attempt: deadline in the past, status still in_progress.
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId: crypto.randomUUID(),
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "late grant attempt",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("terminal");
      expect(res.json().adjustment).toBeNull();

      // No adjustment ledger row written for a terminal outcome.
      const adjustments = await ctx.db
        .select()
        .from(schema.attemptTimeAdjustments)
        .where(eq(schema.attemptTimeAdjustments.attemptId, attemptId));
      expect(adjustments).toHaveLength(0);
    });

    it("rejects a non-operator_incident attempt (409 INVALID_STATE_TRANSITION)", async () => {
      const t = await createIsolatedTestOrg();
      // Default policy is strict; the grant command requires operator_incident.
      const { attemptId } = await createStartedAttempt(
        t,
        "Grant StrictPolicy",
        "strict",
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId: crypto.randomUUID(),
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "should be rejected by policy",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("rejects a grant beyond exam.closeAt (409 DEADLINE_EXCEEDS_EXAM_CLOSE, deadline unchanged)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId, examId } = await createStartedAttempt(
        t,
        "Grant BeyondClose",
      );
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;
      const examRow = (
        await ctx.db
          .select()
          .from(schema.exams)
          .where(eq(schema.exams.id, examId))
      )[0]!;
      const closeAt = examRow.closeAt as Date;
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(closeAt.getTime() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId: crypto.randomUUID(),
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "would exceed closeAt",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("DEADLINE_EXCEEDS_EXAM_CLOSE");
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.deadlineAt?.getTime()).toBe(closeAt.getTime() - 60_000);
      expect(after?.deadlineAt?.getTime()).not.toBe(beforeDeadline.getTime());
    });

    it("grants operator time on a disrupted attempt (200 granted)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant Disrupted");
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;
      await disruptAttempt(ctx.db, t.orgId, attemptId);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId: crypto.randomUUID(),
          addedSeconds: 300,
          reasonCode: "technical_incident",
          reasonText: "restore connectivity",
        },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("granted");
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.deadlineAt?.getTime()).toBe(
        beforeDeadline.getTime() + 300_000,
      );
    });

    it("denies a Proctor (403) — operator time grant is Admin-only", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(t, "Grant ProctorDeny");

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/time-grants`,
        payload: {
          operationId: crypto.randomUUID(),
          addedSeconds: 600,
          reasonCode: "technical_incident",
          reasonText: "proctor cannot grant",
        },
        cookies: { "auth-token": t.proctorToken },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
