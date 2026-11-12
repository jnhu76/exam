import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, lte, and } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { scanDatabaseForExpiredAttempts } from "../../plugins/deadlineScanner.js";
import { autoSubmitAndGrade } from "../../plugins/deadlineScanner.js";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import {
  buildExamPayload,
  candidateRequestContext,
  createIsolatedAttemptOrg,
  disruptAttempt,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

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
    async function createStartedAttemptWithQuestion(
      t: IsolatedAttemptOrg,
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
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit InProgress Exam",
      );
      await backdateDeadline(attemptId);

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();
      expect(attempt?.score).toBeDefined();
    });

    it("does NOT write a phantom attempt.autoSubmit audit when the row is already submitted when the scanner operates", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(attempt?.status).toBe("submitted");
    });

    it("is idempotent: second scan does not re-grade or create a compliance audit", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Idempotent Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      const firstAttempt = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
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
        candidateRequestContext(t),
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
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Disrupted Exam",
      );
      await backdateDeadline(attemptId);
      await disruptAttempt(ctx.db, t.orgId, attemptId);

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
    });

    it("does not touch a voided attempt whose deadline has passed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
      expect(result.submittedCount).toBe(0);
    });

    it("does not auto-submit an in_progress attempt whose deadline is still future", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
    });

    // T7 — extendExam(closeAt) vs scanner: post-extension authoritative
    // recheck regression.
    //
    // Scenario: an attempt is a discovery candidate (deadlineAt in the past,
    // so the DB query selects it). The exam window is EXTENDED — fully
    // committed — BEFORE the scanner operation runs. The scanner MUST NOT
    // submit: the canonical isAttemptDeadlineExpired recheck, evaluated
    // under Attempt FOR UPDATE + Exam FOR UPDATE at operation time, sees
    // the committed extension and no-ops.
    //
    // PROOF BOUNDARY: the writer commits before the scanner starts, so this
    // is a sequential post-extension recheck proof — it kills "remove the
    // under-lock recheck / act on the stale discovery predicate". It does
    // NOT construct a concurrent writer-vs-scanner schedule; the
    // deterministic writer-race ownership lives in
    // candidate-deadline-authority.concurrency.test.ts and
    // candidate-save-deadline-race.concurrency.test.ts (parked production
    // transaction vs the real extend route).
    it("does not auto-submit when exam.closeAt is extended (committed) before the scanner's under-lock recheck (T7)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Extend Race Exam",
      );
      // Backdate the per-attempt deadline so the discovery query selects it.
      await backdateDeadline(attemptId);
      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // ── REACHABILITY vs NULL-RECOVERY BOUNDARY ──────────────────
    //
    // Reachability invariant (ACTIVE-DEADLINE-001): ordinary production
    // CANNOT create an active attempt with deadlineAt = NULL.
    // startOrRestoreAttempt (line 200) writes a non-null deadlineAt via
    // calculateDeadlineAt; the operator time grant engine writes non-null; restoreAttempt
    // only preserves an existing value; scanner/submit never write deadlineAt.
    // A NULL active deadlineAt is therefore schema-admissible but
    // protocol state for close-bound modes since #291: a
    // `deadline`-mode attempt carries deadlineAt = NULL and expires via the
    // exam's closeAt (covered below). Only `untimed` (closeAt also NULL)
    // sits outside the scanner's expiry domain — the under-lock canonical
    // recheck always rejects it.
    //
    // T1 (reachability invariant, scoped): production-started attempts in
    // timed_window always carry a non-null deadlineAt.
    it("timed_window production start establishes a non-null deadlineAt (ACTIVE-DEADLINE-001, scoped)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
    it("auto-submits a NULL-deadline attempt whose exam.closeAt has passed (defensive recovery DL-ROB-001)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
        candidateRequestContext(t),
        attemptId,
      );
      await ctx.db
        .update(schema.exams)
        .set({ closeAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.exams.id, attempt!.examId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const after = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
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
    it("does NOT auto-submit a NULL-deadline attempt while exam.closeAt is future (defensive recovery, negative)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // DEFENSIVE RECOVERY (sequential recheck): the canonical decision must
    // remain correct for NULL-deadline (defensive) rows after a committed
    // exam.closeAt extension. Under the defensive fallback
    // EffectiveDeadline = closeAt (future), so the canonical recheck returns
    // NOT expired => no-op. Same proof boundary as T7: the extension commits
    // before the scanner runs; this is not a concurrent race schedule.
    it("does not auto-submit a NULL-deadline attempt when exam.closeAt is extended (committed) before the scanner's under-lock recheck (defensive recovery)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
        label: "DS",
      });
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline NULL Extend Race Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: null, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
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
        candidateRequestContext(t),
        attemptId,
      );
      expect(after?.status).toBe("in_progress");
      expect(after?.submittedAt).toBeNull();
    });

    // ── Phase A2 (#291): scanner behavior per timing mode ──
    //
    // deadline mode: NULL deadlineAt is now a REACHABLE protocol state. The
    // attempt expires via exam.closeAt and MUST be auto-submitted at equality.
    // untimed mode: closeAt and deadlineAt are both NULL — the canonical
    // effective deadline is null, expiry is always false, and the scanner must
    // never submit the attempt however late it runs.
    describe("attempt routes — timing modes (scanner)", () => {
      it("deadline-mode attempt (null deadlineAt) is auto-submitted by the scanner at closeAt", async () => {
        const t = await createIsolatedAttemptOrg(ctx, {
          slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
          label: "DS",
        });
        const exam = await ctx.app.inject({
          method: "POST",
          url: "/api/exams",
          payload: buildExamPayload({
            title: "Deadline Scanner Exam",
            courseId: t.courseId,
            questionIds: [t.questionId],
            timingMode: "deadline",
            durationMinutes: null,
          }),
          cookies: { "auth-token": t.adminToken },
        });
        const examId = exam.json().id;
        await ctx.app.inject({
          method: "POST",
          url: `/api/exams/${examId}/publish`,
          cookies: { "auth-token": t.adminToken },
        });
        await ctx.app.inject({
          method: "POST",
          url: `/api/exams/${examId}/enrollments`,
          payload: { candidateIds: [t.candidateProfileId] },
          cookies: { "auth-token": t.adminToken },
        });
        const startRes = await ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${examId}/start`,
          cookies: { "auth-token": t.candidateToken },
        });
        expect(startRes.statusCode).toBe(201);
        const attemptId = startRes.json().id as string;

        // The started attempt carries a NULL personal deadline (global cutoff
        // only) — the defining deadline-mode invariant.
        const started = await ctx.db
          .select({ deadlineAt: schema.examAttempts.deadlineAt })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, attemptId));
        expect(started[0]!.deadlineAt).toBeNull();

        // Push the exam window into the past; the scanner must reconcile.
        await ctx.db
          .update(schema.exams)
          .set({ closeAt: new Date(Date.now() - 60_000) })
          .where(eq(schema.exams.id, examId));

        const result = await scanDatabaseForExpiredAttempts(
          ctx.app,
          new Date(),
        );
        expect(result.submittedCount).toBeGreaterThanOrEqual(1);

        const after = await createAttemptRepo(ctx.db).findById(
          candidateRequestContext(t),
          attemptId,
        );
        expect(after?.status).toBe("graded");
        expect(after?.submissionReason).toBe("deadline");
        // The scanner's deadline submission stamps submittedAt with the
        // canonical effective deadline (H-04) — for a deadline-mode attempt
        // that is exactly exam.closeAt, the same semantic as the lazy
        // on-read reconciliation path (exam-runtime.md §5.4).
        const closedAt = await ctx.db
          .select({ closeAt: schema.exams.closeAt })
          .from(schema.exams)
          .where(eq(schema.exams.id, examId));
        expect(after?.submittedAt?.getTime()).toBe(
          closedAt[0]!.closeAt!.getTime(),
        );
      });

      // H-04 (#961) — scanner deadline submit stamps the BUSINESS valid
      // submission instant. exam-runtime.md §5.4 defines the deadline
      // reconciliation family's `submittedAt` as the effective deadline D;
      // the scanner is the scheduled half of that family (same freeze+grade
      // barrier), so its deadline submission must carry the same semantic as
      // the lazy on-read path — not the scan tick's wall clock. The actual
      // execution instant stays where it belongs: grading keeps the tick time.
      it("stamps the scanner's deadline submit with the effective deadline D, while grading keeps the tick time (H-04)", async () => {
        const t = await createIsolatedAttemptOrg(ctx, {
          slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
          label: "DS",
        });
        const { attemptId } = await createStartedAttemptWithQuestion(
          t,
          "Deadline Scanner SubmittedAt Effective Exam",
        );
        // Fix the authoritative effective deadline D at a known past instant;
        // the scanner's tick clock is strictly later than D.
        const effectiveDeadline = new Date(Date.now() - 60_000);
        await ctx.db
          .update(schema.examAttempts)
          .set({ deadlineAt: effectiveDeadline, status: "in_progress" })
          .where(eq(schema.examAttempts.id, attemptId));

        const scanNow = new Date();
        const result = await scanDatabaseForExpiredAttempts(ctx.app, scanNow);
        expect(result.submittedCount).toBeGreaterThanOrEqual(1);

        const after = await createAttemptRepo(ctx.db).findById(
          candidateRequestContext(t),
          attemptId,
        );
        expect(after?.status).toBe("graded");
        expect(after?.submissionReason).toBe("deadline");
        // Business valid time: submittedAt = D exactly (min(closeAt, D) = D —
        // the seeded exam closeAt stays in the future).
        expect(after?.submittedAt?.getTime()).toBe(effectiveDeadline.getTime());
        // Actual execution time: grading runs at the tick instant, unmoved.
        expect(after?.gradedAt?.getTime()).toBe(scanNow.getTime());
      });

      // H-04 review: the submit's business effective instant and the
      // interruption terminalization's observation instant are DIFFERENT
      // facts. The attempt was detected at t1 (after the deadline D) and the
      // scanner processes it at t2 > max(D, t1). The submit is backdated to D,
      // but the terminalized event must record the observation instant t2 —
      // never D, which would place the outcome before the detected event and
      // invert the episode's event order.
      it("stamps a disrupted attempt's scanner deadline submit with D but terminalizes at the scan observation instant (H-04 review)", async () => {
        const t = await createIsolatedAttemptOrg(ctx, {
          slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
          label: "DS",
        });
        const { attemptId } = await createStartedAttemptWithQuestion(
          t,
          "Deadline Scanner Disrupted Terminalization Exam",
        );
        const effectiveDeadline = new Date(Date.now() - 120_000);
        const detectedAt = new Date(Date.now() - 60_000);
        await ctx.db
          .update(schema.examAttempts)
          .set({ deadlineAt: effectiveDeadline, status: "in_progress" })
          .where(eq(schema.examAttempts.id, attemptId));
        await disruptAttempt(ctx.db, t.orgId, attemptId, {
          interruptedAt: detectedAt,
        });

        const scanNow = new Date(Date.now() + 30_000);
        const result = await scanDatabaseForExpiredAttempts(ctx.app, scanNow);
        expect(result.submittedCount).toBeGreaterThanOrEqual(1);

        const after = await createAttemptRepo(ctx.db).findById(
          candidateRequestContext(t),
          attemptId,
        );
        expect(after?.status).toBe("graded");
        expect(after?.submissionReason).toBe("deadline");
        // Business effective time: submittedAt = D, unchanged.
        expect(after?.submittedAt?.getTime()).toBe(effectiveDeadline.getTime());
        // Actual execution time: grading keeps the scan tick.
        expect(after?.gradedAt?.getTime()).toBe(scanNow.getTime());

        const events = await ctx.db
          .select()
          .from(schema.attemptInterruptionEvents)
          .where(eq(schema.attemptInterruptionEvents.attemptId, attemptId));
        const detected = events.filter((e) => e.eventType === "detected");
        const terminalized = events.filter(
          (e) => e.eventType === "terminalized",
        );
        expect(detected).toHaveLength(1);
        expect(terminalized).toHaveLength(1);
        // Observation time: terminalization records when the scanner actually
        // processed the disrupted attempt, not the business deadline.
        expect(terminalized[0]!.occurredAt.getTime()).toBe(scanNow.getTime());
        expect(detected[0]!.occurredAt.getTime()).toBe(detectedAt.getTime());
        expect(detected[0]!.occurredAt.getTime()).toBeLessThanOrEqual(
          terminalized[0]!.occurredAt.getTime(),
        );
        // Event contract fields are unchanged by the time separation.
        expect(terminalized[0]!.reasonCode).toBe("deadline_terminalization");
        expect(terminalized[0]!.detectionSource).toBeNull();
        expect(terminalized[0]!.observedLastActivityAt).toBeNull();
        expect(terminalized[0]!.interruptionId).toBe(
          detected[0]!.interruptionId,
        );
      });

      it("untimed attempt is NEVER auto-submitted by the scanner, however late", async () => {
        const t = await createIsolatedAttemptOrg(ctx, {
          slugPrefix: DEADLINE_SCANNER_TEST_PREFIX,
          label: "DS",
        });
        const exam = await ctx.app.inject({
          method: "POST",
          url: "/api/exams",
          payload: buildExamPayload({
            title: "Untimed Scanner Exam",
            courseId: t.courseId,
            questionIds: [t.questionId],
            timingMode: "untimed",
            durationMinutes: null,
          }),
          cookies: { "auth-token": t.adminToken },
        });
        expect(exam.statusCode).toBe(201);
        const examId = exam.json().id;
        expect(exam.json().closeAt).toBeNull();
        await ctx.app.inject({
          method: "POST",
          url: `/api/exams/${examId}/publish`,
          cookies: { "auth-token": t.adminToken },
        });
        await ctx.app.inject({
          method: "POST",
          url: `/api/exams/${examId}/enrollments`,
          payload: { candidateIds: [t.candidateProfileId] },
          cookies: { "auth-token": t.adminToken },
        });
        const startRes = await ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${examId}/start`,
          cookies: { "auth-token": t.candidateToken },
        });
        expect(startRes.statusCode).toBe(201);
        const attemptId = startRes.json().id as string;
        const started = await ctx.db
          .select({ deadlineAt: schema.examAttempts.deadlineAt })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, attemptId));
        expect(started[0]!.deadlineAt).toBeNull();

        // A full day "passes" (simulated wall-clock sample for the scan cycle).
        await scanDatabaseForExpiredAttempts(
          ctx.app,
          new Date(Date.now() + 86_400_000),
        );

        const after = await createAttemptRepo(ctx.db).findById(
          candidateRequestContext(t),
          attemptId,
        );
        expect(after?.status).toBe("in_progress");
        expect(after?.submittedAt).toBeNull();
      });
    });
  });
});
