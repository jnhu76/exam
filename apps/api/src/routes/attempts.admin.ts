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
} from "@exam/exam-engine";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import {
  createAttemptRepoAdapter,
  createExamEngineRepos,
} from "../adapters/repoAdapters.js";
import { ensureTargetOrg, formatZodError } from "./helpers.js";
import { cookieAuth, toCandidateAttemptResponse } from "./attempts.shared.js";

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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
      const { attemptId } = parsed.data;
      const { severity, notes } = body.data;

      // P2C-J4 §17: no transaction / no row lock. flagMisconduct performs a
      // single best-effort jsonb update on the attempt.
      await flagMisconduct(
        createAttemptRepoAdapter(createAttemptRepo(fastify.db), ctx),
        attemptId,
        ctx.actorId,
        severity,
        notes,
        fastify.now(),
      );

      // Audit is awaited + best-effort (deterministic for tests).
      try {
        await createAuditLogRepo(fastify.db as Database).create(ctx, {
          actorId: ctx.actorId,
          action: "attempt.misconductFlagged",
          targetType: "attempt",
          targetId: attemptId,
          metadata: {
            requestId: request.id,
            severity,
            notes,
          },
        });
      } catch (err) {
        request.log.error(
          { err, attemptId, action: "attempt.misconductFlagged" },
          "Failed to record misconduct-flag audit",
        );
      }

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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
      const { attemptId } = parsed.data;
      const reason = body.data.reason;

      // Submit + grade in ONE transaction so there is no submitted-but-not-graded
      // crash window. Matches `autoSubmitAndGrade` / `submitAndGradeAttempt`:
      // lock the attempt row, submit (if needed) under that lock, then grade
      // idempotently inside the same tx. If the process dies mid-operation the
      // whole tx rolls back atomically — the attempt can never be left
      // `submitted` without grading. The `forceSubmitted` flag still drives the
      // audit-on-real-transition-only rule below.
      const forceSubmitted = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const txAttemptRepo = createAttemptRepo(tx);
          const locked = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
          if (!locked) {
            throw new NotFoundError("Attempt not found");
          }
          // voided is the only truly invalid state for force-submit.
          if (locked.status === "voided") {
            throw new InvalidStateTransitionError(
              `Cannot force-submit attempt in ${locked.status} state`,
            );
          }
          const { exams, enrollments, attempts } = createExamEngineRepos(
            {
              examRepo: createExamRepo(tx),
              attemptRepo: txAttemptRepo,
              enrollmentRepo: createEnrollmentRepo(tx),
            },
            ctx,
          );

          // Idempotent: already terminal (submitted/grading/graded) -> skip
          // submit, but still run gradeAttemptIdempotent so a `submitted` row
          // left by a crashed earlier attempt is recovered to `graded` here.
          const needsSubmit =
            locked.status === "in_progress" || locked.status === "disrupted";
          if (needsSubmit) {
            // Admin force-submit bypasses the candidate minSubmitAfterStartMinutes
            // guard (source = "proctor" — the SubmitSource for admin/proctor
            // intervention; "admin" is not a valid SubmitSource value).
            await submitAttempt(attempts, attemptId, fastify.now(), {
              source: "proctor",
            });
          }

          // Grade inside the SAME locked tx. `gradeAttemptIdempotent` handles
          // `submitted`->graded (the crash-recovery path: a submitted row left
          // by a crashed earlier attempt, or the row we just submitted) and is
          // a no-op for `graded`. `grading` is a transient mid-flight state we
          // cannot resume from a row read alone (it is the candidate-path's
          // own submit-tx mid-transition) — leave it untouched.
          if (locked.status !== "grading") {
            await gradeAttemptIdempotent(
              exams,
              enrollments,
              attempts,
              attemptId,
              fastify.now(),
            );
          }

          return needsSubmit;
        },
      );

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found after force-submit");
      }

      // Audit only when a real transition occurred (P2C-J2 review fix): an
      // idempotent no-op (already submitted/grading/graded) must NOT emit a
      // duplicate audit row. Awaited + best-effort so the row is committed
      // before the response (spec §20/§23).
      if (forceSubmitted) {
        try {
          await createAuditLogRepo(fastify.db as Database).create(ctx, {
            actorId: ctx.actorId,
            action: "attempt.forceSubmit",
            targetType: "attempt",
            targetId: attemptId,
            metadata: {
              requestId: request.id,
              ...(reason ? { reason } : {}),
            },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
        } catch (err) {
          request.log.error(
            { err, attemptId, action: "attempt.forceSubmit" },
            "Failed to record force-submit audit",
          );
        }
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
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
        return extendAttemptTime(
          exams,
          attempts,
          attemptId,
          additionalMinutes,
          fastify.now(),
        );
      });

      // Audit is awaited + best-effort so the row is committed before the
      // response (deterministic for tests); a failed write must not fail the
      // extend.
      try {
        await createAuditLogRepo(fastify.db as Database).create(ctx, {
          actorId: ctx.actorId,
          action: "attempt.extendTime",
          targetType: "attempt",
          targetId: attemptId,
          metadata: {
            requestId: request.id,
            additionalMinutes,
          },
        });
      } catch (err) {
        request.log.error(
          { err, attemptId, action: "attempt.extendTime" },
          "Failed to record extend-time audit",
        );
      }

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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
      const { attemptId } = parsed.data;

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }

      const auditLogRepo = createAuditLogRepo(fastify.db as Database);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      const ctx = ensureTargetOrg(request.ctx!);
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

/**
 * Records the attempt.exported audit row (awaited + best-effort so a failed
 * write never fails the export itself).
 */
async function recordExportAudit(
  fastify: FastifyInstance,
  ctx: RequestContext,
  request: FastifyRequest,
  attemptId: string,
  format: "json" | "csv",
): Promise<void> {
  try {
    await createAuditLogRepo(fastify.db as Database).create(ctx, {
      actorId: ctx.actorId,
      action: "attempt.exported",
      targetType: "attempt",
      targetId: attemptId,
      metadata: { requestId: request.id, format },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
  } catch (err) {
    request.log.error(
      { err, attemptId, action: "attempt.exported" },
      "Failed to record export audit",
    );
  }
}

/** Formats an answer value as a display string for CSV export. */
function formatAnswerValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join("; ");
  return JSON.stringify(value);
}
