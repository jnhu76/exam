import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  FlagMisconductRequestSchema,
  FlagMisconductResponseSchema,
  ForceSubmitRequestSchema,
  ExtendTimeRequestSchema,
  LoadAttemptResponseSchema,
  AttemptTimelineResponseSchema,
  AttemptIdParamsSchema,
  AttemptExportResponseSchema,
  type AttemptExportData,
  type AttemptExportQuestionResult,
  ErrorResponseSchema,
} from "@exam/contracts";
import type { RequestContext, ExamAttempt } from "@exam/domain";
import { generateCSV } from "@exam/import-export";
import { NotFoundError, InvalidStateTransitionError } from "@exam/domain";
import {
  submitAttempt,
  gradeAttemptIdempotent,
  flagMisconduct,
  extendAttemptTime,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import { Permission } from "@exam/authz";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import {
  createAttemptRepoAdapter,
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth, toCandidateAttemptResponse } from "./attempts.shared.js";
import {
  recordAtomicHttpAudit,
  recordSensitiveReadAudit,
} from "../audit/auditWriter.js";

/**
 * Registers all admin-facing attempt routes: misconduct flag, force-submit,
 * and extend-time. Handlers are unchanged from the pre-split module.
 */
export async function registerAdminAttemptRoutes(fastify: FastifyInstance) {
  /**
   * POST /admin/attempts/:attemptId/misconduct — Admin records a
   * misconduct flag on an attempt (informational; does not change status).
   * Allowed on any attempt status (§16). Idempotent (re-flag overwrites).
   * Audit: attempt.misconductFlagged. Response: { ok: true }.
   */
  fastify.post(
    "/admin/attempts/:attemptId/misconduct",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptMisconductMark),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: FlagMisconductRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: FlagMisconductResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = FlagMisconductRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const { severity, notes } = body.data;

      // The attempt mutation and privileged-action evidence share one
      // transaction so neither can commit without the other.
      await executeInTransaction(fastify.db, async (tx) => {
        await flagMisconduct(
          createAttemptRepoAdapter(createAttemptRepo(tx), ctx),
          attemptId,
          ctx.actorId,
          severity,
          notes,
          fastify.now(),
        );
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "attempt.misconductFlagged",
          targetType: "attempt",
          targetId: attemptId,
          metadata: { severity, notes },
        });
      });

      return reply.send({ ok: true } as const);
    },
  );

  /**
   * POST /admin/attempts/:attemptId/force-submit — Admin force-submits an
   * in_progress or disrupted attempt, then grades it inside the SAME
   * transaction (no submitted-but-not-graded crash window). A `submitted` row
   * left by a crashed earlier operation is recovered to `graded` here.
   * Idempotent for grading/graded (returns current result). voided is rejected.
   * Audit event: attempt.forceSubmit (with admin identity + optional reason).
   */
  fastify.post(
    "/admin/attempts/:attemptId/force-submit",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptForceSubmit),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: ForceSubmitRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = ForceSubmitRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const reason = body.data.reason;
      // ADR-006: capture ONE operation `now` and thread it through submit +
      // grading so the two timestamps agree within this request. (fastify.now()
      // defaults to the wall clock, so calling it twice could otherwise yield
      // slightly different submit/grade instants.)
      const now = fastify.now();

      // Submit + grade in ONE transaction so there is no submitted-but-not-graded
      // crash window. Matches `autoSubmitAndGrade` / `submitAndGradeAttempt`:
      // lock the attempt row, submit (if needed) under that lock, then grade
      // idempotently inside the same tx. If the process dies mid-operation the
      // whole tx rolls back atomically — the attempt can never be left
      // `submitted` without grading. The `forceSubmitted` flag still drives the
      // audit-on-real-transition-only rule below.
      await executeInTransaction(fastify.db, async (tx) => {
        // P3-FORMAL-P0-D2: build the engine repo pair once, mint the EA
        // capability via the canonical seam, and thread the same instances
        // + capability to the grading consumer.
        const txAttemptRepo = createAttemptRepo(tx);
        const txEnrollmentRepo = createEnrollmentRepo(tx);
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txAttemptRepo,
            enrollmentRepo: txEnrollmentRepo,
          },
          ctx,
        );
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        const locked = await attempts.findById(attemptId);
        if (!locked) {
          throw new NotFoundError("Attempt not found");
        }
        // voided is the only truly invalid state for force-submit.
        if (locked.status === "voided") {
          throw new InvalidStateTransitionError(
            `Cannot force-submit attempt in ${locked.status} state`,
          );
        }

        // Idempotent: already terminal (submitted/grading/graded) -> skip
        // submit, but still run gradeAttemptIdempotent so a `submitted` row
        // left by a crashed earlier attempt is recovered to `graded` here.
        const needsSubmit =
          locked.status === "in_progress" || locked.status === "disrupted";
        // Slice 4: the grading workset repo is needed both for submitAttempt
        // (when materializing) and for gradeAttemptIdempotent (when
        // aggregating from the entries). Hoist it out of the `needsSubmit`
        // block so the crash-recovery path (`submitted` row, no submit) can
        // still aggregate from the previously-materialized workset.
        const gradingWorksetRepo = createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(tx),
          ctx,
        );
        if (needsSubmit) {
          // Admin force-submit bypasses the candidate minSubmitAfterStartMinutes
          // guard (source = "proctor" — the SubmitSource for admin/proctor
          // intervention; "admin" is not a valid SubmitSource value).
          // P3-L0-2E: submitAttempt owns grading workset materialization.

          // For disrupted→submitted, build the interruption resolution (R1).
          // For in_progress, mode=none (no active interruption).
          const episodeRepo = createInterruptionEpisodeRepoAdapter(
            createAttemptInterruptionRepo(tx),
            ctx,
          );
          const eventRepo = createInterruptionEventRepoAdapter(
            createAttemptInterruptionEventRepo(tx),
            ctx,
          );
          const resolution: SubmitInterruptionResolution =
            locked.status === "disrupted"
              ? {
                  mode: "active_interruption",
                  episodeRepo,
                  eventRepo,
                  hint: {
                    policy:
                      locked.interruptionTimingPolicySnapshot?.policy ??
                      "strict",
                    eligibleSeconds: null,
                    adjustmentId: null,
                    reasonCode: "admin_force_submit_terminalization",
                  },
                }
              : { mode: "none", episodeRepo, eventRepo };

          await submitAttempt(attempts, gradingWorksetRepo, attemptId, now, {
            source: "proctor",
            resolution,
          });
        }

        // Grade inside the SAME locked tx. `gradeAttemptIdempotent` handles
        // `submitted`->graded (the crash-recovery path: a submitted row left
        // by a crashed earlier attempt, or the row we just submitted) and is
        // a no-op for `graded`. `grading` is a transient mid-flight state we
        // cannot resume from a row read alone (it is the candidate-path's
        // own submit-tx mid-transition) — leave it untouched.
        // Slice 4: gradeAttemptIdempotent aggregates from the tx-scoped
        // workset repo (created above for submitAttempt).
        // P3-FORMAL-P0-D2: the capability is the EA protocol authority.
        if (locked.status !== "grading") {
          await gradeAttemptIdempotent(
            exams,
            enrollments,
            attempts,
            gradingWorksetRepo,
            cap,
            now,
          );
        }

        if (needsSubmit) {
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "attempt.forceSubmit",
            targetType: "attempt",
            targetId: attemptId,
            metadata: { ...(reason ? { reason } : {}) },
          });
        }

        return needsSubmit;
      });

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found after force-submit");
      }

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt as ExamAttempt, fastify.now()),
      );
    },
  );

  /**
   * POST /admin/attempts/:attemptId/extend-time — Admin extends an
   * in_progress/disrupted attempt's deadline by N minutes inside a
   * transaction with a row lock. Rejected (409) if the new deadline would
   * exceed exam.closeAt, or for non-active states. Audit: attempt.extendTime.
   */
  fastify.post(
    "/admin/attempts/:attemptId/extend-time",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptTimeExtend),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: ExtendTimeRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = ExtendTimeRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const { additionalMinutes } = body.data;

      // extendAttemptTime uses findByIdForUpdate and returns the updated
      // attempt, so we reuse it from the transaction callback instead of a
      // second findById roundtrip (review fix).
      const attempt = await executeInTransaction(fastify.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        const { exams, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txAttemptRepo,
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          ctx,
        );
        const extended = await extendAttemptTime(
          exams,
          attempts,
          attemptId,
          additionalMinutes,
          fastify.now(),
        );
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "attempt.extendTime",
          targetType: "attempt",
          targetId: attemptId,
          metadata: { additionalMinutes },
        });
        return extended;
      });

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt as ExamAttempt, fastify.now()),
      );
    },
  );

  /**
   * GET /admin/attempts/:attemptId/timeline — returns the chronological audit
   * trail for one attempt (start, save, disrupt, restore, submit, grade, and
   * admin actions like force-submit/extend/misconduct), oldest-first. Read-only
   * query over audit_logs filtered by target. Admin-only; 404 if the attempt
   * does not exist in the caller's organization.
   */
  fastify.get(
    "/admin/attempts/:attemptId/timeline",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptTimelineView),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: AttemptTimelineResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }

      const auditLogRepo = createAuditLogRepo(fastify.db);
      const rows = await auditLogRepo.listByTarget(ctx, "attempt", attemptId);

      return reply.send({
        events: rows.map((row) => ({
          id: row.auditLog.id,
          organizationId: row.auditLog.organizationId,
          actorId: row.auditLog.actorId,
          actorName: row.actorName,
          action: row.auditLog.action,
          targetType: row.auditLog.targetType,
          targetId: row.auditLog.targetId,
          metadata: row.auditLog.metadata,
          ipAddress: row.auditLog.ipAddress,
          userAgent: row.auditLog.userAgent,
          createdAt: row.auditLog.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * GET /admin/attempts/:attemptId/export — Export attempt details (answers +
   * question results) as JSON. Admin-only. Audit event: attempt.exported.
   * For CSV, see GET /admin/attempts/:attemptId/export/csv (split so each
   * response has a single, self-consistent OpenAPI content type).
   */
  fastify.get(
    "/admin/attempts/:attemptId/export",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptExport),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: AttemptExportResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const exportData = await buildAttemptExport(fastify, ctx, attemptId);

      await recordExportAudit(fastify, ctx, request, attemptId, "json");

      return reply.send(AttemptExportResponseSchema.parse(exportData));
    },
  );

  /**
   * GET /admin/attempts/:attemptId/export/csv — Export attempt details as a
   * UTF-8 (BOM) CSV file. Admin-only. `x-content-types` declares the real
   * `text/csv` media type so the generated OpenAPI documents it correctly
   * instead of mislabeling it as application/json (the provider default).
   * Audit event: attempt.exported.
   */
  fastify.get(
    "/admin/attempts/:attemptId/export/csv",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptExport),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.string(),
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
        "x-content-types": { "200": "text/csv" },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const exportData = await buildAttemptExport(fastify, ctx, attemptId);

      await recordExportAudit(fastify, ctx, request, attemptId, "csv");

      const csvHeaders = [
        "题号",
        "题型",
        "题目内容",
        "考生答案",
        "标准答案",
        "得分",
        "满分",
        "是否正确",
      ];
      const csvRows = exportData.questionResults.map((q) => ({
        题号: q.order,
        题型: q.type,
        题目内容: q.content,
        考生答案: formatAnswerValue(q.candidateAnswer),
        标准答案: formatAnswerValue(q.standardAnswer),
        得分: q.score ?? "—",
        满分: q.maxScore,
        是否正确: q.correct == null ? "—" : q.correct ? "是" : "否",
      }));
      const csv = "\uFEFF" + generateCSV(csvHeaders, csvRows);
      reply.header(
        "Content-Disposition",
        `attachment; filename="attempt-${attemptId}.csv"`,
      );
      return reply.type("text/csv; charset=utf-8").send(csv);
    },
  );
}

/**
 * Builds the attempt export payload (answers + per-question results) shared by
 * the JSON and CSV export routes. Throws NotFoundError if the attempt does not
 * exist in the caller's organization.
 */
async function buildAttemptExport(
  fastify: FastifyInstance,
  ctx: RequestContext,
  attemptId: string,
): Promise<AttemptExportData> {
  const attemptRepo = createAttemptRepo(fastify.db);
  const attempt = await attemptRepo.findById(ctx, attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  const answerMap = new Map<string, unknown>();
  for (const a of attempt.answers) {
    answerMap.set(a.questionId, a.answer);
  }

  const questionResults: AttemptExportQuestionResult[] =
    attempt.questionSnapshot.map((q) => {
      const gResult = attempt.gradingResult?.find(
        (g) => g.questionId === q.originalQuestionId,
      );
      return {
        order: q.order,
        type: q.type,
        content: q.content,
        candidateAnswer: answerMap.get(q.originalQuestionId) ?? null,
        standardAnswer: q.standardAnswer,
        score: gResult?.score ?? null,
        maxScore: gResult?.maxScore ?? q.score,
        correct: gResult?.correct ?? null,
      };
    });

  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    ...(attempt.score == null ? {} : { score: attempt.score }),
    ...(attempt.passed == null ? {} : { passed: attempt.passed }),
    startedAt: attempt.startedAt?.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString(),
    deadlineAt: attempt.deadlineAt?.toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    questionResults,
  };
}

/** Records the synchronous sensitive-read attempt export evidence. */
async function recordExportAudit(
  fastify: FastifyInstance,
  ctx: RequestContext,
  request: FastifyRequest,
  attemptId: string,
  format: "json" | "csv",
): Promise<void> {
  await recordSensitiveReadAudit(fastify.db, request, ctx, {
    action: "attempt.exported",
    targetType: "attempt",
    targetId: attemptId,
    metadata: { format },
  });
}

/** Formats an answer value as a display string for CSV export. */
function formatAnswerValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join("; ");
  return JSON.stringify(value);
}
