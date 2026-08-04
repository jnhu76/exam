import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { NotFoundError } from "@exam/domain";
import type { IncidentActionType } from "@exam/domain";
import { Permission, type PermissionKey } from "@exam/authz";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import {
  createRecoveryRepo,
  type IncidentAllowedAction,
  type IncidentQueueCursor,
} from "@exam/db/src/repository/recoveryRepo.js";
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
  computeEffectiveDeadline,
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

// ── Recovery Incident Queue (J5-I1A1, contract §5.4) ──

/**
 * Wire format of the keyset cursor: `"<createdAtISO>|<id>"`. This is the ONLY
 * place an untrusted cursor string is trusted — `parseRecoveryCursor`
 * validates it to a structured {@link IncidentQueueCursor} so the repo never
 * re-parses raw external input (an invalid date / wrong shape surfaces as the
 * same 400 VALIDATION_ERROR every other request-validation failure produces).
 *
 * The createdAt half is the DB-exact timestamp text (up to microsecond
 * precision, produced by the repo's SQL projection): JS `Date` only carries
 * milliseconds, so a Date round-trip would truncate sub-millisecond values
 * and skip rows on the next page (pagination gap). The text is cast straight
 * back to `timestamptz` in SQL.
 */
const RECOVERY_CURSOR_MAX_LENGTH = 200;

function parseRecoveryCursor(raw: string): IncidentQueueCursor {
  const parts = raw.split("|");
  if (parts.length !== 2) {
    throw new Error("cursor must be `<createdAtISO>|<id>`");
  }
  // Strict wire validation: canonical ISO datetime (1–6 fractional digits)
  // + UUID. The cursor is produced by encodeRecoveryCursor (DB-exact
  // timestamp text + id), so any other shape is a client error — never a
  // repo concern.
  const createdAt = z.string().datetime().safeParse(parts[0]!);
  const id = z.string().uuid().safeParse(parts[1]!);
  if (!createdAt.success || !id.success) {
    throw new Error(
      "cursor must be `<createdAtISO>|<id>` with an ISO datetime and a UUID id",
    );
  }
  return { createdAtExact: createdAt.data, id: id.data };
}

const RecoveryCursorWireSchema = z
  .string()
  .max(RECOVERY_CURSOR_MAX_LENGTH)
  .refine((raw) => {
    try {
      parseRecoveryCursor(raw);
      return true;
    } catch {
      return false;
    }
  }, "cursor must be a valid `<createdAtISO>|<id>` keyset cursor");

function encodeRecoveryCursor(
  cursor: IncidentQueueCursor | null,
): string | null {
  return cursor ? `${cursor.createdAtExact}|${cursor.id}` : null;
}

// Strict filter enums — invalid values are rejected at the API boundary as
// 400 VALIDATION_ERROR, never pushed into a PostgreSQL comparison.
const RecoveryStatusQuerySchema = z.enum([
  "open",
  "investigating",
  "resolved",
  "dismissed",
]);
const RecoverySeverityQuerySchema = z.enum([
  "info",
  "minor",
  "major",
  "critical",
]);
const RecoveryIncidentTypeQuerySchema = z.enum([
  "network_interruption",
  "device_failure",
  "power_failure",
  "candidate_unable_to_continue",
  "suspected_misconduct",
  "operator_error",
  "system_outage",
  "environmental_disruption",
  "other",
]);
// z.coerce.boolean() would turn the non-empty string "false" into true;
// explicit parsing keeps `?unresolvedOnly=false` actually false. The union
// with z.boolean() makes the schema idempotent: Fastify validates the raw
// querystring and writes the transformed output back onto request.query, so
// the route's re-parse must accept the already-transformed value.
const RecoveryBooleanQuerySchema = z
  .union([z.enum(["true", "false"]), z.boolean()])
  .transform((value) => value === true || value === "true");
// Same idempotency for datetimes (raw ISO string → Date on the first parse).
const RecoveryDatetimeQuerySchema = z
  .union([z.string().datetime(), z.date()])
  .optional()
  .transform((v) => (v instanceof Date ? v : v ? new Date(v) : undefined));

// Resource IDs are authoritative TEXT columns (exams.id, candidate_profiles.id,
// users.id are `text`) — the queue must accept the same legal IDs the rest of
// the API accepts, not just UUIDs. Only attemptId is UUID-authoritative
// (proctor monitoring + incident creation schemas). proctorUserId bounds
// mirror proctorAssignments.admin.ts (min(1).max(128)).
const RecoveryIdQuerySchema = z.string().min(1).max(128);

const RecoveryListQuerySchema = z
  .object({
    examId: RecoveryIdQuerySchema.optional(),
    candidateId: RecoveryIdQuerySchema.optional(),
    attemptId: z.string().uuid().optional(),
    status: RecoveryStatusQuerySchema.optional(),
    severity: RecoverySeverityQuerySchema.optional(),
    incidentType: RecoveryIncidentTypeQuerySchema.optional(),
    createdFrom: RecoveryDatetimeQuerySchema,
    createdTo: RecoveryDatetimeQuerySchema,
    unresolvedOnly: RecoveryBooleanQuerySchema.optional(),
    assignedProctorUserId: RecoveryIdQuerySchema.optional(),
    cursor: RecoveryCursorWireSchema.optional().nullable(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .superRefine((query, ctx) => {
    if (
      query.createdFrom &&
      query.createdTo &&
      query.createdFrom.getTime() > query.createdTo.getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["createdFrom"],
        message: "createdFrom must not be after createdTo",
      });
    }
  });

const RecoveryExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
});

const RecoveryAttemptSummarySchema = z.object({
  id: z.string(),
  candidateId: z.string().nullable(),
  status: z.string(),
  deadlineAt: z.string().nullable(),
});

const RecoveryCandidateSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

const RecoveryProctorSummarySchema = z.object({
  userId: z.string(),
  displayName: z.string(),
});

const RecoveryQueueItemSchema = z.object({
  incident: IncidentResponseSchema,
  examSummary: RecoveryExamSummarySchema,
  primaryAttempt: RecoveryAttemptSummarySchema.nullable(),
  primaryCandidate: RecoveryCandidateSummarySchema.nullable(),
  linkedAttemptCount: z.number().int().nonnegative(),
  linkedCandidateCount: z.number().int().nonnegative(),
  activeProctors: z.array(RecoveryProctorSummarySchema),
});

const RecoveryListResponseSchema = z.object({
  items: z.array(RecoveryQueueItemSchema),
  nextCursor: z.string().nullable(),
});

// ── Recovery Incident Aggregate Detail (J5-I1A2, contract §6.3) ──

const RecoveryAggregateEventSchema = z.object({
  id: z.string().uuid(),
  eventSequence: z.number().int(),
  eventType: z.string(),
  commandType: z.string(),
  operationId: z.string().uuid(),
  actorId: z.string().nullable(),
  beforeVersion: z.number().int(),
  afterVersion: z.number().int(),
  payload: z.unknown(),
  createdAt: z.string(),
});

const RecoveryAggregateNoteSchema = z.object({
  operationId: z.string().uuid(),
  actorId: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

const RecoveryAggregateActionSchema = z.object({
  id: z.string().uuid(),
  actionType: z.string(),
  actionId: z.string(),
  attemptId: z.string(),
  actorId: z.string().nullable(),
  operationId: z.string().uuid(),
  linkedAt: z.string(),
});

const RecoveryAggregateAttemptMembershipSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string(),
  relationshipType: z.string(),
  linkedAt: z.string(),
  linkedBy: z.string(),
  operationId: z.string().uuid(),
});

const RecoveryAggregateInterruptionLinkSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string(),
  interruptionId: z.string().uuid(),
  linkedAt: z.string(),
  linkedBy: z.string(),
  operationId: z.string().uuid(),
});

const RecoveryAggregateCandidateSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/**
 * Aggregate Attempt summary carries the EFFECTIVE deadline, not the raw
 * `examAttempts.deadlineAt`. The effective deadline is the canonical
 * `min(exam.closeAt, attempt.deadlineAt)` (null deadlineAt → exam.closeAt),
 * computed server-side via `computeEffectiveDeadline` (contract §6.2 / §6.3:
 * the frontend MUST NOT derive it). Renaming the field from `deadlineAt`
 * makes the semantics explicit instead of carrying raw deadlineAt under a
 * name that implies effective-time semantics.
 *
 * Non-nullable on the wire: the repo fails closed (503 AUTHZ_UNAVAILABLE)
 * whenever `exam.closeAt` is null, so every successful response carries a
 * computable effective deadline.
 */
const RecoveryAggregateAttemptSummarySchema = z.object({
  id: z.string(),
  candidateId: z.string().nullable(),
  status: z.string(),
  effectiveDeadlineAt: z.string(),
});

/**
 * Aggregate Exam summary carries `closeAt` so the route can compute the
 * effective deadline via the canonical helper. It is NOT exposed on the
 * queue Exam summary (which is a list-row projection, not a deadline
 * authority).
 *
 * Non-nullable on the wire: the repo fails closed (503 AUTHZ_UNAVAILABLE)
 * when closeAt is null (timed_window invariant), so a successful response
 * always carries it.
 */
const RecoveryAggregateExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  closeAt: z.string(),
});

const RecoveryAggregateTimeAdjustmentSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  addedSeconds: z.number().int(),
  reasonCode: z.string().nullable(),
  operationId: z.string(),
  createdAt: z.string(),
});

const RecoveryAggregateAuditReferenceSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

const RecoveryAllowedActionSchema = z.enum([
  "investigate",
  "add_note",
  "change_severity",
  "resolve",
  "dismiss",
  "link_action",
  "link_attempt",
  "link_interruption",
]);

const RecoveryAggregateResponseSchema = z.object({
  incident: IncidentResponseSchema,
  examSummary: RecoveryAggregateExamSummarySchema,
  events: z.array(RecoveryAggregateEventSchema),
  notes: z.array(RecoveryAggregateNoteSchema),
  actions: z.array(RecoveryAggregateActionSchema),
  attemptMemberships: z.array(RecoveryAggregateAttemptMembershipSchema),
  interruptionLinks: z.array(RecoveryAggregateInterruptionLinkSchema),
  candidateSummaries: z.array(RecoveryAggregateCandidateSummarySchema),
  attemptSummaries: z.array(RecoveryAggregateAttemptSummarySchema),
  timeAdjustmentSummaries: z.array(RecoveryAggregateTimeAdjustmentSchema),
  auditReferences: z.array(RecoveryAggregateAuditReferenceSchema),
  allowedActions: z.array(RecoveryAllowedActionSchema),
  snapshotAt: z.string(),
});

/**
 * Final per-caller allowed actions (J5-R0 §6.2 / §6.3).
 *
 * action eligibility = status candidate ∩ capability ∩ resource scope ∩
 * incident shape. The repo computes ONLY the status candidates
 * (`statusActionCandidates`, ADR-014 §3); this route-level derivation
 * intersects them with:
 *
 *   - capability: `incident.investigate` gates investigate / add_note /
 *     change_severity / link_action / link_attempt / link_interruption;
 *     `incident.resolve` gates resolve / dismiss (a caller holding only
 *     `incident.recovery.view` sees no action at all);
 *   - incident shape: an anchored Incident (attemptId set) never exposes
 *     `link_attempt` — ADR-014 §2 makes anchor and membership mutually
 *     exclusive, so the membership-write action is structurally impossible.
 *
 * The frontend MUST NOT derive eligibility from status alone (§6.2); a
 * disabled button is a UX convenience, never an authorization (§8.2).
 */
export function deriveAllowedActionsForCaller(input: {
  statusActionCandidates: IncidentAllowedAction[];
  capabilities: readonly PermissionKey[];
  incidentAttemptId: string | null;
}): IncidentAllowedAction[] {
  const { statusActionCandidates, capabilities, incidentAttemptId } = input;
  const has = (permission: PermissionKey) => capabilities.includes(permission);
  const INVESTIGATE_ACTIONS: readonly IncidentAllowedAction[] = [
    "investigate",
    "add_note",
    "change_severity",
    "link_action",
    "link_attempt",
    "link_interruption",
  ];
  const RESOLVE_ACTIONS: readonly IncidentAllowedAction[] = [
    "resolve",
    "dismiss",
  ];
  return statusActionCandidates.filter((action) => {
    if (
      INVESTIGATE_ACTIONS.includes(action) &&
      !has(Permission.IncidentInvestigate)
    ) {
      return false;
    }
    if (RESOLVE_ACTIONS.includes(action) && !has(Permission.IncidentResolve)) {
      return false;
    }
    if (action === "link_attempt" && incidentAttemptId != null) return false;
    return true;
  });
}

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

  // ── Recovery Incident Queue (J5-I1A1, contract §5.4) ──
  //
  // Organization-wide Admin-only Recovery Center queue. `IncidentRecoveryView`
  // is granted ONLY to Admin (catalog.ts / presets.ts); the flat
  // `requireCapability` gate is the runtime authority. Registry metadata
  // records `scope: Organization, resolver: organization, proctorAccess:
  // admin_only` per contract §5.4 — a Proctor with `incident.view` + an active
  // Exam assignment is STILL denied (the Recovery queue is not the runtime
  // incident surface, contract §15 adjudication).
  fastify.get(
    "/admin/recovery/incidents",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentRecoveryView),
      ],
      schema: {
        querystring: RecoveryListQuerySchema,
        ...{ security: cookieAuth },
        "x-role": ["Admin"],
        response: {
          200: RecoveryListResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          // Broken parent chain (incident whose exam is not resolvable in-org)
          // fails closed as 503 AUTHZ_UNAVAILABLE — declared so the OpenAPI
          // contract documents the deliberately-designed response.
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = RecoveryListQuerySchema.parse(request.query ?? {});
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createRecoveryRepo(fastify.db);

      const { items, nextCursor } = await repo.listIncidentQueue(ctx, {
        limit: query.limit,
        cursor: query.cursor ? parseRecoveryCursor(query.cursor) : null,
        examId: query.examId ?? null,
        candidateId: query.candidateId ?? null,
        attemptId: query.attemptId ?? null,
        status: query.status ?? null,
        severity: query.severity ?? null,
        incidentType: query.incidentType ?? null,
        createdFrom: query.createdFrom ?? null,
        createdTo: query.createdTo ?? null,
        unresolvedOnly: query.unresolvedOnly ?? null,
        assignedProctorUserId: query.assignedProctorUserId ?? null,
      });

      return reply.send(
        RecoveryListResponseSchema.parse({
          items: items.map((item) => ({
            incident: toIncidentResponse(item.incident),
            examSummary: item.examSummary,
            primaryAttempt: item.primaryAttempt
              ? {
                  id: item.primaryAttempt.id,
                  candidateId: item.primaryAttempt.candidateId,
                  status: item.primaryAttempt.status,
                  deadlineAt:
                    item.primaryAttempt.deadlineAt?.toISOString() ?? null,
                }
              : null,
            primaryCandidate: item.primaryCandidate,
            linkedAttemptCount: item.linkedAttemptCount,
            linkedCandidateCount: item.linkedCandidateCount,
            activeProctors: item.activeProctors,
          })),
          nextCursor: encodeRecoveryCursor(nextCursor),
        }),
      );
    },
  );

  // ── Recovery Incident Aggregate Detail (J5-I1A2, contract §6.3) ──
  //
  // Admin-only authoritative aggregate projection. `IncidentRecoveryView` is
  // granted ONLY to Admin (catalog.ts / presets.ts), so the flat
  // `requireCapability` gate is the runtime authority — a Proctor with
  // incident.view + active assignment is STILL denied (proctorAccess:
  // admin_only per contract §6.3). Contract §6.3 (amended by this PR):
  // the Recovery aggregate is an org-wide Admin READ MODEL — the same
  // scope/resolver shape as the queue (§5.4) — so the repo owns ALL
  // fail-closed scope validation (org boundary + full relationship graph)
  // and surfaces broken parent/relationship chains as 503 AUTHZ_UNAVAILABLE,
  // missing/cross-org as 404 — the same contract the sibling queue route
  // (flat gate) uses. The read comes from ONE consistent REPEATABLE READ
  // read-only snapshot inside the repo; the frontend never multi-fetches.
  // `allowedActions` is the per-caller intersection (status candidates ∩
  // capabilities ∩ incident shape) computed in this handler.
  fastify.get(
    "/admin/recovery/incidents/:incidentId",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.IncidentRecoveryView),
      ],
      schema: {
        params: IncidentIdParamsSchema,
        ...{ security: cookieAuth },
        "x-role": ["Admin"],
        response: {
          200: RecoveryAggregateResponseSchema,
          // Declared so the OpenAPI contract documents the deliberately-
          // designed responses: 400 (validation), 401 (auth), 403 (capability),
          // 404 (resolver fail-closed / anti-enumeration), 503 (broken
          // parent/relationship chain — fail-closed AUTHZ_UNAVAILABLE).
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = IncidentIdParamsSchema.parse(request.params);
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createRecoveryRepo(fastify.db);

      const aggregate = await repo.getIncidentAggregate(ctx, params.incidentId);
      // Missing or cross-org incident → repo returns null (org-scoped lookup
      // fails closed) → 404 RESOURCE_NOT_FOUND, the same anti-enumeration
      // shape the queue list uses. Broken parent/relationship chains throw
      // AuthzUnavailableError (503) from the repo.
      if (!aggregate) throw new NotFoundError("Incident not found");

      // Effective deadline = canonical min(exam.closeAt, attempt.deadlineAt),
      // with null attempt deadlineAt → exam.closeAt. Computed here (not in
      // the repo, which is forbidden from importing @exam/exam-engine) via the
      // single canonical authority. The repo guarantees examSummary.closeAt is
      // non-null (it fails closed with AUTHZ_UNAVAILABLE otherwise), so the
      // minimal projections below are safe: computeEffectiveDeadline reads
      // only `exam.closeAt` and `attempt.deadlineAt`.
      const examForDeadline = {
        closeAt: aggregate.examSummary.closeAt,
      };

      // Final per-caller allowedActions (J5-R0 §6.2 / §6.3): the repo's
      // status candidates ∩ this caller's capabilities ∩ incident shape. The
      // frontend never derives eligibility from status alone.
      const allowedActions = deriveAllowedActionsForCaller({
        statusActionCandidates: aggregate.statusActionCandidates,
        capabilities: ctx.capabilities,
        incidentAttemptId: aggregate.incident.attemptId,
      });

      return reply.send(
        RecoveryAggregateResponseSchema.parse({
          incident: toIncidentResponse(aggregate.incident),
          examSummary: {
            id: aggregate.examSummary.id,
            title: aggregate.examSummary.title,
            status: aggregate.examSummary.status,
            closeAt: aggregate.examSummary.closeAt.toISOString(),
          },
          events: aggregate.events.map((e) => ({
            ...e,
            createdAt: e.createdAt.toISOString(),
          })),
          notes: aggregate.notes.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
          })),
          actions: aggregate.actions.map((a) => ({
            ...a,
            linkedAt: a.linkedAt.toISOString(),
          })),
          attemptMemberships: aggregate.attemptMemberships.map((m) => ({
            ...m,
            linkedAt: m.linkedAt.toISOString(),
          })),
          interruptionLinks: aggregate.interruptionLinks.map((l) => ({
            ...l,
            linkedAt: l.linkedAt.toISOString(),
          })),
          candidateSummaries: aggregate.candidateSummaries,
          attemptSummaries: aggregate.attemptSummaries.map((a) => ({
            id: a.id,
            candidateId: a.candidateId,
            status: a.status,
            effectiveDeadlineAt: computeEffectiveDeadline(examForDeadline, {
              deadlineAt: a.deadlineAt,
            }).toISOString(),
          })),
          timeAdjustmentSummaries: aggregate.timeAdjustmentSummaries.map(
            (t) => ({ ...t, createdAt: t.createdAt.toISOString() }),
          ),
          auditReferences: aggregate.auditReferences.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
          })),
          allowedActions,
          snapshotAt: aggregate.snapshotAt.toISOString(),
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
