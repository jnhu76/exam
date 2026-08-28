import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { Permission } from "@exam/authz";
import { AuditAction } from "@exam/authz";
import {
  createTeacherCourseAssignmentRepo,
  type TeacherCourseAssignmentRow,
} from "@exam/db/src/repository/teacherCourseAssignmentRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
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
  courseId: z.string().min(1).max(128),
});

const RevokeParamsSchema = z.object({
  userId: z.string(),
  courseId: z.string().min(1).max(128),
});

const ListQuerySchema = z.object({
  status: z.enum(["active", "revoked", "all"]).optional().default("active"),
});

// ── Response Schemas ──

const AssignmentResponseSchema = z.object({
  id: z.string(),
  teacherUserId: z.string(),
  courseId: z.string(),
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

function toAssignmentResponse(assignment: TeacherCourseAssignmentRow) {
  return {
    id: assignment.id,
    teacherUserId: assignment.teacherUserId,
    courseId: assignment.courseId,
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
 * the user must exist, be active, and hold an ACTIVE Teacher role
 * assignment; the course must exist in the same organization. The DB
 * foreign keys are the second line of defense, not the authority.
 *
 * A stale assignment row for a Teacher whose role was later revoked grants
 * ZERO authority by construction (authority = capability × assignment), so
 * validating the role outside the write transaction is sound — a concurrent
 * role revocation between this check and commit leaves an inert row.
 */
async function resolveAssignmentTargets(
  fastify: FastifyInstance,
  ctx: ReturnType<typeof getRequestContext> & { targetOrganizationId: string },
  teacherUserId: string,
  courseId: string,
): Promise<void> {
  const user = await createUserRepo(fastify.db).findByOrganizationAndId(
    ctx,
    teacherUserId,
  );
  if (!user) {
    throw new NotFoundError("user");
  }
  if (!user.isActive) {
    throw new ValidationError("目标用户已被停用", {
      reason: "TARGET_USER_INACTIVE",
    });
  }
  const roleAssignments = await createUserRoleAssignmentRepo(
    fastify.db,
  ).listActiveForUser(ctx, teacherUserId);
  if (!roleAssignments.some((a) => a.role === "Teacher")) {
    throw new ValidationError("目标用户不具有教师角色", {
      reason: "TARGET_NOT_TEACHER",
    });
  }
  const course = await createCourseRepo(fastify.db).findById(ctx, courseId);
  if (!course) {
    throw new NotFoundError("course");
  }
}

/**
 * Registers the Admin Teacher-to-Course assignment API (issue #286 §3B).
 *
 * All three routes use the flat `requireCapability` gate:
 * `CourseTeacherAssignmentView` / `CourseTeacherAssignmentManage` are Admin-only
 * permissions (never in the Teacher preset) — the carrier row itself grants
 * ZERO capabilities, so no scoped resolution applies to this config surface.
 *
 * Deliberate divergence from the Proctor assignment API (ADR-015 §16): NO
 * operationId / event receipts / recovery orchestration. Teacher course
 * assignment is a static Admin configuration surface without a live-exam
 * race; outcomes are deterministic (assign-already-active → `no_change`,
 * revoke-without-active → 404) and a concurrent duplicate assign resolves
 * through the `teacher_course_assignments_active_unique` partial index.
 */
export async function registerAdminTeacherAssignmentRoutes(
  fastify: FastifyInstance,
) {
  // ── Assign ──
  fastify.post(
    "/admin/users/:userId/course-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseTeacherAssignmentManage),
      ],
      schema: {
        params: AssignParamsSchema,
        body: AssignBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: AssignmentWriteResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = AssignParamsSchema.parse(request.params);
      const body = AssignBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const now = fastify.now();

      await resolveAssignmentTargets(
        fastify,
        ctx,
        params.userId,
        body.courseId,
      );

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const repo = createTeacherCourseAssignmentRepo(tx);
        const existing = await repo.findActiveByTeacherAndCourse(
          ctx,
          params.userId,
          body.courseId,
        );
        if (existing) {
          return { outcome: "no_change" as const, assignment: existing };
        }
        const created = await repo.insertAssignment(ctx, {
          teacherUserId: params.userId,
          courseId: body.courseId,
          assignedBy: ctx.actorId,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: AuditAction.CourseTeacherAssigned,
          targetType: "course",
          targetId: body.courseId,
          metadata: {
            organizationId: ctx.organizationId,
            courseId: body.courseId,
            teacherUserId: params.userId,
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
    "/admin/users/:userId/course-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseTeacherAssignmentView),
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

      const episodes = await createTeacherCourseAssignmentRepo(
        fastify.db,
      ).listByTeacher(ctx, params.userId);
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
    "/admin/users/:userId/course-assignments/:courseId/revoke",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseTeacherAssignmentManage),
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
        const repo = createTeacherCourseAssignmentRepo(tx);
        const target = await repo.resolveRevokeTarget(
          ctx,
          params.userId,
          params.courseId,
          true,
        );
        if (!target) {
          throw new NotFoundError("teacher course assignment");
        }
        const revoked = await repo.revokeAssignment(ctx, target.id, {
          revokedBy: ctx.actorId,
          revokedAt: now,
          updatedAt: now,
        });
        if (!revoked) {
          throw new NotFoundError("teacher course assignment");
        }
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: AuditAction.CourseTeacherRevoked,
          targetType: "course",
          targetId: params.courseId,
          metadata: {
            organizationId: ctx.organizationId,
            courseId: params.courseId,
            teacherUserId: params.userId,
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
 * prefix (same pattern as `proctorAssignments.admin.ts`).
 */
export const adminTeacherAssignmentRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  await registerAdminTeacherAssignmentRoutes(fastify);
};
