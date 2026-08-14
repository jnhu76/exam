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
 * A restore-drill evidence record. Two orthogonal dimensions: `result` is
 * WHAT happened (succeeded | failed), `source` is WHO proved it
 * (`automated` deployment drill vs `operator_declared`). A declared success
 * is never rendered as automated proof; a failed drill never satisfies the
 * drill cadence. Restore itself stays host-only; this is drill EVIDENCE
 * only (ADR-017 D4).
 */
export const RestoreDrillRunSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string(),
  backupType: z.enum(["logical", "physical_base", "cold_filesystem"]),
  result: z.enum(["succeeded", "failed"]),
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

// ── Host-side retention evidence (P7-CLOSE P7-3b) ───────────────

/**
 * A host-side retention evidence record. Success means: retention operation
 * succeeded AND repository/chain verification succeeded — not merely that a
 * delete command returned zero. Exam never performs retention; this is
 * evidence only (ADR-017 D4).
 */
export const RetentionRunSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string(),
  tool: z.string(),
  result: z.enum(["succeeded", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  prunedBackups: z.number().int().min(0).nullable(),
  prunedWalArchives: z.number().int().min(0).nullable(),
  retentionObjective: z.string().nullable(),
  verificationStatus: z.enum(["verified", "failed", "pending"]).nullable(),
  verificationDetail: z.string().nullable(),
  failureReason: z.string().nullable(),
  executorType: z.enum(["host_script", "deployment_drill"]),
});

/** Type for a retention evidence record. */
export type RetentionRun = z.infer<typeof RetentionRunSchema>;

/**
 * Response schema for GET /system/retention-readiness (Admin + Maintainer).
 */
export const RetentionReadinessResponseSchema = z.object({
  latestRetention: RetentionRunSchema.nullable(),
  latestSuccessfulRetention: RetentionRunSchema.nullable(),
  retentionHistory: z.array(RetentionRunSchema),
});

/** Type for the retention-readiness response. */
export type RetentionReadinessResponse = z.infer<
  typeof RetentionReadinessResponseSchema
>;

// ── Operational policy intent (P7-E3, ADR-017 D9) ─────────────────

/**
 * Safe-range bounds for the Admin's operational policy intent. Typed
 * validation — out-of-range values are rejected before they reach the DB
 * (the DB CHECK constraints mirror these bounds).
 */
export const OpsPolicyRpoSecondsRange = { min: 300, max: 604800 } as const; // 5 min .. 7 days
export const OpsPolicyRtoSecondsRange = { min: 30, max: 172800 } as const; // 30s .. 48h
export const OpsPolicyRetentionDaysRange = { min: 1, max: 3650 } as const;
export const OpsPolicyDrillCadenceDaysRange = { min: 1, max: 365 } as const;

/**
 * The Admin's DESIRED operational objectives — intent only, never binding
 * infrastructure. `version` is the optimistic-concurrency (CAS) token; every
 * update must echo the version it read, and `reason` documents the change.
 */
export const OperationalPolicySchema = z.object({
  desiredRpoSeconds: z
    .number()
    .int()
    .min(OpsPolicyRpoSecondsRange.min)
    .max(OpsPolicyRpoSecondsRange.max),
  desiredRtoSeconds: z
    .number()
    .int()
    .min(OpsPolicyRtoSecondsRange.min)
    .max(OpsPolicyRtoSecondsRange.max)
    .nullable(),
  desiredRetentionDays: z
    .number()
    .int()
    .min(OpsPolicyRetentionDaysRange.min)
    .max(OpsPolicyRetentionDaysRange.max),
  desiredDrillCadenceDays: z
    .number()
    .int()
    .min(OpsPolicyDrillCadenceDaysRange.min)
    .max(OpsPolicyDrillCadenceDaysRange.max),
  version: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
  updatedBy: z.string(),
  updatedAt: z.string(),
});

/** Type for the operational policy intent record. */
export type OperationalPolicy = z.infer<typeof OperationalPolicySchema>;

/** Compliance status vocabulary (DESIRED vs OBSERVED vs STATUS). */
export const ComplianceStatusValues = [
  "SATISFIED",
  "NOT_SATISFIED",
  "UNKNOWN",
  "NOT_CONFIGURED",
  "NOT_ENFORCED",
] as const;

export const ComplianceStatusSchema = z.enum(ComplianceStatusValues);

/** Type for a compliance status. */
export type ComplianceStatus = z.infer<typeof ComplianceStatusSchema>;

/**
 * One DESIRED vs OBSERVED vs STATUS row of the compliance projection.
 * `observedDetail` is a truthful human-readable explanation of the observed
 * evidence (e.g. "last verified backup age 26h", "retention is host-managed").
 */
export const ComplianceItemSchema = z.object({
  desired: z.string().nullable(),
  observed: z.string().nullable(),
  status: ComplianceStatusSchema,
  observedDetail: z.string().nullable(),
});

/** Type for a compliance projection row. */
export type ComplianceItem = z.infer<typeof ComplianceItemSchema>;

/**
 * Request schema for PUT /system/ops-policy (Admin intent owner). The client
 * must send the version it read (CAS); mismatch → 409 VERSION_CONFLICT.
 *
 * `desiredRtoSeconds` is `.nullable().optional()`: the UI sends an explicit
 * `null` when the Admin clears the RTO objective (NOT_CONFIGURED), and may
 * omit it entirely. `.optional()` alone would reject `null` (it allows only
 * `undefined`), which made a blank-RTO save return 400 — the DB column, the
 * response schema, and the repo all already treat NULL as a first-class
 * NOT_CONFIGURED state, so the request contract must accept `null` too.
 */
export const UpsertOpsPolicyRequestSchema = z.object({
  desiredRpoSeconds: z
    .number()
    .int()
    .min(OpsPolicyRpoSecondsRange.min)
    .max(OpsPolicyRpoSecondsRange.max),
  desiredRtoSeconds: z
    .number()
    .int()
    .min(OpsPolicyRtoSecondsRange.min)
    .max(OpsPolicyRtoSecondsRange.max)
    .nullable()
    .optional(),
  desiredRetentionDays: z
    .number()
    .int()
    .min(OpsPolicyRetentionDaysRange.min)
    .max(OpsPolicyRetentionDaysRange.max),
  desiredDrillCadenceDays: z
    .number()
    .int()
    .min(OpsPolicyDrillCadenceDaysRange.min)
    .max(OpsPolicyDrillCadenceDaysRange.max),
  /** Echo of the version read (0 for first creation). */
  version: z.number().int().min(0),
  /** Required reason for the change (audited). */
  reason: z.string().trim().min(1).max(500),
});

/** Type for a policy upsert request. */
export type UpsertOpsPolicyRequest = z.infer<
  typeof UpsertOpsPolicyRequestSchema
>;

/**
 * Response schema for GET /system/ops-policy: the intent record (or null =
 * NOT_CONFIGURED) plus the DESIRED vs OBSERVED vs STATUS compliance
 * projection for RPO, retention, and restore drill.
 */
export const OpsPolicyResponseSchema = z.object({
  policy: OperationalPolicySchema.nullable(),
  compliance: z.object({
    rpo: ComplianceItemSchema,
    rto: ComplianceItemSchema,
    retention: ComplianceItemSchema,
    drill: ComplianceItemSchema,
  }),
});

/** Type for the ops-policy response. */
export type OpsPolicyResponse = z.infer<typeof OpsPolicyResponseSchema>;
