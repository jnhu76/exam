import { z } from "zod";

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
 * the diagnostics layer cannot determine whether a worker is running (e.g.
 * there is no resident email worker in M3 — `processDueEmails` is
 * manually-triggered, so its running state is unknown).
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
 * row counts (P5-0 extended with new statuses and heartbeat). Never includes
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
 * P7-S2 Phase 7 — read-only attempt-integrity anomaly block.
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
 * P7-E2A (ADR-017 D8): `integrity` is OPTIONAL — the business-integrity
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
  }),
  deadlineScannerStatus: z.object({
    interval: z.number().int().min(0),
    lastScanAt: z.string().nullable(),
    autoSubmitCount: z.number().int().min(0),
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

// ── Backup evidence (P7-E2B) ─────────────────────────────────────

/**
 * A backup-run evidence record as exposed by the read projection. The
 * artifact is referenced by its safe LABEL only — never a host path, never a
 * credential-bearing URI (ADR-017 D11). `failureReason` is sanitized.
 */
export const BackupRunSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string(),
  backupType: z.enum(["logical", "physical_base", "cold_filesystem"]),
  status: z.enum(["running", "succeeded", "failed", "abandoned"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  artifactLabel: z.string().nullable(),
  artifactSizeBytes: z.number().int().min(0).nullable(),
  verificationMethod: z.string().nullable(),
  verificationStatus: z.enum(["verified", "failed", "pending"]).nullable(),
  verifiedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  executorType: z.enum(["host_script", "deployment_drill"]),
});

/** Type for a backup-run evidence record. */
export type BackupRun = z.infer<typeof BackupRunSchema>;

/**
 * Response schema for GET /system/backups — the read-only backup evidence
 * projection (Admin + Maintainer). Read-only by construction: no write
 * sibling exists (backup.trigger / schedule / retention are decision-gated,
 * ADR-017 D5).
 */
export const BackupEvidenceResponseSchema = z.object({
  latest: BackupRunSchema.nullable(),
  latestVerified: BackupRunSchema.nullable(),
  lastFailure: BackupRunSchema.nullable(),
  counts: z.object({
    running: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
    abandoned: z.number().int().min(0),
  }),
  history: z.array(BackupRunSchema),
});

/** Type for the backup evidence response. */
export type BackupEvidenceResponse = z.infer<
  typeof BackupEvidenceResponseSchema
>;

// ── Restore-readiness evidence (P7-E2B) ──────────────────────────

/**
 * A restore-drill evidence record. `source` distinguishes automated proof
 * (`automated`) from operator declaration (`operator_declared`) — a declared
 * success is never rendered as automated proof. Restore itself stays
 * host-only; this is drill EVIDENCE only (ADR-017 D4).
 */
export const RestoreDrillRunSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string(),
  backupType: z.enum(["logical", "physical_base", "cold_filesystem"]),
  result: z.enum(["succeeded", "failed", "operator_declared"]),
  source: z.enum(["automated", "operator_declared"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().min(0).nullable(),
  failureReason: z.string().nullable(),
});

/** Type for a restore-drill evidence record. */
export type RestoreDrillRun = z.infer<typeof RestoreDrillRunSchema>;

/**
 * Response schema for GET /system/restore-readiness (Admin + Maintainer).
 */
export const RestoreReadinessResponseSchema = z.object({
  latestDrill: RestoreDrillRunSchema.nullable(),
  latestSuccessfulDrill: RestoreDrillRunSchema.nullable(),
  drillHistory: z.array(RestoreDrillRunSchema),
});

/** Type for the restore-readiness response. */
export type RestoreReadinessResponse = z.infer<
  typeof RestoreReadinessResponseSchema
>;
