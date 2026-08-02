/**
 * E2E test-only fixture routes (J4-I1B review fix).
 *
 * Registered ONLY on E2E-configured servers: `APP_MODE=e2e` (CI +
 * docker-compose.test.yml + scripts/e2e/run-wsl.sh). NEVER enabled in a bare
 * `pnpm dev` or in production — in particular `RATE_LIMIT_DISABLED=1` (a valid
 * production config that merely turns off app-level rate limiting) does NOT
 * activate these routes.
 *
 * The Proctor-to-Exam assignment HTTP API ships in M11-I1C (PR C); until then
 * the E2E specs need a test-data channel to create the active assignments the
 * J4-I1B runtime gate (`exam_proctor_assignments`, ADR-015 §4.3) requires.
 * This fixture is that channel: admin-only, and it runs the SAME domain
 * command (`assignProctorToExam`) a production route will run — validation,
 * idempotency receipt, and audit included — so the E2E path exercises the
 * real state transition, not a raw row insert.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Permission, Role } from "@exam/authz";
import { ErrorResponseSchema } from "@exam/contracts";
import type { RequestContext } from "@exam/domain";
import type { TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import {
  assignProctorToExam,
  type ProctorAssignmentRepo,
} from "@exam/exam-engine";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

const proctorAssignmentFixtureSchema = z.object({
  examId: z.string().uuid(),
  proctorUserId: z.string().uuid(),
});

const proctorAssignmentFixtureResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  status: z.literal("active"),
  outcome: z.enum(["applied", "no_change", "idempotent_replayed"]),
});

/** Per-transaction audit callback for the assign command (atomic receipt). */
function makeAssignmentAudit(
  tx: TransactionDatabase,
  request: FastifyRequest,
  ctx: RequestContext,
) {
  return async (action: string, metadata: Record<string, unknown>) => {
    await recordAtomicHttpAudit(tx as never, request as never, ctx as never, {
      action: action as never,
      targetType: "proctor_assignment",
      targetId: metadata.assignmentId as string,
      metadata,
    });
  };
}

const e2eFixtureRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/e2e-fixtures/proctor-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        body: proctorAssignmentFixtureSchema,
        response: {
          201: proctorAssignmentFixtureResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = proctorAssignmentFixtureSchema.parse(request.body);
      const ctx = ensureTargetOrg(getRequestContext(request));
      const now = fastify.now();
      const result = await executeInTransaction(fastify.db, async (tx) => {
        const repo = createProctorAssignmentRepo(
          tx,
        ) as unknown as ProctorAssignmentRepo;
        return assignProctorToExam(
          repo,
          ctx,
          {
            operationId: randomUUID(),
            examId: body.examId,
            proctorUserId: body.proctorUserId,
          },
          {
            now,
            audit: makeAssignmentAudit(tx, request, ctx),
            lookupExam: async (examId) => {
              const exam = await createExamRepo(tx).findById(ctx, examId);
              return exam
                ? { organizationId: exam.organizationId, id: exam.id }
                : null;
            },
            lookupProctorUser: async (userId) => {
              const user = await createUserRepo(tx).findById(ctx, userId);
              if (!user) return null;
              const activeRoles = await createUserRoleAssignmentRepo(
                tx,
              ).listActiveForUser(ctx, userId);
              return {
                organizationId: user.organizationId,
                isActive: user.isActive,
                hasActiveProctorRole: activeRoles.some(
                  (a) => a.role === Role.Proctor,
                ),
              };
            },
          },
        );
      });
      return reply.code(201).send({
        assignmentId: result.assignment.id,
        status: result.assignment.status,
        outcome: result.outcome,
      });
    },
  );
};

export default e2eFixtureRoutes;
