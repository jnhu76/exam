import type { FastifyInstance } from "fastify";
import {
  FlagMisconductRequestSchema,
  FlagMisconductResponseSchema,
  ForceSubmitRequestSchema,
  ExtendTimeRequestSchema,
  LoadAttemptResponseSchema,
  AttemptIdParamsSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import type { RequestContext, ExamAttempt } from "@exam/domain";
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
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
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
   * in_progress or disrupted attempt, then grades it. Idempotent for
   * submitted/grading/graded (returns current result). voided is rejected.
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
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { attemptId } = parsed.data;
      const reason = body.data.reason;

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
          // Idempotent: already terminal (submitted/grading/graded) -> no-op.
          const needsSubmit =
            locked.status === "in_progress" || locked.status === "disrupted";
          if (needsSubmit) {
            // Admin force-submit bypasses the candidate minSubmitAfterStartMinutes
            // guard (source = "proctor" — the SubmitSource for admin/proctor
            // intervention; "admin" is not a valid SubmitSource value).
            await submitAttempt(
              createAttemptRepoAdapter(txAttemptRepo, ctx),
              attemptId,
              fastify.now(),
              { source: "proctor" },
            );
            return true;
          }
          return false;
        },
      );

      if (forceSubmitted) {
        // Grade outside the submit transaction (matches candidate submit path).
        await executeInTransaction(fastify.db, async (tx) => {
          const txAttemptRepo = createAttemptRepo(tx);
          await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
          const { exams, enrollments, attempts } = createExamEngineRepos(
            {
              examRepo: createExamRepo(tx),
              attemptRepo: txAttemptRepo,
              enrollmentRepo: createEnrollmentRepo(tx),
            },
            ctx,
          );
          await gradeAttemptIdempotent(
            exams,
            enrollments,
            attempts,
            attemptId,
            fastify.now(),
          );
        });
      }

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
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
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
}
