import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { Permission } from "@exam/authz";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import type { TransactionDatabase } from "@exam/db/src/types.js";
import {
  assignProctorToExam,
  normalizeReasonCode,
  revokeProctorFromExam,
  type ProctorAssignmentRepo,
} from "@exam/exam-engine";
import { withProctorAssignmentOperationRecovery } from "../orchestrators/proctorAssignmentOperationRecovery.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

// ── Zod Schemas ──

const ExamIdParamsSchema = z.object({ examId: z.string() });

const AssignBodySchema = z.object({
  operationId: z.string().uuid(),
  proctorUserId: z.string().min(1).max(128),
  reasonCode: z.string().max(100).optional().nullable(),
});

const RevokeParamsSchema = z.object({
  examId: z.string(),
  proctorUserId: z.string().min(1).max(128),
});

const RevokeBodySchema = z.object({
  operationId: z.string().uuid(),
  reasonCode: z.string().max(100).optional().nullable(),
});

const ListQuerySchema = z.object({
  status: z.enum(["active", "revoked", "all"]).optional().default("active"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional().nullable(),
});

// ── Response Schemas ──

const AssignmentResponseSchema = z.object({
  id: z.string(),
  examId: z.string(),
  proctorUserId: z.string(),
  status: z.enum(["active", "revoked"]),
  assignedBy: z.string(),
  assignedAt: z.string(),
  revokedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AssignmentWriteResponseSchema = z.object({
  outcome: z.enum(["applied", "no_change", "idempotent_replayed"]),
  assignment: AssignmentResponseSchema,
});

const AssignmentListResponseSchema = z.object({
  items: z.array(AssignmentResponseSchema),
  nextCursor: z.string().nullable(),
});

// ── Helpers ──

function toAssignmentResponse(assignment: {
  id: string;
  examId: string;
  proctorUserId: string;
  status: string;
  assignedBy: string;
  assignedAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: assignment.id,
    examId: assignment.examId,
    proctorUserId: assignment.proctorUserId,
    status: assignment.status,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt.toISOString(),
    revokedBy: assignment.revokedBy,
    revokedAt: assignment.revokedAt?.toISOString() ?? null,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

/** Per-route atomic audit callback (exam.proctor_assigned / exam.proctor_revoked). */
function makeAudit(
  tx: unknown,
  request: { id: string },
  ctx: { organizationId: string; actorId: string },
) {
  return async (action: string, metadata: Record<string, unknown>) => {
    await recordAtomicHttpAudit(tx as never, request as never, ctx as never, {
      action: action as never,
      targetType: "exam",
      targetId: String(metadata.examId),
      metadata,
    });
  };
}

/**
 * Registers the Admin Proctor-to-Exam assignment API (ADR-015 §16, J4-I1C).
 *
 * All three routes run `requireScopedCapability(<permission>, "exam",
 * "examId")` — Admin short-circuits the Proctor-assignment triple, but the
 * Exam resolver still validates target existence, tenant, and parent chain.
 * The commands are the ONLY write path (`assignProctorToExam` /
 * `revokeProctorFromExam`); no command logic is duplicated in the route.
 */
export async function registerAdminProctorAssignmentRoutes(
  fastify: FastifyInstance,
) {
  // ── Assign ──
  fastify.post(
    "/admin/exams/:examId/proctors",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.ExamProctorAssignmentManage,
          "exam",
          "examId",
        ),
      ],
      schema: {
        params: ExamIdParamsSchema,
        body: AssignBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = ExamIdParamsSchema.parse(request.params);
      const body = AssignBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId } = params;
      const now = fastify.now();

      // Byte-identical to the engine's stored event payload so the recovery
      // wrapper's fresh-transaction lookup compares correctly.
      const canonicalPayload = {
        examId,
        proctorUserId: body.proctorUserId,
        reasonCode: normalizeReasonCode(body.reasonCode),
      };

      const result = await withProctorAssignmentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "assign",
        canonicalPayload,
        now,
        async (tx: TransactionDatabase) => {
          const repo = createProctorAssignmentRepo(
            tx,
          ) as unknown as ProctorAssignmentRepo;
          return assignProctorToExam(
            repo,
            ctx,
            {
              operationId: body.operationId,
              examId,
              proctorUserId: body.proctorUserId,
              reasonCode: body.reasonCode ?? null,
            },
            {
              now,
              audit: makeAudit(tx, request, ctx),
              lookupExam: async (examIdToLookup) => {
                const exam = await createExamRepo(tx).findById(
                  ctx,
                  examIdToLookup,
                );
                return exam
                  ? { organizationId: exam.organizationId, id: exam.id }
                  : null;
              },
              lookupProctorUser: async (userId) => {
                const user = await createUserRepo(tx).findById(ctx, userId);
                if (!user) return null;
                const assignments = await createUserRoleAssignmentRepo(
                  tx,
                ).listActiveForUser(ctx, userId);
                return {
                  organizationId: user.organizationId,
                  isActive: user.isActive,
                  hasActiveProctorRole: assignments.some(
                    (a) => a.role === "Proctor",
                  ),
                };
              },
            },
          );
        },
      );

      return reply.send(
        AssignmentWriteResponseSchema.parse({
          outcome: result.outcome,
          assignment: toAssignmentResponse(result.assignment),
        }),
      );
    },
  );

  // ── List ──
  fastify.get(
    "/admin/exams/:examId/proctors",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.ExamProctorAssignmentView,
          "exam",
          "examId",
        ),
      ],
      schema: {
        params: ExamIdParamsSchema,
        querystring: ListQuerySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentListResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = ExamIdParamsSchema.parse(request.params);
      const query = ListQuerySchema.parse(request.query);
      const ctx = ensureTargetOrg(getRequestContext(request));

      const { items, nextCursor } = await createProctorAssignmentRepo(
        fastify.db,
      ).listExamProctors(ctx, params.examId, {
        status: query.status,
        limit: query.limit,
        cursor: query.cursor ?? null,
      });

      return reply.send(
        AssignmentListResponseSchema.parse({
          items: items.map(toAssignmentResponse),
          nextCursor,
        }),
      );
    },
  );

  // ── Revoke ──
  fastify.post(
    "/admin/exams/:examId/proctors/:proctorUserId/revoke",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.ExamProctorAssignmentManage,
          "exam",
          "examId",
        ),
      ],
      schema: {
        params: RevokeParamsSchema,
        body: RevokeBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = RevokeParamsSchema.parse(request.params);
      const body = RevokeBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId, proctorUserId } = params;
      const now = fastify.now();

      const canonicalPayload = {
        examId,
        proctorUserId,
        reasonCode: normalizeReasonCode(body.reasonCode),
      };

      const result = await withProctorAssignmentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "revoke",
        canonicalPayload,
        now,
        async (tx: TransactionDatabase) => {
          const repo = createProctorAssignmentRepo(
            tx,
          ) as unknown as ProctorAssignmentRepo;
          return revokeProctorFromExam(
            repo,
            ctx,
            {
              operationId: body.operationId,
              examId,
              proctorUserId,
              reasonCode: body.reasonCode ?? null,
            },
            {
              now,
              audit: makeAudit(tx, request, ctx),
            },
          );
        },
      );

      return reply.send(
        AssignmentWriteResponseSchema.parse({
          outcome: result.outcome,
          assignment: toAssignmentResponse(result.assignment),
        }),
      );
    },
  );
}

/**
 * Fastify plugin wrapper so the assignment routes inherit the shared `/api`
 * prefix (same pattern as `attempts.ts`).
 */
export const adminProctorAssignmentRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  await registerAdminProctorAssignmentRoutes(fastify);
};
