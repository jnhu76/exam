import { z } from "zod";
import {
  AttemptStatus,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from "@exam/domain";
import {
  InterruptionTimePolicySchema,
  TimeAdjustmentSourceSchema,
} from "./interruption.js";

// ── Enum schemas (single source of truth: @exam/domain) ──
//
// `@exam/contracts` depends on `@exam/domain`, so the canonical enum value
// tuples are referenced (via `Object.values(...)`), never hand-copied. The
// tuple is cast to the KEYOF literal union (not `string`), so `z.infer`
// produces the exact literal union and `z.enum` stays closed at runtime. The
// closed `z.enum(...)` shapes then flow into every recovery wire schema below,
// so a CHECK-constraint value added upstream cannot drift into the contract.

type AttemptStatusValue = (typeof AttemptStatus)[keyof typeof AttemptStatus];
type IncidentStatusValue = (typeof IncidentStatus)[keyof typeof IncidentStatus];
type IncidentSeverityValue =
  (typeof IncidentSeverity)[keyof typeof IncidentSeverity];
type IncidentTypeValue = (typeof IncidentType)[keyof typeof IncidentType];

/** Closed Attempt lifecycle status (from {@link AttemptStatus}). */
export const RecoveryAttemptStatusSchema = z.enum(
  Object.values(AttemptStatus) as [AttemptStatusValue, ...AttemptStatusValue[]],
);

/** Closed Incident status (from {@link IncidentStatus}). */
export const RecoveryIncidentStatusSchema = z.enum(
  Object.values(IncidentStatus) as [
    IncidentStatusValue,
    ...IncidentStatusValue[],
  ],
);

/** Closed Incident severity (from {@link IncidentSeverity}). */
export const RecoveryIncidentSeveritySchema = z.enum(
  Object.values(IncidentSeverity) as [
    IncidentSeverityValue,
    ...IncidentSeverityValue[],
  ],
);

/** Closed Incident type (from {@link IncidentType}). */
export const RecoveryIncidentTypeSchema = z.enum(
  Object.values(IncidentType) as [IncidentTypeValue, ...IncidentTypeValue[]],
);

// ── Shared Incident wire (used by incident CRUD AND recovery surfaces) ──

/**
 * Canonical Incident response shape — the single wire authority for an
 * Incident row, consumed by both the incident CRUD routes and every Recovery
 * surface (queue item, aggregate detail). Enum fields are closed against the
 * `@exam/domain` tuples so the wire matches the CHECK constraints.
 */
export const IncidentResponseSchema = z.object({
  id: z.string().uuid(),
  examId: z.string(),
  attemptId: z.string().nullable(),
  candidateId: z.string().nullable(),
  type: RecoveryIncidentTypeSchema,
  severity: RecoveryIncidentSeveritySchema,
  status: RecoveryIncidentStatusSchema,
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

export type IncidentResponse = z.infer<typeof IncidentResponseSchema>;

// ── Recovery Incident Queue (J5-I1A1, contract §5.4) ──

export const RecoveryExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
});

export const RecoveryAttemptSummarySchema = z.object({
  id: z.string(),
  candidateId: z.string().nullable(),
  status: z.string(),
  deadlineAt: z.string().nullable(),
});

export const RecoveryCandidateSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

export const RecoveryProctorSummarySchema = z.object({
  userId: z.string(),
  displayName: z.string(),
});

export const RecoveryQueueItemSchema = z.object({
  incident: IncidentResponseSchema,
  examSummary: RecoveryExamSummarySchema,
  primaryAttempt: RecoveryAttemptSummarySchema.nullable(),
  primaryCandidate: RecoveryCandidateSummarySchema.nullable(),
  linkedAttemptCount: z.number().int().nonnegative(),
  linkedCandidateCount: z.number().int().nonnegative(),
  activeProctors: z.array(RecoveryProctorSummarySchema),
});

/**
 * Queue page response. `snapshotAt` is the PostgreSQL `transaction_timestamp()`
 * read INSIDE the queue's REPEATABLE READ transaction, so the page's staleness
 * indicator is anchored to the same server snapshot the rows came from —
 * consistent with the three detail surfaces (contract §6.3/§6.4/§6.5).
 */
export const RecoveryQueueResponseSchema = z.object({
  items: z.array(RecoveryQueueItemSchema),
  nextCursor: z.string().nullable(),
  snapshotAt: z.string(),
});

export type RecoveryQueueItem = z.infer<typeof RecoveryQueueItemSchema>;
export type RecoveryQueueResponse = z.infer<typeof RecoveryQueueResponseSchema>;

// ── Recovery Incident Aggregate Detail (J5-I1A2, contract §6.3) ──

export const RecoveryAggregateEventSchema = z.object({
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

export const RecoveryAggregateNoteSchema = z.object({
  operationId: z.string().uuid(),
  actorId: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export const RecoveryAggregateActionSchema = z.object({
  id: z.string().uuid(),
  actionType: z.enum(["time_grant", "force_submit"]),
  actionId: z.string(),
  attemptId: z.string(),
  actorId: z.string().nullable(),
  operationId: z.string().uuid(),
  linkedAt: z.string(),
});

export const RecoveryAggregateAttemptMembershipSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string(),
  relationshipType: z.enum(["affected", "referenced"]),
  linkedAt: z.string(),
  linkedBy: z.string(),
  operationId: z.string().uuid(),
});

export const RecoveryAggregateInterruptionLinkSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string(),
  interruptionId: z.string().uuid(),
  linkedAt: z.string(),
  linkedBy: z.string(),
  operationId: z.string().uuid(),
});

export const RecoveryAggregateCandidateSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/**
 * Aggregate Attempt summary carries the EFFECTIVE deadline, not the raw
 * `examAttempts.deadlineAt`. Computed server-side via the canonical
 * `computeEffectiveDeadline` (contract §6.2/§6.3); the frontend MUST NOT
 * derive it. Nullable since Phase A (#291): an untimed exam has no closeAt
 * and therefore no effective deadline at all — null is a modeled state, not
 * a failure.
 */
export const RecoveryAggregateAttemptSummarySchema = z.object({
  id: z.string(),
  candidateId: z.string().nullable(),
  status: RecoveryAttemptStatusSchema,
  effectiveDeadlineAt: z.string().nullable(),
  score: z.number().nullable(),
});

/**
 * Aggregate Exam summary carries `closeAt` so the route can compute the
 * effective deadline. Nullable since Phase A (#291): untimed exams are
 * open-ended (no closeAt).
 */
export const RecoveryAggregateExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  closeAt: z.string().nullable(),
});

export const RecoveryAggregateTimeAdjustmentSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  policy: InterruptionTimePolicySchema,
  source: TimeAdjustmentSourceSchema,
  beforeDeadline: z.string(),
  afterDeadline: z.string(),
  addedSeconds: z.number().int(),
  eligibleSeconds: z.number().nullable(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  actorId: z.string().nullable(),
  operationId: z.string(),
  createdAt: z.string(),
});

export const RecoveryAggregateAuditReferenceSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export const RecoveryAllowedActionSchema = z.enum([
  "investigate",
  "add_note",
  "change_severity",
  "resolve",
  "dismiss",
  "link_action",
  "link_attempt",
  "link_interruption",
]);

export const RecoveryAggregateResponseSchema = z.object({
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

export type RecoveryAggregateResponse = z.infer<
  typeof RecoveryAggregateResponseSchema
>;

// ── Attempt Operations Context (J5-I1A3, contract §6.4) ──

export const AttemptOperationsAttemptSchema = z.object({
  id: z.string(),
  examId: z.string(),
  candidateId: z.string(),
  attemptNo: z.number().int(),
  status: RecoveryAttemptStatusSchema,
  startedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  // Server-computed via the canonical `computeEffectiveDeadline`; the
  // frontend MUST NOT re-derive it (contract §6.2). Nullable since Phase A
  // (#291): untimed attempts have no effective deadline — null is modeled.
  effectiveDeadlineAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  gradedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  // Projected true when the jsonb MisconductFlag is set (null flag → false).
  misconduct: z.boolean(),
});

export const AttemptOperationsExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  closeAt: z.string().nullable(),
});

export const AttemptOperationsCandidateSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

export const AttemptOperationsInterruptionEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  occurredAt: z.string(),
  observedLastActivityAt: z.string().nullable(),
  detectionSource: z.string().nullable(),
  timeoutSeconds: z.number().nullable(),
  policy: InterruptionTimePolicySchema,
  eligibleSeconds: z.number().nullable(),
  timeAdjustmentId: z.string().nullable(),
  actorId: z.string().nullable(),
  reasonCode: z.string(),
});

export const AttemptOperationsInterruptionEpisodeSchema = z.object({
  interruption: z.object({
    id: z.string(),
    attemptId: z.string(),
    createdAt: z.string(),
  }),
  events: z.array(AttemptOperationsInterruptionEventSchema),
});

export const AttemptOperationsTimeAdjustmentSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  attemptId: z.string(),
  interruptionId: z.string().nullable(),
  incidentId: z.string().nullable(),
  policy: InterruptionTimePolicySchema,
  source: TimeAdjustmentSourceSchema,
  beforeDeadline: z.string(),
  afterDeadline: z.string(),
  addedSeconds: z.number(),
  eligibleSeconds: z.number().nullable(),
  reasonCode: z.string(),
  reasonText: z.string().nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
});

export const AttemptOperationsTimelineEntrySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.unknown(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
});

export const AttemptOperationsRelatedIncidentSchema = z.object({
  id: z.string(),
  status: RecoveryIncidentStatusSchema,
  severity: RecoveryIncidentSeveritySchema,
  title: z.string(),
});

export const AttemptOperationsAllowedActionSchema = z.enum([
  "time_grant",
  "force_submit",
  "misconduct_mark",
]);

export const AttemptOperationsContextSchema = z.object({
  attempt: AttemptOperationsAttemptSchema,
  examSummary: AttemptOperationsExamSummarySchema,
  candidateSummary: AttemptOperationsCandidateSummarySchema,
  interruptionEpisodes: z.array(AttemptOperationsInterruptionEpisodeSchema),
  timeAdjustments: z.array(AttemptOperationsTimeAdjustmentSchema),
  timeline: z.array(AttemptOperationsTimelineEntrySchema),
  relatedIncidents: z.array(AttemptOperationsRelatedIncidentSchema),
  // Real per-caller eligibility — caller capability ∩ attempt state ∩
  // resource scope, computed server-side. May be empty when no command is
  // eligible for the given attempt state — that is a computed result, never
  // "empty because the UI is read-only".
  allowedActions: z.array(AttemptOperationsAllowedActionSchema),
  snapshotAt: z.string(),
});

export type AttemptOperationsContext = z.infer<
  typeof AttemptOperationsContextSchema
>;

// ── Exam Recovery Context (J5-I1B4, contract §6.5) ──

export const ExamRecoveryIncidentStatSchema = z.object({
  id: z.string(),
  type: RecoveryIncidentTypeSchema,
  severity: RecoveryIncidentSeveritySchema,
  status: RecoveryIncidentStatusSchema,
  createdAt: z.string(),
});

export const ExamRecoveryContextSchema = z.object({
  examSummary: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    timingMode: z.string(),
    closeAt: z.string().nullable(),
  }),
  incidentStats: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.object({
      open: z.number().int().nonnegative(),
      investigating: z.number().int().nonnegative(),
      resolved: z.number().int().nonnegative(),
      dismissed: z.number().int().nonnegative(),
    }),
    bySeverity: z.object({
      info: z.number().int().nonnegative(),
      minor: z.number().int().nonnegative(),
      major: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
    }),
  }),
  recentIncidents: z.array(ExamRecoveryIncidentStatSchema),
  activeProctors: z.array(
    z.object({ userId: z.string(), displayName: z.string() }),
  ),
  attemptStatusDistribution: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ),
  snapshotAt: z.string(),
});

export type ExamRecoveryContext = z.infer<typeof ExamRecoveryContextSchema>;
