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
 * whether email is enabled, the derived status, the (unknown, in M3) worker
 * state, and outbox row counts. Never includes SMTP host/user/password,
 * recipient addresses, or email body content.
 */
export const EmailDiagnosticsStatusSchema = z.object({
  status: InfrastructureStatusSchema,
  enabled: z.boolean(),
  worker: z.object({
    status: WorkerStatusSchema,
  }),
  outbox: z.object({
    pending: z.number().int().min(0),
    sent: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
});

/** Type for the email diagnostics status block. */
export type EmailDiagnosticsStatus = z.infer<
  typeof EmailDiagnosticsStatusSchema
>;

/**
 * Schema for the system diagnostics response, providing server version,
 * uptime, database latency, Redis status, heartbeat/deadline scanner status,
 * email infrastructure status, and non-sensitive runtime configuration.
 */
export const DiagnosticsResponseSchema = z.object({
  version: z.string(),
  uptime: z.number(),
  dbLatency: z.number().min(0),
  redisStatus: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nullable(),
  }),
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
  config: z.object({
    heartbeatInterval: z.number().int().min(0),
    heartbeatTimeout: z.number().int().min(0),
    deadlineScanInterval: z.number().int().min(0),
  }),
});

/** Type for the system diagnostics response. */
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
