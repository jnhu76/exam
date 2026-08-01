import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { NotFoundError } from "@exam/domain";
import type { IncidentActionType } from "@exam/domain";
import { Permission } from "@exam/authz";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { TransactionDatabase } from "@exam/db/src/types.js";
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
import { withIncidentOperationRecovery } from "../orchestrators/incidentOperationRecovery.js";
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
  description: z.string().trim().min(1).max(1000),
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
  body: z.string().trim().min(1).max(500),
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
  resolutionSummary: z.string().trim().min(1).max(1000),
  reasonCode: z.string().max(100).optional().nullable(),
});

const DismissBodySchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reasonText: z.string().trim().min(1).max(1000),
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

/**
 * Trims and null-normalizes an optional string for canonical payload assembly.
 * Mirrors the engine's `normalizeString` so the route-built canonical payload
 * matches what the engine stores in the event.
 */
function norm(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

/**
 * Registers admin incident routes (ADR-014).
 *
 * J4-I1B (ADR-015 §8): every route is scope-gated via
 * `requireScopedCapability`. Exam-path routes (`/admin/exams/:examId/incidents`)
 * resolve through the Exam resolver; incident-path routes
 * (`/admin/incidents/:incidentId/...`) resolve through the NEW Incident→Exam
 * resolver (the incident's examId is server-derived from the authoritative
 * row, never from the request body). View/create/investigate routes carry
 * `proctorAccess = assignment_scoped` (Proctor assignment enforcement);
 * resolve/dismiss remain `admin_only` (terminal judgment) while staying
 * scoped for target existence, tenant, and parent-chain validation.
 */
export async function registerAdminIncidentRoutes(fastify: FastifyInstance) {
  // ── Create Incident ──
  fastify.post(
    "/admin/exams/:examId/incidents",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.IncidentCreate,
          "exam",
          "examId",
          { proctorAccess: "assignment_scoped" },
        ),
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
      const occurredAtCanonical = body.occurredAt
        ? new Date(body.occurredAt).toISOString()
        : null;
      const descriptionCanonical = body.description.trim();
      const severityCanonical = body.severity ?? "info";

      // Canonical payload mirrors the engine's stored event payload so the
      // recovery wrapper's fresh-transaction lookup compares byte-identically.
      const canonicalPayload = {
        examId,
        attemptId: body.attemptId ?? null,
        candidateId: body.candidateId ?? null,
        type: body.type,
        severity: severityCanonical,
        occurredAt: occurredAtCanonical,
        description: descriptionCanonical,
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "createExamIncident",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
              severity: severityCanonical,
              occurredAt: body.occurredAt ?? null,
              description: body.description,
            },
            {
              now,
              audit,
              lookupExam: async (eid) => {
                const exam = await createExamRepo(tx).findById(ctx, eid);
                return exam
                  ? { organizationId: exam.organizationId, id: exam.id }
                  : null;
              },
              lookupAttempt: async (aid) => {
                const attempt = await createAttemptRepo(tx).findById(ctx, aid);
                return attempt
                  ? {
                      examId: attempt.examId,
                      candidateId: attempt.candidateId,
                      organizationId: attempt.organizationId,
                    }
                  : null;
              },
              lookupEnrollment: async (eid, candidateId) => {
                const enrollment = await createEnrollmentRepo(
                  tx,
                ).findByExamAndCandidate(ctx, eid, candidateId);
                return enrollment != null;
              },
            },
          );
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentView,
          "exam",
          "examId",
          { proctorAccess: "assignment_scoped" },
        ),
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
        fastify.requireScopedCapability(
          Permission.IncidentView,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = {
        incidentId,
        expectedVersion: body.expectedVersion,
        reasonCode: norm(body.reasonCode),
        reasonText: norm(body.reasonText),
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "startIncidentInvestigation",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = { incidentId, body: body.body.trim() };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "addIncidentNote",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
          const repo = createIncidentRepo(tx);
          const audit = makeAudit(tx, request, ctx, incidentId);

          return addIncidentNote(
            repo as unknown as IncidentRepo,
            ctx,
            incidentId,
            { operationId: body.operationId, body: body.body },
            { now, audit },
          );
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = {
        incidentId,
        expectedVersion: body.expectedVersion,
        severity: body.severity,
        reasonCode: norm(body.reasonCode),
        reasonText: norm(body.reasonText),
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "changeIncidentSeverity",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentResolve,
          "incident",
          "incidentId",
        ),
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

      const canonicalPayload = {
        incidentId,
        expectedVersion: body.expectedVersion,
        resolutionSummary: body.resolutionSummary.trim(),
        reasonCode: norm(body.reasonCode),
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "resolveExamIncident",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentResolve,
          "incident",
          "incidentId",
        ),
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

      const canonicalPayload = {
        incidentId,
        expectedVersion: body.expectedVersion,
        reasonText: body.reasonText.trim(),
        reasonCode: norm(body.reasonCode),
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "dismissExamIncident",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = {
        incidentId,
        actionType: body.actionType,
        actionId: body.actionId,
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "linkIncidentAction",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
              lookupActionLink: async (
                actionType: string,
                actionId: string,
              ) => {
                const existing = await repo.findActionLinkByAction(
                  ctx,
                  actionType as IncidentActionType,
                  actionId,
                );
                return existing != null;
              },
            },
          );
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = {
        incidentId,
        attemptId: body.attemptId,
        relationshipType: body.relationshipType,
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "linkIncidentAttempt",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
        },
      );

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
        fastify.requireScopedCapability(
          Permission.IncidentInvestigate,
          "incident",
          "incidentId",
          { proctorAccess: "assignment_scoped" },
        ),
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

      const canonicalPayload = {
        incidentId,
        interruptionId: body.interruptionId,
      };

      const result = await withIncidentOperationRecovery(
        fastify.db,
        ctx,
        body.operationId,
        "linkIncidentInterruption",
        canonicalPayload,
        async (tx: TransactionDatabase) => {
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
                const episode = await createAttemptInterruptionRepo(
                  tx,
                ).findById(ctx, interruptionId);
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
        },
      );

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
