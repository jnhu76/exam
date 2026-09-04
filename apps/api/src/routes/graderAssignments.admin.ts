import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { Permission } from "@exam/authz";
import { AuditAction } from "@exam/authz";
import {
  createGraderExamAssignmentRepo,
  type GraderExamAssignmentRow,
} from "@exam/db/src/repository/graderExamAssignmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { NotFoundError, ValidationError } from "@exam/domain";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

// ── Zod Schemas ──

const UserIdParamsSchema = z.object({ userId: z.string() });

const AssignParamsSchema = z.object({ userId: z.string() });

const AssignBodySchema = z.object({
  examId: z.string().min(1).max(128),
});

const RevokeParamsSchema = z.object({
  userId: z.string(),
  examId: z.string().min(1).max(128),
});

const ListQuerySchema = z.object({
  status: z.enum(["active", "revoked", "all"]).optional().default("active"),
});

// ── Response Schemas ──

const AssignmentResponseSchema = z.object({
  id: z.string(),
  graderUserId: z.string(),
  examId: z.string(),
  status: z.enum(["active", "revoked"]),
  assignedBy: z.string(),
  assignedAt: z.string(),
  revokedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AssignmentWriteResponseSchema = z.object({
  outcome: z.enum(["applied", "no_change"]),
  assignment: AssignmentResponseSchema,
});

const AssignmentListResponseSchema = z.object({
  items: z.array(AssignmentResponseSchema),
});

// ── Helpers ──

function toAssignmentResponse(assignment: GraderExamAssignmentRow) {
  return {
    id: assignment.id,
    graderUserId: assignment.graderUserId,
    examId: assignment.examId,
    status: assignment.status as "active" | "revoked",
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt.toISOString(),
    revokedBy: assignment.revokedBy,
    revokedAt: assignment.revokedAt?.toISOString() ?? null,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

/**
 * Validates the assignment target pair inside the caller's organization:
 * the user must exist, be active, and hold an ACTIVE Grader role
 * assignment; the exam must exist in the same organization. The DB
 * foreign keys are the second line of defense, not the authority.
 *
 * A stale assignment row for a Grader whose role was later revoked grants
 * ZERO authority by construction (authority = capability × assignment), so
 * validating the role outside the write transaction is sound — a concurrent
 * role revocation between this check and commit leaves an inert row.
 */
async function resolveAssignmentTargets(
  fastify: FastifyInstance,
  ctx: ReturnType<typeof getRequestContext> & { targetOrganizationId: string },
  graderUserId: string,
  examId: string,
): Promise<void> {
  const user = await createUserRepo(fastify.db).findByOrganizationAndId(
    ctx,
    graderUserId,
  );
  if (!user) {
    throw new NotFoundError("user");
  }
  if (!user.isActive) {
    // i18n-copy-allow: developer-diagnostic — thrown message never reaches the client; the error handler serializes the code only
    throw new ValidationError("目标用户已被停用", {
      reason: "TARGET_USER_INACTIVE",
    });
  }
  const roleAssignments = await createUserRoleAssignmentRepo(
    fastify.db,
  ).listActiveForUser(ctx, graderUserId);
  if (!roleAssignments.some((a) => a.role === "Grader")) {
    // i18n-copy-allow: developer-diagnostic — thrown message never reaches the client; the error handler serializes the code only
    throw new ValidationError("目标用户不具有评卷员角色", {
      reason: "TARGET_NOT_GRADER",
    });
  }
  const exam = await createExamRepo(fastify.db).findById(ctx, examId);
  if (!exam) {
    throw new NotFoundError("exam");
  }
}

/**
 * Registers the Admin Grader-to-Exam assignment API (issue #296).
 *
 * All three routes use the flat `requireCapability` gate:
 * `ExamGraderAssignmentView` / `ExamGraderAssignmentManage` are Admin-only
 * permissions (never in the Grader preset) — the carrier row itself grants
 * ZERO capabilities, so no scoped resolution applies to this config surface.
 *
 * Deliberate divergence from the Proctor assignment API (ADR-015 §16): NO
 * operationId / event receipts / recovery orchestration. Grader exam
 * assignment is a static Admin configuration surface without a live-exam
 * race; outcomes are deterministic (assign-already-active → `no_change`,
 * revoke-without-active → 404) and a concurrent duplicate assign resolves
 * through the `grader_exam_assignments_active_unique` partial index.
 */
export async function registerAdminGraderAssignmentRoutes(
  fastify: FastifyInstance,
) {
  // ── Assign ──
  fastify.post(
    "/admin/users/:userId/exam-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamGraderAssignmentManage),
      ],
      schema: {
        params: AssignParamsSchema,
        body: AssignBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentWriteResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          // A concurrent duplicate assign loses the partial-unique race and
          // surfaces through the global 23505 → 409 RESOURCE_CONFLICT mapping.
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = AssignParamsSchema.parse(request.params);
      const body = AssignBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const now = fastify.now();

      await resolveAssignmentTargets(fastify, ctx, params.userId, body.examId);

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const repo = createGraderExamAssignmentRepo(tx);
        const existing = await repo.findActiveByGraderAndExam(
          ctx,
          params.userId,
          body.examId,
        );
        if (existing) {
          return { outcome: "no_change" as const, assignment: existing };
        }
        const created = await repo.insertAssignment(ctx, {
          graderUserId: params.userId,
          examId: body.examId,
          assignedBy: ctx.actorId,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: AuditAction.ExamGraderAssigned,
          targetType: "exam",
          targetId: body.examId,
          metadata: {
            organizationId: ctx.organizationId,
            examId: body.examId,
            graderUserId: params.userId,
            assignmentId: created.id,
            actorId: ctx.actorId,
            assignedAt: now.toISOString(),
          },
        });
        return { outcome: "applied" as const, assignment: created };
      });

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
    "/admin/users/:userId/exam-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamGraderAssignmentView),
      ],
      schema: {
        params: UserIdParamsSchema,
        querystring: ListQuerySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentListResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = UserIdParamsSchema.parse(request.params);
      const query = ListQuerySchema.parse(request.query);
      const ctx = ensureTargetOrg(getRequestContext(request));

      const user = await createUserRepo(fastify.db).findByOrganizationAndId(
        ctx,
        params.userId,
      );
      if (!user) {
        throw new NotFoundError("user");
      }

      const episodes = await createGraderExamAssignmentRepo(
        fastify.db,
      ).listByGrader(ctx, params.userId);
      const filtered =
        query.status === "all"
          ? episodes
          : episodes.filter((e) => e.status === query.status);

      return reply.send(
        AssignmentListResponseSchema.parse({
          items: filtered.map(toAssignmentResponse),
        }),
      );
    },
  );

  // ── Revoke ──
  fastify.post(
    "/admin/users/:userId/exam-assignments/:examId/revoke",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamGraderAssignmentManage),
      ],
      schema: {
        params: RevokeParamsSchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentWriteResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = RevokeParamsSchema.parse(request.params);
      const ctx = ensureTargetOrg(getRequestContext(request));
      const now = fastify.now();

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const repo = createGraderExamAssignmentRepo(tx);
        const target = await repo.resolveRevokeTarget(
          ctx,
          params.userId,
          params.examId,
          true,
        );
        if (!target) {
          throw new NotFoundError("grader exam assignment");
        }
        const revoked = await repo.revokeAssignment(ctx, target.id, {
          revokedBy: ctx.actorId,
          revokedAt: now,
          updatedAt: now,
        });
        if (!revoked) {
          throw new NotFoundError("grader exam assignment");
        }
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: AuditAction.ExamGraderRevoked,
          targetType: "exam",
          targetId: params.examId,
          metadata: {
            organizationId: ctx.organizationId,
            examId: params.examId,
            graderUserId: params.userId,
            assignmentId: revoked.id,
            actorId: ctx.actorId,
            revokedAt: now.toISOString(),
          },
        });
        return revoked;
      });

      return reply.send(
        AssignmentWriteResponseSchema.parse({
          outcome: "applied",
          assignment: toAssignmentResponse(result),
        }),
      );
    },
  );
}

/**
 * Fastify plugin wrapper so the assignment routes inherit the shared `/api`
 * prefix (same pattern as `teacherAssignments.admin.ts`).
 */
export const adminGraderAssignmentRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  await registerAdminGraderAssignmentRoutes(fastify);
};
