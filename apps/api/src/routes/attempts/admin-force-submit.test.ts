import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptCommandReceiptRepo } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import { materializeGradingWorkset } from "@exam/exam-engine";
import { createGradingWorksetRepoAdapter } from "../../adapters/repoAdapters.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload, disruptAttempt } from "./attempts.testHelpers.js";

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

    /** Force-submits via the production route with the operation-aware body. */
    async function forceSubmit(
      t: IsolatedTestOrg,
      attemptId: string,
      body: { operationId: string; reason: string },
      token?: string,
    ) {
      return ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: body,
        cookies: { "auth-token": token ?? t.adminToken },
      });
    }

    async function listReceipts(attemptId: string) {
      return ctx.db
        .select()
        .from(schema.attemptCommandReceipts)
        .where(eq(schema.attemptCommandReceipts.attemptId, attemptId))
        .orderBy(schema.attemptCommandReceipts.createdAt);
    }

    async function countForceSubmitAudits(attemptId: string) {
      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      return auditRows.filter((r) => r.action === "attempt.forceSubmit");
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

    it("force-submits an in_progress attempt: applied receipt + graded + operationId audit (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit InProgress Exam",
      );
      const operationId = crypto.randomUUID();

      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "candidate abandoned exam",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("applied");
      expect(body.outcome).toBe("applied");
      expect(body.commandType).toBe("force_submit");
      expect(body.operationId).toBe(operationId);
      expect(body.resultPayload).toMatchObject({
        commandType: "force_submit",
        beforeStatus: "in_progress",
        afterStatus: "graded",
      });
      expect(body.resultPayload.submittedAt).toBeTruthy();
      expect(body.resultPayload.gradedAt).toBeTruthy();
      expect(body.resultPayload.appliedAt).toBeTruthy();
      expect(body.createdAt).toBe(body.resultPayload.appliedAt);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();

      // Exactly one durable receipt, outcome=applied, canonical payload stored.
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.operationId).toBe(operationId);
      expect(receipts[0]!.commandType).toBe("force_submit");
      expect(receipts[0]!.outcome).toBe("applied");
      expect(receipts[0]!.actorId).toBe(t.adminUserId);
      expect(receipts[0]!.requestPayload).toEqual({
        reason: "candidate abandoned exam",
      });
      expect(receipts[0]!.resultPayload).toEqual(body.resultPayload);

      // Exactly one forceSubmit audit, metadata carries operationId + canonical reason.
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorId).toBe(t.adminUserId);
      expect(audits[0]!.targetType).toBe("attempt");
      expect(audits[0]!.metadata).toMatchObject({
        operationId,
        reason: "candidate abandoned exam",
      });
    });

    it("force-submits a disrupted attempt: interruption terminalized + applied receipt (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Disrupted Exam",
      );
      await disruptAttempt(ctx.db, t.orgId, attemptId);
      const operationId = crypto.randomUUID();

      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "candidate disconnected; force terminalize",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("applied");
      expect(body.resultPayload.beforeStatus).toBe("disrupted");
      expect(body.resultPayload.afterStatus).toBe("graded");

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.gradedAt).toBeDefined();

      // The active interruption episode has a terminalized outcome event
      // (reasonCode admin_force_submit_terminalization) and the attempt's
      // interruption pointers were cleared.
      const episodeRows = await ctx.db
        .select()
        .from(schema.attemptInterruptions)
        .where(eq(schema.attemptInterruptions.attemptId, attemptId));
      expect(episodeRows).toHaveLength(1);
      const events = await ctx.db
        .select()
        .from(schema.attemptInterruptionEvents)
        .where(
          eq(
            schema.attemptInterruptionEvents.interruptionId,
            episodeRows[0]!.id,
          ),
        );
      expect(events.map((e) => e.eventType)).toEqual([
        "detected",
        "terminalized",
      ]);
      expect(events[1]!.reasonCode).toBe("admin_force_submit_terminalization");
      expect(attempt?.currentInterruptionId).toBeNull();
      expect(attempt?.interruptedAt).toBeNull();

      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.outcome).toBe("applied");
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(1);
    });

    it("replays the same operationId: returns the stored immutable fact, no re-grade, no new audit/receipt", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Replay Exam",
      );
      const operationId = crypto.randomUUID();

      const first = await forceSubmit(t, attemptId, {
        operationId,
        reason: "candidate abandoned exam",
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json();
      const firstGradedAt = (
        await createAttemptRepo(ctx.db).findById(makeAdminCtx(t), attemptId)
      )?.gradedAt;

      // Same operationId + canonical-equivalent reason (whitespace trimmed by
      // the wire schema AND the domain canonicalizer) → idempotent_replay.
      const second = await forceSubmit(t, attemptId, {
        operationId,
        reason: "  candidate abandoned exam  ",
      });

      expect(second.statusCode).toBe(200);
      const replay = second.json();
      expect(replay.disposition).toBe("idempotent_replay");
      expect(replay.outcome).toBe(firstBody.outcome);
      // The replay response IS the stored immutable fact — byte-identical.
      expect(replay.resultPayload).toEqual(firstBody.resultPayload);
      expect(replay.createdAt).toBe(firstBody.createdAt);
      expect(replay.operationId).toBe(operationId);
      expect(replay.commandType).toBe("force_submit");

      // No new receipt, no new audit, no re-grade (gradedAt unchanged).
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(1);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());
    });

    it("rejects payload drift on the same operationId with 409 IDEMPOTENCY_CONFLICT (no mutation, no receipt, no audit)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Drift Exam",
      );
      const operationId = crypto.randomUUID();

      const first = await forceSubmit(t, attemptId, {
        operationId,
        reason: "candidate abandoned exam",
      });
      expect(first.statusCode).toBe(200);

      const drift = await forceSubmit(t, attemptId, {
        operationId,
        reason: "a completely different reason",
      });
      expect(drift.statusCode).toBe(409);
      expect(drift.json().error?.code).toBe("IDEMPOTENCY_CONFLICT");

      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(1);
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
    });

    it("rejects a cross-command operationId reuse with 409 IDEMPOTENCY_CONFLICT (shared arbiter)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Cross Command Exam",
      );
      const operationId = crypto.randomUUID();
      // Pre-insert a misconduct_mark receipt with the same operationId —
      // WITHOUT calling the misconduct production route (J5-I1C Slice 3 not
      // activated). The shared UNIQUE(org, operation_id) arbiter must reject
      // the force-submit reuse.
      await createAttemptCommandReceiptRepo(ctx.db).insertReceipt(
        makeAdminCtx(t),
        {
          attemptId,
          operationId,
          commandType: "misconduct_mark",
          requestPayload: { severity: "warning", notes: "fixture mark" },
          resultPayload: {
            commandType: "misconduct_mark",
            misconduct: null,
            appliedAt: new Date().toISOString(),
          },
          outcome: "applied",
          actorId: t.adminUserId,
          createdAt: new Date(),
        },
      );

      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "should conflict across commands",
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("IDEMPOTENCY_CONFLICT");

      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.commandType).toBe("misconduct_mark");
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(0);
    });

    it("rejects a cross-attempt operationId reuse with 409 IDEMPOTENCY_CONFLICT (attempt B untouched)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId: attemptA } = await createStartedAttempt(
        t,
        "Force Submit Cross Attempt A",
      );
      const { attemptId: attemptB } = await createStartedAttempt(
        t,
        "Force Submit Cross Attempt B",
      );
      const operationId = crypto.randomUUID();

      const first = await forceSubmit(t, attemptA, {
        operationId,
        reason: "belongs to attempt A",
      });
      expect(first.statusCode).toBe(200);

      const res = await forceSubmit(t, attemptB, {
        operationId,
        reason: "attempt B must conflict",
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("IDEMPOTENCY_CONFLICT");

      const attemptBAfter = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptB,
      );
      expect(attemptBAfter?.status).toBe("in_progress");
      expect(await listReceipts(attemptB)).toHaveLength(0);
      const audits = await countForceSubmitAudits(attemptB);
      expect(audits).toHaveLength(0);
      // attempt A keeps exactly its one applied receipt.
      expect(await listReceipts(attemptA)).toHaveLength(1);
    });

    it("records a durable no_change receipt for a NEW operationId on an already-graded attempt (no audit, gradedAt unchanged)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Graded No-Change Exam",
      );
      const firstOp = crypto.randomUUID();
      const first = await forceSubmit(t, attemptId, {
        operationId: firstOp,
        reason: "first force-submit grades it",
      });
      expect(first.statusCode).toBe(200);
      const firstGradedAt = (
        await createAttemptRepo(ctx.db).findById(makeAdminCtx(t), attemptId)
      )?.gradedAt;

      // A NEW operationId against the terminal attempt → no_change receipt,
      // NOT silent success.
      const secondOp = crypto.randomUUID();
      const res = await forceSubmit(t, attemptId, {
        operationId: secondOp,
        reason: "second independent operation on graded attempt",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("no_change");
      expect(body.outcome).toBe("no_change");
      expect(body.resultPayload.beforeStatus).toBe("graded");
      expect(body.resultPayload.afterStatus).toBe("graded");

      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(2);
      expect(receipts[1]!.operationId).toBe(secondOp);
      expect(receipts[1]!.outcome).toBe("no_change");

      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(1);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());
    });

    it("recovers a submitted-but-not-graded attempt: no_change receipt, grading recovery retained, no audit", async () => {
      // Crash-recovery contract (single-tx submit+grade): an attempt left
      // `submitted` by a crashed earlier operation is recovered to `graded`
      // by a force-submit, with no forceSubmit audit row (no force-submit
      // transition off the in_progress/disrupted baseline — only grading
      // completes). The receipt's result_payload reflects the committed fact
      // (before=submitted, after=graded).
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

      const operationId = crypto.randomUUID();
      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "recover submitted crash row",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("no_change");
      expect(body.outcome).toBe("no_change");
      expect(body.resultPayload.beforeStatus).toBe("submitted");
      expect(body.resultPayload.afterStatus).toBe("graded");

      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("graded");
      expect(after?.gradedAt).not.toBeNull();

      // 1 durable receipt, 0 forceSubmit audit (grading recovery is not a
      // force-submit transition).
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.outcome).toBe("no_change");
      expect(receipts[0]!.resultPayload).toEqual(body.resultPayload);
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(0);
    });

    it("leaves a grading attempt untouched with a no_change receipt (no audit)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Idempotent Grading Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "grading" })
        .where(eq(schema.examAttempts.id, attemptId));

      const operationId = crypto.randomUUID();
      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "grading row must stay untouched",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("no_change");
      expect(body.resultPayload.beforeStatus).toBe("grading");
      expect(body.resultPayload.afterStatus).toBe("grading");

      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("grading");

      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.outcome).toBe("no_change");
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(0);
    });

    it("rejects a voided attempt with 409 INVALID_STATE_TRANSITION (0 receipt, 0 audit, 0 mutation)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Voided Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await forceSubmit(t, attemptId, {
        operationId: crypto.randomUUID(),
        reason: "voided must be rejected",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("INVALID_STATE_TRANSITION");
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
      expect(await listReceipts(attemptId)).toHaveLength(0);
      const audits = await countForceSubmitAudits(attemptId);
      expect(audits).toHaveLength(0);
    });

    it("allows the same operationId independently across two organizations", async () => {
      const t1 = await createIsolatedTestOrg();
      const t2 = await createIsolatedTestOrg();
      const { attemptId: a1 } = await createStartedAttempt(
        t1,
        "Force Submit Cross Org A",
      );
      const { attemptId: a2 } = await createStartedAttempt(
        t2,
        "Force Submit Cross Org B",
      );
      const operationId = crypto.randomUUID();

      const r1 = await forceSubmit(t1, a1, { operationId, reason: "org A" });
      const r2 = await forceSubmit(t2, a2, { operationId, reason: "org B" });

      expect(r1.statusCode).toBe(200);
      expect(r1.json().disposition).toBe("applied");
      expect(r2.statusCode).toBe(200);
      expect(r2.json().disposition).toBe("applied");
      expect((await listReceipts(a1)).length).toBe(1);
      expect((await listReceipts(a2)).length).toBe(1);
    });

    it("rejects a non-admin caller with 403", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Auth Exam",
      );

      const res = await forceSubmit(
        t,
        attemptId,
        {
          operationId: crypto.randomUUID(),
          reason: "candidate must be denied",
        },
        t.candidateToken,
      );

      expect(res.statusCode).toBe(403);
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });

    it("requires operationId (400 when missing)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Missing OpId Exam",
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: { reason: "no operationId" },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(400);
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });

    it("requires a non-blank canonical reason (400 when blank)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Force Submit Blank Reason Exam",
      );

      const res = await forceSubmit(t, attemptId, {
        operationId: crypto.randomUUID(),
        reason: "   ",
      });

      expect(res.statusCode).toBe(400);
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });

    it("returns 404 for a non-existent attempt", async () => {
      const t = await createIsolatedTestOrg();
      const res = await forceSubmit(t, crypto.randomUUID(), {
        operationId: crypto.randomUUID(),
        reason: "missing attempt",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
