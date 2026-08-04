import { z } from "zod";

// ── Attempt Operations Context (J5-I1A3, contract §6.4) ──

export const AttemptOperationsAttemptSchema = z.object({
  id: z.string(),
  examId: z.string(),
  candidateId: z.string(),
  attemptNo: z.number().int(),
  status: z.string(),
  startedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
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
  closeAt: z.string(),
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
  policy: z.string(),
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
  policy: z.string(),
  source: z.string(),
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
  status: z.string(),
  severity: z.string(),
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
