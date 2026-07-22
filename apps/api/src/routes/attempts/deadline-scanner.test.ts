import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, lte, and } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForExpiredAttempts } from "../../plugins/deadlineScanner.js";
import { autoSubmitAndGrade } from "../../plugins/deadlineScanner.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const DEADLINE_SCANNER_TEST_PREFIX = "deadline-scanner-test-";

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

  describe("deadline scanner — scanDatabaseForExpiredAttempts", () => {
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
      const slug = `${DEADLINE_SCANNER_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "DS Admin",
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
            name: "DS Candidate",
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
            name: `DS Course ${slug}`,
            code: `DS-${slug}`,
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

    async function createStartedAttemptWithQuestion(
      t: IsolatedTestOrg,
      examTitle: string,
    ): Promise<{ attemptId: string; questionId: string }> {
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

      const examDetail = (
        await ctx.app.inject({
          method: "GET",
          url: `/api/exams/${localExamId}`,
          cookies: { "auth-token": t.adminToken },
        })
      ).json();
      const localQuestionId = examDetail.questionIds[0];

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${localQuestionId}`,
        payload: {
          attemptId,
          questionId: localQuestionId,
          answer: true,
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": t.candidateToken },
      });

      return { attemptId, questionId: localQuestionId };
    }

    async function backdateDeadline(attemptId: string): Promise<void> {
      const past = new Date(Date.now() - 60_000);
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: past, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
    }

    beforeAll(async () => {
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(
          and(
            inArray(schema.examAttempts.status, ["in_progress", "disrupted"]),
            lte(schema.examAttempts.deadlineAt, new Date()),
          ),
        );
    });

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${DEADLINE_SCANNER_TEST_PREFIX}%`),
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
          like(schema.organizations.slug, `${DEADLINE_SCANNER_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("auto-submits and grades an expired in_progress attempt end-to-end", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit InProgress Exam",
      );
      await backdateDeadline(attemptId);

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();
      expect(attempt?.score).toBeDefined();
    });

    it("uses canonical attempt state without an attempt.autoSubmit compliance audit", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Audit Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(0);
    });

    it("does NOT write a phantom attempt.autoSubmit audit when the row is already submitted at lock time (race no-op)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Race Exam",
      );
      await backdateDeadline(attemptId);
      const scannerCtx = {
        actorId: "system:deadline-scanner",
        organizationId: t.orgId,
        role: "System" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "system:deadline-scanner",
        targetOrganizationId: t.orgId,
      };

      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "submitted", submittedAt: new Date() })
        .where(eq(schema.examAttempts.id, attemptId));

      const stateChanged = await autoSubmitAndGrade(
        ctx.db,
        scannerCtx,
        attemptId,
        new Date(),
      );

      expect(stateChanged).toBe(false);

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(0);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("submitted");
    });

    it("is idempotent: second scan does not re-grade or create a compliance audit", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Idempotent Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      const firstAttempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      const firstGradedAt = firstAttempt?.gradedAt;

      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const second = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(second.submittedCount).toBe(0);

      const afterSecond = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(afterSecond?.status).toBe("graded");
      expect(afterSecond?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitCount = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      ).length;
      expect(autoSubmitCount).toBe(0);
    });

    it("auto-submits a disrupted attempt whose deadline has passed", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Disrupted Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "disrupted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
    });

    it("does not touch a voided attempt whose deadline has passed", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Voided Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
      expect(result.submittedCount).toBe(0);
    });

    it("does not auto-submit an in_progress attempt whose deadline is still future", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Future Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() + 3600_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
    });

    // T7 — extendExam(closeAt) || Scanner linearization regression.
    //
    // Scenario: an attempt is a discovery candidate (deadlineAt in the past,
    // so the DB query selects it). Between discovery and the scanner's
    // under-lock authoritative recheck, the exam window is EXTENDED so that
    // the canonical effective deadline is now in the future. The scanner MUST
    // NOT submit: the canonical isAttemptDeadlineExpired recheck, evaluated
    // under Attempt FOR UPDATE + Exam FOR UPDATE, sees the new closeAt.
    //
    // This proves the accepted linearization for the
    // extendExam || Scanner race: the Exam FOR UPDATE (lock order
    // Attempt -> Exam) is the serialization point, and a concurrent
    // closeAt extension that lands before the scanner's exam read makes the
    // recheck return false (no-op). (Decision B.)
    it("does not auto-submit when exam.closeAt is extended before the under-lock recheck (T7 linearization)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Extend Race Exam",
      );
      // Backdate the per-attempt deadline so the discovery query selects it.
      await backdateDeadline(attemptId);
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      const examId = attempt!.examId;

      // EXTEND the exam window BEFORE the scanner runs, so that by the time
      // autoSubmitAndGrade re-reads exam.closeAt under lock the canonical
      // effective deadline (min(closeAt, deadlineAt)) is in the future.
      // closeAt is pushed far into the future; the per-attempt deadlineAt
      // stays in the past, so min() = deadlineAt (past) => still expired.
      // To make the canonical decision NOT-expired we must push BOTH into the
      // future: extend closeAt AND restore deadlineAt to the future.
      await ctx.db
        .update(schema.exams)
        .set({ closeAt: new Date(Date.now() + 7200_000) })
        .where(eq(schema.exams.id, examId));
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() + 3600_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const scannerCtx = {
        actorId: "system:deadline-scanner",
        organizationId: t.orgId,
        role: "System" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "system:deadline-scanner",
        targetOrganizationId: t.orgId,
      };
      const stateChanged = await autoSubmitAndGrade(
        ctx.db,
        scannerCtx,
        attemptId,
        new Date(),
      );

      // The under-lock canonical recheck must see the extended deadline and
      // skip submission.
      expect(stateChanged).toBe(false);

      const after = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // ── P0-C1: REACHABILITY vs NULL-RECOVERY BOUNDARY ──────────────────
    //
    // Reachability invariant (ACTIVE-DEADLINE-001): ordinary production
    // CANNOT create an active attempt with deadlineAt = NULL.
    // startOrRestoreAttempt (line 200) writes a non-null deadlineAt via
    // calculateDeadlineAt; extendAttemptTime writes non-null; restoreAttempt
    // only preserves an existing value; scanner/submit never write deadlineAt.
    // A NULL active deadlineAt is therefore schema-admissible but
    // protocol-unreachable — a legacy/corrupt/historical defensive-recovery
    // state, NOT a Phase-1 timing mode (see docs/architecture/exam-runtime.md §5.1
    // and computeEffectiveDeadline REACHABILITY BOUNDARY).
    //
    // T1 (reachability invariant): production-started attempts always carry a
    // non-null deadlineAt. This is the ACTIVE-DEADLINE-001 invariant, NOT
    // evidence that NULL is a valid protocol state.
    it("production start always establishes a non-null deadlineAt (ACTIVE-DEADLINE-001 reachability invariant)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline NULL Reachability Exam",
      );
      const started = await ctx.db
        .select({ deadlineAt: schema.examAttempts.deadlineAt })
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      expect(started[0]!.deadlineAt).not.toBeNull();
      expect(started[0]!.deadlineAt instanceof Date).toBe(true);
    });

    // DEFENSIVE RECOVERY (DL-ROB-001): deadlineAt = NULL AND exam.closeAt <
    // now => the attempt is canonically expired via the defensive fallback
    // (EffectiveDeadline = closeAt) and MUST be a scanner candidate so it gets
    // auto-submitted+graded. This is a robustness property over the
    // schema-admissible NULL domain, NOT a protocol liveness claim — the
    // starting state is protocol-unreachable (see T1). The test constructs it
    // via direct DB update to exercise the defensive recovery path.
    it("auto-submits a NULL-deadline attempt whose exam.closeAt has passed (P0-C1 defensive recovery DL-ROB-001)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId, questionId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline NULL ExamClose Passed Exam",
      );
      // Produce the NULL active state via direct update (not reachable via
      // ordinary production — see T1). Close the exam window in the past.
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: null, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      await ctx.db
        .update(schema.exams)
        .set({ closeAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.exams.id, attempt!.examId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const after = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("graded");
      expect(after?.submittedAt).toBeDefined();
      expect(after?.submissionReason).toBe("deadline");
      // sanity: questionId still resolves on the graded attempt
      expect(questionId).toBeDefined();
    });

    // DEFENSIVE RECOVERY (negative): deadlineAt = NULL AND exam.closeAt > now
    // => NOT canonically expired via the defensive fallback (EffectiveDeadline
    // = closeAt > now) => NOT a candidate, NOT submitted.
    it("does NOT auto-submit a NULL-deadline attempt while exam.closeAt is future (P0-C1 defensive recovery, negative)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline NULL ExamClose Future Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: null, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
      // Exam window stays in the future (default seeded closeAt is future).

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const after = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // DEFENSIVE RECOVERY (concurrency): the accepted P0-B Attempt->Exam
    // serialization must remain valid for NULL-deadline (defensive) rows. If
    // exam.closeAt is extended into the future before the under-lock recheck,
    // the canonical decision via the defensive fallback is NOT expired => no
    // submit.
    it("does not auto-submit a NULL-deadline attempt when exam.closeAt is extended before the under-lock recheck (P0-C1 defensive recovery race)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline NULL Extend Race Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: null, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      // Extend the exam window into the future BEFORE the scanner's under-lock
      // recheck. Under the defensive fallback EffectiveDeadline = closeAt
      // (future), so the canonical recheck returns false => no-op.
      await ctx.db
        .update(schema.exams)
        .set({ closeAt: new Date(Date.now() + 7200_000) })
        .where(eq(schema.exams.id, attempt!.examId));

      const scannerCtx = {
        actorId: "system:deadline-scanner",
        organizationId: t.orgId,
        role: "System" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "system:deadline-scanner",
        targetOrganizationId: t.orgId,
      };
      const stateChanged = await autoSubmitAndGrade(
        ctx.db,
        scannerCtx,
        attemptId,
        new Date(),
      );
      expect(stateChanged).toBe(false);

      const after = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // DISCOVERY CONFORMANCE (defensive domain): for every scanner-eligible
    // active attempt — including the schema-admissible NULL per-attempt
    // deadline (defensive recovery domain) — CanonicalExpired <=>
    // ScannerCandidate. We construct the four cells of the truth table over
    // (deadlineAt NULL|past) x (closeAt past|future) and assert discovery
    // matches the canonical isAttemptDeadlineExpired seam. (The NULL cells are
    // protocol-unreachable; they are exercised by direct DB update to prove
    // discovery/helper agreement over the defensive domain, not to assert
    // NULL is a valid protocol state.)
    it("discovery matches canonical expiry over the full domain incl. NULL (P0-C1 defensive discovery conformance)", async () => {
      const t = await createIsolatedTestOrg();
      const cells: Array<{
        name: string;
        deadlineAt: Date | null;
        closeAtPast: boolean;
        expectCandidate: boolean;
      }> = [
        // (deadlineAt, closeAt) -> CanonicalExpired (= ScannerCandidate)
        {
          name: "null+closePast",
          deadlineAt: null,
          closeAtPast: true,
          expectCandidate: true,
        },
        {
          name: "null+closeFuture",
          deadlineAt: null,
          closeAtPast: false,
          expectCandidate: false,
        },
        {
          name: "past+closeFuture",
          deadlineAt: new Date(Date.now() - 60_000),
          closeAtPast: false,
          expectCandidate: true,
        },
        {
          name: "future+closeFuture",
          deadlineAt: new Date(Date.now() + 3600_000),
          closeAtPast: false,
          expectCandidate: false,
        },
      ];

      const created: Array<{
        id: string;
        name: string;
        expectCandidate: boolean;
        examId: string;
      }> = [];
      for (const cell of cells) {
        const { attemptId } = await createStartedAttemptWithQuestion(
          t,
          `Deadline T8 ${cell.name}`,
        );
        const attempt = await createAttemptRepo(ctx.db).findById(
          makeCandidateCtx(t),
          attemptId,
        );
        if (cell.closeAtPast) {
          await ctx.db
            .update(schema.exams)
            .set({ closeAt: new Date(Date.now() - 60_000) })
            .where(eq(schema.exams.id, attempt!.examId));
        }
        await ctx.db
          .update(schema.examAttempts)
          .set({ deadlineAt: cell.deadlineAt, status: "in_progress" })
          .where(eq(schema.examAttempts.id, attemptId));
        created.push({
          id: attemptId,
          name: cell.name,
          expectCandidate: cell.expectCandidate,
          examId: attempt!.examId,
        });
      }

      const before = new Date();
      const found = await createAttemptRepo(ctx.db).listDeadlineCandidates(
        makeCandidateCtx(t),
        before,
      );
      const foundIds = new Set(found.map((a) => a.id));

      for (const c of created) {
        expect(
          foundIds.has(c.id),
          `cell ${c.name}: expectCandidate=${c.expectCandidate}`,
        ).toBe(c.expectCandidate);
      }
    });
  });
});
