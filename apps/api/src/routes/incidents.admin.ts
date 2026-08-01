import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { NotFoundError } from "@exam/domain";
import { Permission } from "@exam/authz";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import {
  executeInTransaction,
  type Database,
  type TransactionDatabase,
} from "@exam/db/src/types.js";
import {
  createExamIncident,
  startIncidentInvestigation,
  addIncidentNote,
  changeIncidentSeverity,
  resolveExamIncident,
  dismissExamIncident,
  linkIncidentAction,
  linkIncidentAttempt,
  linkIncidentInterruption,
} from "@exam/exam-engine";
import type { IncidentRepo } from "@exam/exam-engine";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

// ── Zod Schemas ──

const IncidentIdParamsSchema = z.object({ incidentId: z.string().uuid() });
const ExamIdParamsSchema = z.object({ examId: z.string() });

const CreateIncidentBodySchema = z.object({
  operationId: z.string().uuid(),
  type: z.enum([
    "network_interruption",
    "device_failure",
    "power_failure",
    "candidate_unable_to_continue",
    "suspected_misconduct",
    "operator_error",
    "system_outage",
    "environmental_disruption",
    "other",
  ]),
  description: z.string().min(1).max(1000),
  attemptId: z.string().uuid().optional().nullable(),
  candidateId: z.string().optional().nullable(),
  severity: z.enum(["info", "minor", "major", "critical"]).optional(),
  occurredAt: z.string().datetime().optional().nullable(),
});

const InvestigateBodySchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reasonCode: z.string().max(100).optional().nullable(),
  reasonText: z.string().max(1000).optional().nullable(),
});

const AddNoteBodySchema = z.object({
  operationId: z.string().uuid(),
  body: z.string().min(1).max(500),
});

const ChangeSeverityBodySchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  severity: z.enum(["info", "minor", "major", "critical"]),
  reasonCode: z.string().max(100).optional().nullable(),
  reasonText: z.string().max(1000).optional().nullable(),
});

const ResolveBodySchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  resolutionSummary: z.string().min(1).max(1000),
  reasonCode: z.string().max(100).optional().nullable(),
});

const DismissBodySchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reasonText: z.string().min(1).max(1000),
  reasonCode: z.string().max(100).optional().nullable(),
});

const LinkActionBodySchema = z.object({
  operationId: z.string().uuid(),
  actionType: z.enum(["time_grant", "force_submit"]),
  actionId: z.string(),
});

const LinkAttemptBodySchema = z.object({
  operationId: z.string().uuid(),
  attemptId: z.string(),
  relationshipType: z.enum(["affected", "referenced"]),
});

const LinkInterruptionBodySchema = z.object({
  operationId: z.string().uuid(),
  interruptionId: z.string().uuid(),
});

// ── Response Schemas ──

const IncidentResponseSchema = z.object({
  id: z.string().uuid(),
  examId: z.string(),
  attemptId: z.string().nullable(),
  candidateId: z.string().nullable(),
  type: z.string(),
  severity: z.string(),
  status: z.string(),
  occurredAt: z.string().nullable(),
  description: z.string(),
  resolutionSummary: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  reportedBy: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const IncidentWriteResponseSchema = z.object({
  outcome: z.enum(["applied", "idempotent_replayed"]),
  incident: IncidentResponseSchema,
});

const IncidentListResponseSchema = z.object({
  incidents: z.array(IncidentResponseSchema),
});

// ── Helpers ──

function toIncidentResponse(incident: {
  id: string;
  examId: string;
  attemptId: string | null;
  candidateId: string | null;
  type: string;
  severity: string;
  status: string;
  occurredAt: Date | null;
  description: string;
  resolutionSummary: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  reportedBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: incident.id,
    examId: incident.examId,
    attemptId: incident.attemptId,
    candidateId: incident.candidateId,
    type: incident.type,
    severity: incident.severity,
    status: incident.status,
    occurredAt: incident.occurredAt?.toISOString() ?? null,
    description: incident.description,
    resolutionSummary: incident.resolutionSummary,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    resolvedBy: incident.resolvedBy,
    reportedBy: incident.reportedBy,
    version: incident.version,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}

/** Build a per-route audit callback for use inside transactions. */
function makeAudit(
  tx: unknown,
  request: { id: string },
  ctx: { organizationId: string; actorId: string },
  incidentId: string,
) {
  return async (action: string, metadata: Record<string, unknown>) => {
    // Use metadata.incidentId if available (for create), otherwise the passed incidentId
    const targetId = (metadata.incidentId as string) || incidentId;
    await recordAtomicHttpAudit(tx as never, request as never, ctx as never, {
      action: action as never,
      targetType: "incident",
      targetId,
      metadata,
    });
  };
}

/** Operation-unique index on `exam_incident_events` (ADR-014 idempotency arbiter). */
const INCIDENT_OPERATION_UNIQUE_CONSTRAINT =
  "exam_incident_events_org_operation_unique";

/**
 * Walks the error cause chain for the incident event operation-unique 23505.
 * Mirrors `matchOrgOperationUniqueViolation` in operatorGrantExecution
 * (postgres-js surfaces the constraint as `constraint_name` on the cause).
 */
function isIncidentOperationUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        const constraint = String(e.constraint ?? e.constraint_name ?? "");
        if (constraint === INCIDENT_OPERATION_UNIQUE_CONSTRAINT) {
          return true;
        }
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

/**
 * Runs an incident command in a transaction; on the operation-unique 23505
 * re-runs the SAME command once in a FRESH transaction (the aborted primary
 * transaction cannot be queried — postgres.js surfaces 25P02). The fresh
 * transaction's pre-read resolves the winner's committed event to
 * `idempotent_replayed`, or throws `IdempotencyConflictError`. Every other
 * error propagates unchanged; recovery happens at most once.
 */
async function withOperationRaceRecovery<T>(
  db: Database,
  fn: (tx: TransactionDatabase) => Promise<T>,
): Promise<T> {
  try {
    return await executeInTransaction(db, fn);
  } catch (err: unknown) {
    if (!isIncidentOperationUniqueViolation(err)) throw err;
    return await executeInTransaction(db, fn);
  }
}

/**
 * Registers admin incident routes (ADR-014).
 * All routes are gated by incident.* permissions using flat requireCapability.
 */
export async function registerAdminIncidentRoutes(fastify: FastifyInstance) {
  // ── Create Incident ──
  fastify.post(
    "/admin/exams/:examId/incidents",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentCreate),
      ],
      schema: {
        params: ExamIdParamsSchema,
        body: CreateIncidentBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = ExamIdParamsSchema.parse(request.params);
      const body = CreateIncidentBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, "pending");

        return createExamIncident(
          repo as unknown as IncidentRepo,
          ctx,
          {
            operationId: body.operationId,
            examId,
            attemptId: body.attemptId ?? null,
            candidateId: body.candidateId ?? null,
            type: body.type,
            severity: body.severity ?? "info",
            occurredAt: body.occurredAt ?? null,
            description: body.description,
          },
          {
            now,
            audit,
          },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── List Incidents ──
  fastify.get(
    "/admin/exams/:examId/incidents",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentView),
      ],
      schema: {
        params: ExamIdParamsSchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentListResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = ExamIdParamsSchema.parse(request.params);
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createIncidentRepo(fastify.db);

      const incidents = await repo.listByExam(ctx, params.examId);

      return reply.send(
        IncidentListResponseSchema.parse({
          incidents: incidents.map(toIncidentResponse),
        }),
      );
    },
  );

  // ── Get Incident ──
  fastify.get(
    "/admin/incidents/:incidentId",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentView),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createIncidentRepo(fastify.db);

      const incident = await repo.findById(ctx, params.incidentId);
      if (!incident) throw new NotFoundError("Incident not found");

      return reply.send(toIncidentResponse(incident));
    },
  );

  // ── Investigate ──
  fastify.post(
    "/admin/incidents/:incidentId/investigate",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: InvestigateBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = InvestigateBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return startIncidentInvestigation(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            expectedVersion: body.expectedVersion,
            reasonCode: body.reasonCode ?? null,
            reasonText: body.reasonText ?? null,
          },
          { now, audit },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Add Note ──
  fastify.post(
    "/admin/incidents/:incidentId/notes",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: AddNoteBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = AddNoteBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return addIncidentNote(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          { operationId: body.operationId, body: body.body },
          { now, audit },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Change Severity ──
  fastify.post(
    "/admin/incidents/:incidentId/severity",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: ChangeSeverityBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = ChangeSeverityBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return changeIncidentSeverity(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            expectedVersion: body.expectedVersion,
            severity: body.severity,
            reasonCode: body.reasonCode ?? null,
            reasonText: body.reasonText ?? null,
          },
          { now, audit },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Resolve ──
  fastify.post(
    "/admin/incidents/:incidentId/resolve",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentResolve),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: ResolveBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = ResolveBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return resolveExamIncident(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            expectedVersion: body.expectedVersion,
            resolutionSummary: body.resolutionSummary,
            reasonCode: body.reasonCode ?? null,
          },
          { now, audit },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Dismiss ──
  fastify.post(
    "/admin/incidents/:incidentId/dismiss",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentResolve),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: DismissBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = DismissBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return dismissExamIncident(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            expectedVersion: body.expectedVersion,
            reasonText: body.reasonText,
            reasonCode: body.reasonCode ?? null,
          },
          { now, audit },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Link Action ──
  fastify.post(
    "/admin/incidents/:incidentId/actions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: LinkActionBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = LinkActionBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return linkIncidentAction(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            actionType: body.actionType,
            actionId: body.actionId,
          },
          {
            now,
            audit,
            lookupAdjustmentAttempt: async (adjustmentId: string) => {
              const adjustment = await createAttemptTimeAdjustmentRepo(
                tx,
              ).findById(ctx, adjustmentId);
              return adjustment?.attemptId ?? null;
            },
            lookupForceSubmitAudit: async (attemptId: string) => {
              const rows = await createAuditLogRepo(tx).listByTarget(
                ctx,
                "attempt",
                attemptId,
              );
              return rows.some(
                (r) => r.auditLog.action === "attempt.forceSubmit",
              );
            },
            lookupAttempt: async (aid: string) => {
              const attempt = await createAttemptRepo(tx).findById(ctx, aid);
              return attempt
                ? {
                    examId: attempt.examId,
                    candidateId: attempt.candidateId,
                    organizationId: attempt.organizationId,
                  }
                : null;
            },
            lookupActionLink: async (actionType: string, actionId: string) => {
              const existing = await repo.findActionLinkByAction(
                ctx,
                actionType,
                actionId,
              );
              return existing != null;
            },
          },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Link Attempt ──
  fastify.post(
    "/admin/incidents/:incidentId/attempts",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: LinkAttemptBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = LinkAttemptBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return linkIncidentAttempt(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            attemptId: body.attemptId,
            relationshipType: body.relationshipType,
          },
          {
            now,
            audit,
            lookupAttempt: async (aid: string) => {
              const attempt = await createAttemptRepo(tx).findById(ctx, aid);
              return attempt
                ? {
                    examId: attempt.examId,
                    candidateId: attempt.candidateId,
                    organizationId: attempt.organizationId,
                  }
                : null;
            },
          },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );

  // ── Link Interruption ──
  fastify.post(
    "/admin/incidents/:incidentId/interruptions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentInvestigate),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        body: LinkInterruptionBodySchema,
        ...{ security: cookieAuth },
        response: {
          200: IncidentWriteResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const body = LinkInterruptionBodySchema.parse(request.body ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { incidentId } = params;
      const now = fastify.now();

      const result = await withOperationRaceRecovery(fastify.db, async (tx) => {
        const repo = createIncidentRepo(tx);
        const audit = makeAudit(tx, request, ctx, incidentId);

        return linkIncidentInterruption(
          repo as unknown as IncidentRepo,
          ctx,
          incidentId,
          {
            operationId: body.operationId,
            interruptionId: body.interruptionId,
          },
          {
            now,
            audit,
            lookupInterruptionAttempt: async (interruptionId: string) => {
              const episode = await createAttemptInterruptionRepo(tx).findById(
                ctx,
                interruptionId,
              );
              return episode?.attemptId ?? null;
            },
            lookupAttempt: async (aid: string) => {
              const attempt = await createAttemptRepo(tx).findById(ctx, aid);
              return attempt
                ? {
                    examId: attempt.examId,
                    candidateId: attempt.candidateId,
                    organizationId: attempt.organizationId,
                  }
                : null;
            },
          },
        );
      });

      return reply.send(
        IncidentWriteResponseSchema.parse({
          outcome: result.outcome,
          incident: toIncidentResponse(result.incident),
        }),
      );
    },
  );
}

/**
 * Fastify plugin wrapper so incident routes inherit the shared `/api` prefix
 * (same pattern as `attempts.ts`).
 */
export const adminIncidentRoutes: FastifyPluginAsync = async (fastify) => {
  await registerAdminIncidentRoutes(fastify);
};
