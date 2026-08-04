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
