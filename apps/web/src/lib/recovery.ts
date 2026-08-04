import { statusMeta } from "./statusMeta";

/**
 * J5-I1B Recovery Center — frontend wire types and status mapping.
 *
 * Wire shapes mirror the recovery contracts (j5-r0-admin-recovery-center-
 * contract.md §5.4 / §6.3 / §6.4). The frontend renders ONLY server fields;
 * it never derives business state (§6.2).
 */

export interface RecoveryQueueIncident {
  id: string;
  examId: string;
  attemptId: string | null;
  candidateId: string | null;
  type: string;
  severity: string;
  status: string;
  occurredAt: string | null;
  description: string;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reportedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryQueueItem {
  incident: RecoveryQueueIncident;
  examSummary: { id: string; title: string; status: string };
  primaryAttempt: {
    id: string;
    candidateId: string | null;
    status: string;
    deadlineAt: string | null;
  } | null;
  primaryCandidate: { id: string; displayName: string } | null;
  linkedAttemptCount: number;
  linkedCandidateCount: number;
  activeProctors: { userId: string; displayName: string }[];
}

export interface RecoveryQueueResponse {
  items: RecoveryQueueItem[];
  nextCursor: string | null;
}

// ── Recovery Incident Aggregate (contract §6.3, J5-I1A2) ──

export interface RecoveryIncidentAggregateEvent {
  id: string;
  eventSequence: number;
  eventType: string;
  commandType: string;
  operationId: string;
  actorId: string | null;
  beforeVersion: number;
  afterVersion: number;
  payload: unknown;
  createdAt: string;
}

export interface RecoveryIncidentAggregateNote {
  operationId: string;
  actorId: string | null;
  body: string;
  createdAt: string;
}

export interface RecoveryIncidentAggregateAction {
  id: string;
  actionType: string;
  actionId: string;
  attemptId: string;
  actorId: string | null;
  operationId: string;
  linkedAt: string;
}

export interface RecoveryIncidentAggregateMembership {
  id: string;
  attemptId: string;
  relationshipType: string;
  linkedAt: string;
  linkedBy: string;
  operationId: string;
}

export interface RecoveryIncidentAggregateInterruptionLink {
  id: string;
  attemptId: string;
  interruptionId: string;
  linkedAt: string;
  linkedBy: string;
  operationId: string;
}

export interface RecoveryIncidentAggregateCandidateSummary {
  id: string;
  displayName: string;
}

export interface RecoveryIncidentAggregateAttemptSummary {
  id: string;
  candidateId: string | null;
  status: string;
  effectiveDeadlineAt: string;
  /** Null until the attempt is graded (additive, J5-I1B2 field mapping). */
  score: number | null;
}

export interface RecoveryIncidentAggregateTimeAdjustment {
  id: string;
  attemptId: string;
  policy: string;
  source: string;
  beforeDeadline: string;
  afterDeadline: string;
  addedSeconds: number;
  eligibleSeconds: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  actorId: string | null;
  operationId: string;
  createdAt: string;
}

export interface RecoveryIncidentAggregateAuditReference {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface RecoveryIncidentAggregateResponse {
  incident: RecoveryQueueIncident;
  examSummary: { id: string; title: string; status: string; closeAt: string };
  events: RecoveryIncidentAggregateEvent[];
  notes: RecoveryIncidentAggregateNote[];
  actions: RecoveryIncidentAggregateAction[];
  attemptMemberships: RecoveryIncidentAggregateMembership[];
  interruptionLinks: RecoveryIncidentAggregateInterruptionLink[];
  candidateSummaries: RecoveryIncidentAggregateCandidateSummary[];
  attemptSummaries: RecoveryIncidentAggregateAttemptSummary[];
  timeAdjustmentSummaries: RecoveryIncidentAggregateTimeAdjustment[];
  auditReferences: RecoveryIncidentAggregateAuditReference[];
  allowedActions: string[];
  snapshotAt: string;
}

// ── Attempt Operations Context (contract §6.4, J5-I1A3) ──

export interface RecoveryAttemptOperationsResponse {
  attempt: {
    id: string;
    examId: string;
    candidateId: string;
    attemptNo: number;
    status: string;
    startedAt: string | null;
    deadlineAt: string | null;
    effectiveDeadlineAt: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    lastActivityAt: string | null;
    misconduct: boolean;
  };
  examSummary: { id: string; title: string; status: string; closeAt: string };
  candidateSummary: { id: string; displayName: string };
  interruptionEpisodes: {
    interruption: { id: string; attemptId: string; createdAt: string };
    events: {
      id: string;
      eventType: string;
      occurredAt: string;
      observedLastActivityAt: string | null;
      detectionSource: string | null;
      timeoutSeconds: number | null;
      policy: string;
      eligibleSeconds: number | null;
      timeAdjustmentId: string | null;
      actorId: string | null;
      reasonCode: string;
    }[];
  }[];
  timeAdjustments: {
    id: string;
    operationId: string;
    attemptId: string;
    interruptionId: string | null;
    incidentId: string | null;
    policy: string;
    source: string;
    beforeDeadline: string;
    afterDeadline: string;
    addedSeconds: number;
    eligibleSeconds: number | null;
    reasonCode: string;
    reasonText: string | null;
    actorId: string | null;
    createdAt: string;
  }[];
  timeline: {
    id: string;
    organizationId: string;
    actorId: string;
    actorName: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata: unknown;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
  }[];
  relatedIncidents: {
    id: string;
    status: string;
    severity: string;
    title: string;
  }[];
  allowedActions: string[];
  snapshotAt: string;
}

/**
 * Maps the incident wire status (`open | investigating | resolved |
 * dismissed`) to its `statusMeta` key. Prefixed domain keys (`incidentOpen`,
 * …) exist because the bare `open` key is the exam lifecycle status — the
 * wire status string must never be fed to `getStatusMeta` directly.
 */
export function incidentStatusKey(status: string): keyof typeof statusMeta {
  switch (status) {
    case "open":
      return "incidentOpen";
    case "investigating":
      return "incidentInvestigating";
    case "resolved":
      return "incidentResolved";
    case "dismissed":
      return "incidentDismissed";
    default:
      return "unknown";
  }
}
