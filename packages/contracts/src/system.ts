import { z } from "zod";
import {
  SUPPORTED_PRODUCT_CAPABILITIES,
  type ProductCapabilityId,
} from "@exam/domain";

// ── System Health ────────────────────────────────────────────────

/**
 * Schema for the system health check response, including CPU, memory, database
 * response time, and overall status.
 */
export const SystemHealthResponseSchema = z.object({
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  dbResponseMs: z.number().min(0),
  status: z.enum(["ok", "degraded", "critical"]),
});

/** Type for the system health check response. */
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;

// ── Dashboard Stats ─────────────────────────────────────────────

/**
 * Schema for a recent exam entry on the dashboard, showing id, title, status, and participant count.
 */
export const DashboardRecentExamSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  participantCount: z.number().int().min(0),
});

/** Type for a recent exam entry on the dashboard. */
export type DashboardRecentExam = z.infer<typeof DashboardRecentExamSchema>;

/**
 * Schema for the admin dashboard response, providing aggregate counts of questions,
 * exams, candidates, and a list of recent exams.
 */
export const DashboardResponseSchema = z.object({
  totalQuestions: z.number().int().min(0),
  activeExams: z.number().int().min(0),
  totalCandidates: z.number().int().min(0),
  todayExams: z.number().int().min(0),
  recentExams: z.array(DashboardRecentExamSchema),
});

/** Type for the admin dashboard response. */
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// ── Diagnostics ──────────────────────────────────────────────────

/**
 * Stable machine-readable infrastructure status vocabulary used by the
 * diagnostics surface. Same intent as {@link SystemHealthResponseSchema}'s
 * `status` field but scoped to a single dependency (email/redis/worker).
 */
export const InfrastructureStatusValues = [
  "available",
  "degraded",
  "unavailable",
  "disabled",
] as const;

export const InfrastructureStatusSchema = z.enum(InfrastructureStatusValues);

/** Infrastructure status union (available/degraded/unavailable/disabled). */
export type InfrastructureStatus = z.infer<typeof InfrastructureStatusSchema>;

/**
 * Worker status extends {@link InfrastructureStatus} with `unknown`, used when
 * the diagnostics layer cannot determine the worker's state: no
 * `email-delivery` heartbeat row exists yet, or the heartbeat read failed.
 */
export const WorkerStatusValues = [
  ...InfrastructureStatusValues,
  "unknown",
] as const;

export const WorkerStatusSchema = z.enum(WorkerStatusValues);

/** Worker status union (infrastructure statuses + `unknown`). */
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

/**
 * Schema for the email infrastructure status block in diagnostics. Surfaces
 * whether email is enabled, the derived status, the worker state, and outbox
 * row counts (extended with new statuses and heartbeat). Never includes
 * SMTP host/user/password, recipient addresses, or email body content.
 */
export const EmailDiagnosticsStatusSchema = z.object({
  status: InfrastructureStatusSchema,
  enabled: z.boolean(),
  worker: z.object({
    status: WorkerStatusSchema,
    lastPollAt: z.string().nullable(),
    lastSuccessAt: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  outbox: z.object({
    pending: z.number().int().min(0),
    processing: z.number().int().min(0),
    retryWait: z.number().int().min(0),
    sent: z.number().int().min(0),
    dead: z.number().int().min(0),
  }),
  oldestPendingAge: z.number().int().min(0).nullable(),
  lastSuccessfulDeliveryAt: z.string().nullable(),
});

/** Type for the email diagnostics status block. */
export type EmailDiagnosticsStatus = z.infer<
  typeof EmailDiagnosticsStatusSchema
>;

/**
 * Redis diagnostics status (P7 — Redis first real adoption).
 *
 * Exposes mode/state/degraded reason truthfully instead of a boolean: an
 * `optional`-mode instance whose Redis is down reports state `degraded` with
 * a reason, never a misleading `connected: true`. No secrets (URL/password)
 * are ever included.
 */
export const RedisDiagnosticsStatusSchema = z.object({
  mode: z.enum(["off", "optional", "required"]),
  state: z.enum(["disabled", "connecting", "ready", "degraded", "closing"]),
  /** Backward-compatible: `state === "ready"`. */
  connected: z.boolean(),
  latencyMs: z.number().nullable(),
  degradedReason: z
    .enum([
      "startup_timeout",
      "connection_lost",
      "command_failure",
      "retry_exhausted",
    ])
    .nullable(),
});

/** Type for the Redis diagnostics status block. */
export type RedisDiagnosticsStatus = z.infer<
  typeof RedisDiagnosticsStatusSchema
>;

/**
 * Read-only attempt-integrity anomaly block.
 *
 * Counts durable attempt shapes the CURRENT runtime cannot produce (submit
 * freeze, workset materialization, and terminal grading commit in one
 * transaction) but which may exist from legacy versions / manual SQL. The
 * `anomalies` array is a bounded sample carrying enough identity for a human
 * or a later canonical repair command. Detection only — never repairs.
 */
export const AttemptIntegrityAnomalySchema = z.object({
  kind: z.enum(["submitted_not_terminalized", "submitted_workset_mismatch"]),
  attemptId: z.string(),
  examId: z.string(),
  enrollmentId: z.string(),
  candidateId: z.string(),
  status: z.string(),
  // Nullable: `grading_status` has no NOT NULL constraint, and legacy rows can
  // legitimately carry NULL. The diagnostics surface must faithfully report
  // the DB reality (anomaly evidence), not normalize it into a fake value —
  // and a NULL here must never fail response serialization exactly when the
  // most corrupt legacy rows are being reported.
  gradingStatus: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  gradedAt: z.string().datetime().nullable(),
  gradingEntries: z.number().int().min(0),
  snapshotQuestions: z.number().int().min(0),
});

/**
 * Schema for the system diagnostics response, providing server version,
 * uptime, database latency, Redis status, heartbeat/deadline scanner status,
 * email infrastructure status, read-only integrity anomalies, and
 * non-sensitive runtime configuration.
 *
 * ADR-017 D8: `integrity` is OPTIONAL — the business-integrity
 * anomaly block is included only for actors holding
 * `system.business_integrity.view` (Admin preset). Operational-only viewers
 * (Application Maintainer) receive the response WITHOUT the block, so the
 * field is absent rather than zeroed.
 */
export const DiagnosticsResponseSchema = z.object({
  version: z.string(),
  uptime: z.number(),
  dbLatency: z.number().min(0),
  redisStatus: RedisDiagnosticsStatusSchema,
  heartbeatStatus: z.object({
    interval: z.number().int().min(0),
    timeout: z.number().int().min(0),
    lastScanAt: z.string().nullable(),
    disruptedCount: z.number().int().min(0),
    // #547 stall facts: lastSettledAt is the stall authority (settled =
    // tick finished, success OR error); stallState is the same pure
    // classification the operability monitor alerts on.
    startedAt: z.string().nullable(),
    lastStartedAt: z.string().nullable(),
    lastSettledAt: z.string().nullable(),
    activeSince: z.string().nullable(),
    stallState: z.enum(["warming", "healthy", "active", "stalled"]),
  }),
  deadlineScannerStatus: z.object({
    interval: z.number().int().min(0),
    lastScanAt: z.string().nullable(),
    autoSubmitCount: z.number().int().min(0),
    startedAt: z.string().nullable(),
    lastStartedAt: z.string().nullable(),
    lastSettledAt: z.string().nullable(),
    activeSince: z.string().nullable(),
    stallState: z.enum(["warming", "healthy", "active", "stalled"]),
  }),
  emailStatus: EmailDiagnosticsStatusSchema,
  integrity: z
    .object({
      submittedNotTerminalized: z.number().int().min(0),
      submittedWorksetMismatch: z.number().int().min(0),
      anomalies: z.array(AttemptIntegrityAnomalySchema),
    })
    .optional(),
  config: z.object({
    heartbeatInterval: z.number().int().min(0),
    heartbeatTimeout: z.number().int().min(0),
    deadlineScanInterval: z.number().int().min(0),
  }),
});

/** Type for the system diagnostics response. */
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;

// ── Public deployment configuration ──────────────────────────────

/**
 * Closed deployment product capability vocabulary (ADR-022 / #678 Phase 1).
 *
 * Built from the domain catalog, never from a second list: the enum and
 * {@link ProductCapabilityId} are asserted to be the same union below.
 */
export const ProductCapabilityIdSchema = z.enum(SUPPORTED_PRODUCT_CAPABILITIES);

type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
const _productCapabilityIdentity: AssertExact<
  z.infer<typeof ProductCapabilityIdSchema>,
  ProductCapabilityId
> = true;
void _productCapabilityIdentity;

/**
 * Read-only projection of the deployment's resolved product configuration.
 *
 * `enabled` answers only "may this deployment make a NEW commitment of this
 * capability?". It is NOT:
 * - actor authorization (Permissions and resource scope are separate);
 * - current exam policy (`admission.queue` still depends on the frozen
 *   per-exam `requireQueue`; `result.publication` still depends on the
 *   exam's publication mode and result readiness);
 * - an existing obligation (`grading.manual` does not mean an attempt has
 *   pending manual work, and `operator.monitoring` does not mean continuous
 *   monitoring or an incident exists);
 * - a downgrade signal: accepted obligations and historical Rich content
 *   remain readable/fulfillable regardless of this projection.
 *
 * UI consumers MUST NOT use this projection to hide correctness work
 * (pending manual grading, recovery, incidents) or historical Rich data.
 *
 * `revision` is the catalog/configuration FORMAT revision, not a
 * deployment-configuration state revision or CAS token. Phase 4 introduces
 * transactional revisions with persisted configuration writes.
 */
export const ProductCapabilityProjectionSchema = z.object({
  revision: z.literal(1),
  presentation: z.literal("standard"),
  enabled: z.array(ProductCapabilityIdSchema),
});

/** Type for the deployment product capability projection. */
export type ProductCapabilityProjection = z.infer<
  typeof ProductCapabilityProjectionSchema
>;

/**
 * Schema for `GET /system/public-config`. Unauthenticated and non-sensitive:
 * deployment mode, API-reference feature paths, and the deployment-level
 * product capability projection. It carries no actor, exam, attempt, or
 * secret data.
 */
export const PublicConfigResponseSchema = z.object({
  deploymentMode: z.string(),
  features: z.object({ apiReference: z.boolean() }),
  apiReference: z.object({
    enabled: z.boolean(),
    uiPath: z.string(),
    specPath: z.string(),
  }),
  product: ProductCapabilityProjectionSchema,
});

/** Type for the public-config response. */
export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;
