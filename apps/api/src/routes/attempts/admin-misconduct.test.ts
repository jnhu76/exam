import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptCommandReceiptRepo } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const MISCONDUCT_TEST_PREFIX = "misconduct-op-test-";

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

  describe("POST /api/admin/attempts/:attemptId/misconduct (operation-aware, J5-I1C Slice 3)", () => {
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
      const slug = `${MISCONDUCT_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "MM Admin",
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
            name: "MM Candidate",
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
            name: `MM Course ${slug}`,
            code: `MM-${slug}`,
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

    /** Marks misconduct via the production route with the operation-aware body. */
    async function misconduct(
      t: IsolatedTestOrg,
      attemptId: string,
      body: {
        operationId: string;
        severity: "warning" | "serious";
        notes: string;
      },
      token?: string,
    ) {
      return ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
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

    async function countMisconductAudits(attemptId: string) {
      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      return auditRows.filter((r) => r.action === "attempt.misconductFlagged");
    }

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${MISCONDUCT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${MISCONDUCT_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("marks misconduct on an in_progress attempt: applied receipt + projection + operationId audit (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Applied Exam",
      );
      const operationId = crypto.randomUUID();

      const res = await misconduct(t, attemptId, {
        operationId,
        severity: "serious",
        notes: "candidate looked at notes",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disposition).toBe("applied");
      expect(body.outcome).toBe("applied");
      expect(body.commandType).toBe("misconduct_mark");
      expect(body.operationId).toBe(operationId);
      expect(body.resultPayload).toMatchObject({
        commandType: "misconduct_mark",
        misconduct: {
          flaggedBy: t.adminUserId,
          notes: "candidate looked at notes",
          severity: "serious",
        },
      });
      expect(body.resultPayload.misconduct.flaggedAt).toBeTruthy();
      expect(body.resultPayload.appliedAt).toBeTruthy();
      expect(body.createdAt).toBe(body.resultPayload.appliedAt);

      // Projection: exam_attempts.misconduct reflects the receipt.
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
      // Misconduct does NOT change attempt status.
      expect(attempt?.status).toBe("in_progress");

      // Exactly one durable receipt, outcome=applied, canonical payload stored.
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.operationId).toBe(operationId);
      expect(receipts[0]!.commandType).toBe("misconduct_mark");
      expect(receipts[0]!.outcome).toBe("applied");
      expect(receipts[0]!.actorId).toBe(t.adminUserId);
      expect(receipts[0]!.requestPayload).toEqual({
        severity: "serious",
        notes: "candidate looked at notes",
      });
      expect(receipts[0]!.resultPayload).toEqual(body.resultPayload);

      // Exactly one audit row carrying the operationId.
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorId).toBe(t.adminUserId);
      expect(audits[0]!.metadata).toMatchObject({
        operationId,
        severity: "serious",
        notes: "candidate looked at notes",
      });
    });

    it("replays the same operationId: returns the stored immutable fact, no projection churn, no new audit/receipt", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Replay Exam",
      );
      const operationId = crypto.randomUUID();
      const firstBody = {
        operationId,
        severity: "warning" as const,
        notes: "first observation",
      };

      const first = await misconduct(t, attemptId, firstBody);
      expect(first.statusCode).toBe(200);
      const firstJson = first.json();
      expect(firstJson.disposition).toBe("applied");

      // Small drift in server time is possible; capture the canonical receipt
      // createdAt (the immutable fact) and the projection timestamp BEFORE the
      // replay so we can prove neither moved.
      const receiptsBefore = await listReceipts(attemptId);
      expect(receiptsBefore).toHaveLength(1);
      const projectionBefore = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      // `flaggedAt` is read back from the jsonb column as an ISO string (the
      // column type-cast does not parse jsonb datetimes), so compare by value.
      const projectionFlaggedAtBefore = projectionBefore?.misconduct
        ?.flaggedAt as unknown as string | undefined;

      const replay = await misconduct(t, attemptId, firstBody);
      expect(replay.statusCode).toBe(200);
      const replayJson = replay.json();
      expect(replayJson.disposition).toBe("idempotent_replay");
      expect(replayJson.outcome).toBe("applied");
      expect(replayJson.operationId).toBe(operationId);
      // The replay returns the STORED immutable fact byte-for-byte.
      expect(replayJson.resultPayload).toEqual(firstJson.resultPayload);
      expect(replayJson.createdAt).toBe(firstJson.createdAt);

      // No new receipt, no projection churn, no new audit.
      const receiptsAfter = await listReceipts(attemptId);
      expect(receiptsAfter).toHaveLength(1);
      const projectionAfter = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(projectionAfter?.misconduct?.flaggedAt as unknown as string).toBe(
        projectionFlaggedAtBefore,
      );
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(1);
    });

    it("rejects payload drift on the same operationId with 409 IDEMPOTENCY_CONFLICT (no mutation, no receipt, no audit)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Drift Exam",
      );
      const operationId = crypto.randomUUID();

      const first = await misconduct(t, attemptId, {
        operationId,
        severity: "warning",
        notes: "original",
      });
      expect(first.statusCode).toBe(200);

      const drift = await misconduct(t, attemptId, {
        operationId,
        severity: "serious", // payload drift
        notes: "changed severity",
      });
      expect(drift.statusCode).toBe(409);
      expect(drift.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

      // Only the original applied receipt + audit survive; the projection is
      // the original mark, not the drifted one.
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.requestPayload).toEqual({
        severity: "warning",
        notes: "original",
      });
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(1);
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.misconduct).toMatchObject({
        severity: "warning",
        notes: "original",
      });
    });

    it("rejects a cross-command operationId reuse with 409 IDEMPOTENCY_CONFLICT (shared arbiter, force_submit untouched)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct CrossCommand Exam",
      );
      const operationId = crypto.randomUUID();

      // First: mark misconduct with this operationId.
      const first = await misconduct(t, attemptId, {
        operationId,
        severity: "warning",
        notes: "misconduct first",
      });
      expect(first.statusCode).toBe(200);

      // Reuse the SAME operationId on force-submit → the shared
      // (organization_id, operation_id) arbiter makes the second insert fail.
      const fs = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: { operationId, reason: "reused operationId" },
        cookies: { "auth-token": t.adminToken },
      });
      expect(fs.statusCode).toBe(409);
      expect(fs.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

      // Only one receipt (the misconduct one); the force-submit attempt was
      // untouched (still in_progress, no forceSubmit audit, no second receipt).
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.commandType).toBe("misconduct_mark");
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
      await ctx.drainAuditWrites();
      const fsAudits = (
        await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, attemptId))
      ).filter((r) => r.action === "attempt.forceSubmit");
      expect(fsAudits).toHaveLength(0);
    });

    it("rejects a cross-attempt operationId reuse with 409 IDEMPOTENCY_CONFLICT (attempt B untouched)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId: attemptA } = await createStartedAttempt(
        t,
        "Misconduct CrossAttempt A",
      );
      const { attemptId: attemptB } = await createStartedAttempt(
        t,
        "Misconduct CrossAttempt B",
      );
      const operationId = crypto.randomUUID();

      const first = await misconduct(t, attemptA, {
        operationId,
        severity: "warning",
        notes: "on attempt A",
      });
      expect(first.statusCode).toBe(200);

      const reuse = await misconduct(t, attemptB, {
        operationId,
        severity: "warning",
        notes: "on attempt B",
      });
      expect(reuse.statusCode).toBe(409);
      expect(reuse.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

      // Attempt B is untouched: no receipt, no misconduct projection, no audit.
      const receiptsB = await listReceipts(attemptB);
      expect(receiptsB).toHaveLength(0);
      const attemptBRow = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptB,
      );
      expect(attemptBRow?.misconduct).toBeNull();
      const auditsB = await countMisconductAudits(attemptB);
      expect(auditsB).toHaveLength(0);
    });

    it("allows the same operationId independently across two organizations", async () => {
      const t1 = await createIsolatedTestOrg();
      const t2 = await createIsolatedTestOrg();
      const { attemptId: a1 } = await createStartedAttempt(t1, "OrgA");
      const { attemptId: a2 } = await createStartedAttempt(t2, "OrgB");
      const operationId = crypto.randomUUID();

      const r1 = await misconduct(t1, a1, {
        operationId,
        severity: "warning",
        notes: "org A",
      });
      const r2 = await misconduct(t2, a2, {
        operationId,
        severity: "serious",
        notes: "org B",
      });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r1.json().disposition).toBe("applied");
      expect(r2.json().disposition).toBe("applied");
    });

    it("canonical-payload normalization: whitespace-padded notes replay as the same operation", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Canonical Exam",
      );
      const operationId = crypto.randomUUID();

      const first = await misconduct(t, attemptId, {
        operationId,
        severity: "warning",
        notes: "  padded notes  ", // wire schema trims → canonical "padded notes"
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().resultPayload.misconduct.notes).toBe("padded notes");

      const replay = await misconduct(t, attemptId, {
        operationId,
        severity: "warning",
        notes: "padded notes", // already canonical
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().disposition).toBe("idempotent_replay");
    });

    it("allows marking a voided attempt (any status per ADR-014 §16, applied receipt)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Voided Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await misconduct(t, attemptId, {
        operationId: crypto.randomUUID(),
        severity: "warning",
        notes: "flagged after void",
      });
      // §16: "Allowed states: any attempt status" — voided is flaggable.
      expect(res.statusCode).toBe(200);
      expect(res.json().disposition).toBe("applied");
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
    });

    it("records a durable append-only receipt for a SECOND, independent operationId on the same attempt (history preserved)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Append Exam",
      );

      const first = await misconduct(t, attemptId, {
        operationId: crypto.randomUUID(),
        severity: "warning",
        notes: "first mark",
      });
      const second = await misconduct(t, attemptId, {
        operationId: crypto.randomUUID(),
        severity: "serious",
        notes: "escalated second mark",
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json().disposition).toBe("applied");
      expect(second.json().disposition).toBe("applied");

      // Two append-only receipts (full history reconstructable).
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(2);
      expect(receipts[0]!.requestPayload).toMatchObject({
        severity: "warning",
        notes: "first mark",
      });
      expect(receipts[1]!.requestPayload).toMatchObject({
        severity: "serious",
        notes: "escalated second mark",
      });

      // The projection reflects the LATEST applied receipt (commit-order last
      // writer wins, serialized by the FOR UPDATE lock).
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(attempt?.misconduct).toMatchObject({
        severity: "serious",
        notes: "escalated second mark",
      });

      // Two audit rows (one per applied mark).
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(2);
    });

    it("requires operationId (400 when missing)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct NoOpId Exam",
      );
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: { severity: "warning", notes: "x" }, // no operationId
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(400);
    });

    it("requires a non-blank canonical notes (400 when blank)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Blank Exam",
      );
      const res = await misconduct(t, attemptId, {
        operationId: crypto.randomUUID(),
        severity: "warning",
        notes: "   ", // blank after trim
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for a non-existent attempt", async () => {
      const t = await createIsolatedTestOrg();
      const res = await misconduct(t, crypto.randomUUID(), {
        operationId: crypto.randomUUID(),
        severity: "warning",
        notes: "x",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("rejects a non-admin (candidate) with 403", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Misconduct Forbidden Exam",
      );

      const res = await misconduct(
        t,
        attemptId,
        {
          operationId: crypto.randomUUID(),
          severity: "warning",
          notes: "x",
        },
        t.candidateToken,
      );

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("the receipt repo cross-org scope: an operationId used in org A is invisible to org B's findByOperationId", async () => {
      const t1 = await createIsolatedTestOrg();
      const t2 = await createIsolatedTestOrg();
      const { attemptId: a1 } = await createStartedAttempt(t1, "OrgA scope");
      const operationId = crypto.randomUUID();
      await misconduct(t1, a1, {
        operationId,
        severity: "warning",
        notes: "org A only",
      });

      const ctx2 = makeAdminCtx(t2);
      const found = await createAttemptCommandReceiptRepo(
        ctx.db,
      ).findByOperationId(ctx2, operationId);
      // Cross-org operationId reuse is independent: org B sees NO receipt.
      expect(found).toBeNull();
    });
  });
});
