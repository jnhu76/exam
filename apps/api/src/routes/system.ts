import type {
  FastifyPluginAsync,
  FastifyInstance,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import os from "node:os";
import { computeStatus } from "@exam/exam-engine";
import {
  SystemHealthResponseSchema,
  DashboardResponseSchema,
  DiagnosticsResponseSchema,
} from "@exam/contracts";
import { createSystemStatsRepo } from "@exam/db/src/repository/systemStatsRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createWorkerHeartbeatRepo } from "@exam/db/src/repository/workerHeartbeatRepo.js";
import { createIntegrityDiagnosticsRepo } from "@exam/db/src/repository/integrityDiagnosticsRepo.js";
import { getRequestContext } from "./helpers.js";
import type { Database } from "@exam/db/src/types.js";
import {
  getRuntimeConfig,
  buildPublicConfig,
} from "../config/runtimeConfig.js";
import { heartbeatMetrics } from "../plugins/heartbeat.js";
import { deadlineScannerMetrics } from "../plugins/deadlineScanner.js";
import { Permission } from "@exam/authz";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Builds the email diagnostics status block (P5-0). Never throws: if the outbox
 * query fails, the status degrades to `unavailable` rather than failing the
 * whole diagnostics response. Never exposes SMTP host/user/password,
 * recipient addresses, or email body content — only booleans, a derived
 * status, worker state, and row counts.
 *
 * Status rules:
 * - disabled: `!config.email.enabled`
 * - degraded: enabled and (`outbox.dead > 0` or worker status is
 *   degraded/unavailable)
 * - available: enabled, outbox query succeeded, `dead === 0`
 * - unavailable: enabled but the outbox query threw
 *
 * Worker status is derived from the PostgreSQL heartbeat record:
 * - disabled: email is disabled
 * - unknown: no heartbeat record found
 * - available: heartbeat is fresh, lastSuccessAt is non-null, and lastError is null
 * - degraded: heartbeat is stale, or no successful poll has occurred, or
 *   lastError is non-null (including bootstrap_pending)
 */
async function buildEmailStatus(
  config: ReturnType<typeof getRuntimeConfig>,
  db: Database,
  ctx: ReturnType<typeof getRequestContext>,
  now: Date,
): Promise<{
  status: "available" | "degraded" | "unavailable" | "disabled";
  enabled: boolean;
  worker: {
    status: "available" | "degraded" | "unavailable" | "disabled" | "unknown";
    lastPollAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  };
  outbox: {
    pending: number;
    processing: number;
    retryWait: number;
    sent: number;
    dead: number;
  };
  oldestPendingAge: number | null;
  lastSuccessfulDeliveryAt: string | null;
}> {
  const enabled = config.email.enabled;
  if (!enabled) {
    return {
      status: "disabled",
      enabled: false,
      worker: {
        status: "disabled",
        lastPollAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
      },
      outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      oldestPendingAge: null,
      lastSuccessfulDeliveryAt: null,
    };
  }

  try {
    const emailRepo = createEmailOutboxRepo(db);
    const heartbeatRepo = createWorkerHeartbeatRepo(db);

    // Read worker heartbeat
    const heartbeat = await heartbeatRepo.findLatestByName("email-delivery");
    const staleThresholdMs = config.emailWorker.heartbeatStaleThresholdMs;
    let workerStatus: "available" | "degraded" | "unknown" = "unknown";
    let lastPollAt: string | null = null;
    let lastSuccessAt: string | null = null;
    let lastErrorAt: string | null = null;
    let lastError: string | null = null;

    if (heartbeat) {
      lastPollAt = heartbeat.lastPollAt.toISOString();
      lastSuccessAt = heartbeat.lastSuccessAt?.toISOString() ?? null;
      lastErrorAt = heartbeat.lastErrorAt?.toISOString() ?? null;
      lastError = heartbeat.lastError;
      const age = now.getTime() - heartbeat.lastPollAt.getTime();
      const isFresh = age <= staleThresholdMs;
      const hasSucceeded = heartbeat.lastSuccessAt !== null;
      const hasCurrentProblem = heartbeat.lastError !== null;

      workerStatus =
        isFresh && hasSucceeded && !hasCurrentProblem
          ? "available"
          : "degraded";
    }

    // Read outbox counts
    const counts = await emailRepo.countByStatus(ctx);

    // Determine oldest pending age
    const allPendingRows = await emailRepo.findDuePending(ctx, now, 1);
    let oldestPendingAge: number | null = null;
    if (allPendingRows.length > 0) {
      oldestPendingAge = Math.floor(
        (now.getTime() - allPendingRows[0]!.createdAt.getTime()) / 1000,
      );
    }

    // Determine last successful delivery from actual outbox data
    let lastSuccessfulDeliveryAt: string | null = null;
    const lastSentRow = await emailRepo.findLastSent(ctx, 1);
    if (lastSentRow) {
      lastSuccessfulDeliveryAt = lastSentRow.sentAt!.toISOString();
    }

    // Overall status
    const isDegraded =
      counts.dead > 0 ||
      workerStatus === "degraded" ||
      workerStatus === "unknown";

    return {
      status: isDegraded ? "degraded" : "available",
      enabled: true,
      worker: {
        status: workerStatus,
        lastPollAt,
        lastSuccessAt,
        lastErrorAt,
        lastError,
      },
      outbox: counts,
      oldestPendingAge,
      lastSuccessfulDeliveryAt,
    };
  } catch {
    return {
      status: "unavailable",
      enabled: true,
      worker: {
        status: "unknown",
        lastPollAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
      },
      outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      oldestPendingAge: null,
      lastSuccessfulDeliveryAt: null,
    };
  }
}

/**
 * Zod schema for the `GET /system/info` response.
 */
const systemInfoResponseSchema = z.object({
  version: z.string(),
  uptime: z.number(),
});

/**
 * Zod schema for the `GET /system/public-config` response.
 * Exposes non-sensitive deployment configuration to unauthenticated clients.
 */
const publicConfigResponseSchema = z.object({
  deploymentMode: z.string(),
  features: z.object({ apiReference: z.boolean() }),
  apiReference: z.object({
    enabled: z.boolean(),
    uiPath: z.string(),
    specPath: z.string(),
  }),
});

/**
 * Returns the aggregate CPU usage percentage across all cores as a
 * number between 0 and 100.
 *
 * @returns CPU usage percentage rounded to the nearest integer.
 */
function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<
      keyof typeof cpu.times
    >) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  const totalActive = totalTick - totalIdle;
  return Math.min(100, Math.round((totalActive / totalTick) * 100));
}

/**
 * Returns the memory usage percentage as a number between 0 and 100.
 *
 * @returns Memory usage percentage rounded to the nearest integer.
 */
function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.min(100, Math.round(((total - free) / total) * 100));
}

/**
 * Fastify plugin that registers system information and health check routes.
 * Provides unauthenticated system info and public config, plus authenticated
 * admin endpoints for health monitoring and dashboard statistics.
 */
const systemRoutes: FastifyPluginAsync = async (fastify) => {
  const anyDb = fastify.db;

  /**
   * GET /system/info
   *
   * Returns the application version and uptime. Unauthenticated.
   */
  fastify.get(
    "/system/info",
    {
      schema: {
        response: { 200: systemInfoResponseSchema },
      },
    },
    async () => {
      return {
        version: process.env.npm_package_version ?? "0.0.0",
        uptime: process.uptime(),
      };
    },
  );

  /**
   * GET /system/public-config
   *
   * Returns non-sensitive deployment configuration (mode, feature flags,
   * API reference paths). Unauthenticated — safe for pre-login pages.
   */
  fastify.get(
    "/system/public-config",
    {
      schema: {
        response: { 200: publicConfigResponseSchema },
      },
    },
    async () => {
      return buildPublicConfig();
    },
  );

  /**
   * GET /system/health
   *
   * Returns CPU, memory, DB response time, and an overall status indicator.
   * Admin-only.
   */
  fastify.get("/system/health", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemHealthView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin"],
      response: { 200: SystemHealthResponseSchema },
    },
    handler: async () => {
      const cpu = getCpuUsage();
      const memory = getMemoryUsage();
      const statsRepo = createSystemStatsRepo(anyDb);
      const dbResponseMs = await statsRepo.pingDb();
      const status = computeStatus({ cpu, memory, dbResponseMs });

      return { cpu, memory, dbResponseMs, status };
    },
  });

  /**
   * GET /system/dashboard
   *
   * Returns aggregate statistics (question count, active exams, candidate
   * count, today's attempts) and a list of recent exams. Admin-only.
   */
  fastify.get("/system/dashboard", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemHealthView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin"],
      response: { 200: DashboardResponseSchema },
    },
    handler: async (request) => {
      const ctx = getRequestContext(request);
      const statsRepo = createSystemStatsRepo(anyDb);
      const stats = await statsRepo.getDashboardStats(ctx);
      const recentExams = await statsRepo.getRecentExams(ctx);

      return {
        totalQuestions: stats.totalQuestions,
        activeExams: stats.activeExams,
        totalCandidates: stats.totalCandidates,
        todayExams: stats.todayAttempts,
        recentExams,
      };
    },
  });

  /**
   * GET /system/diagnostics
   *
   * Returns server version, uptime, database latency, Redis status,
   * heartbeat scanner status, deadline scanner status, non-sensitive
   * runtime config, and — for actors holding the business-integrity
   * capability (Admin) — the business-integrity anomaly block.
   *
   * P7-E2A (ADR-017 D8) — authority-domain split by SERVICE PROJECTION: the
   * route is gated by the operational SystemDiagnosticsView capability
   * (Admin + Maintainer), and the handler includes the `integrity` block
   * (submitted-not-terminalized / workset-mismatch attempt anomalies) ONLY
   * when the actor holds `system.business_integrity.view` (Admin-only preset).
   * A Maintainer viewer receives the operational projection and never the
   * business-domain integrity evidence; Admin visibility is unchanged.
   */
  fastify.get("/system/diagnostics", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemDiagnosticsView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin"],
      response: { 200: DiagnosticsResponseSchema },
    },
    handler: async (request) => {
      const base = await buildOperationalDiagnostics(fastify, request);
      const ctx = getRequestContext(request);
      const integrity = ctx.capabilities.includes(
        Permission.SystemBusinessIntegrityView,
      )
        ? await loadIntegrityAnomalies(fastify, request)
        : undefined;
      return { ...base, integrity };
    },
  });
};

/**
 * P7-E2A (ADR-017 D8) — builds the OPERATIONAL diagnostics payload (the
 * diagnostics response minus the business-integrity `integrity` block).
 * Shared by GET /system/diagnostics (full response, Admin) and
 * GET /system/operational-diagnostics (operational projection, Maintainer).
 */
async function buildOperationalDiagnostics(
  fastify: FastifyInstance,
  request: FastifyRequest,
) {
  const anyDb = fastify.db;
  const config = getRuntimeConfig();
  const statsRepo = createSystemStatsRepo(anyDb);
  const dbLatency = await statsRepo.pingDb();

  let redisStatus: {
    mode: "off" | "optional" | "required";
    state: "disabled" | "connecting" | "ready" | "degraded" | "closing";
    connected: boolean;
    latencyMs: number | null;
    degradedReason: string | null;
  } = {
    mode: "off",
    state: "disabled",
    connected: false,
    latencyMs: null,
    degradedReason: null,
  };

  if (fastify.redisRuntime) {
    // P7: diagnostics reflect the runtime lifecycle truthfully (mode,
    // state, degraded reason) instead of a boolean. Latency is measured
    // only when the runtime is ready.
    redisStatus = { ...fastify.redisRuntime.snapshot() };
    if (fastify.redisRuntime.shouldUseRedis()) {
      const latencyMs = await fastify.redisRuntime.pingLatency();
      redisStatus.latencyMs = latencyMs;
    }
  } else if (fastify.redis) {
    // Legacy path (plugin absent, e.g. test apps that inject a fake):
    // keep the ping-based contract so diagnostics never breaks.
    try {
      // ADR-006: use fastify.now() (the exam time authority) rather than a
      // raw wall-clock read, even though this is diagnostics-only latency.
      const start = fastify.now().getTime();
      await fastify.redis.ping();
      redisStatus = {
        mode: "off",
        state: "ready",
        connected: true,
        latencyMs: fastify.now().getTime() - start,
        degradedReason: null,
      };
    } catch {
      request.log.warn({ route: "system.diagnostics" }, "redis.unavailable");
    }
  }

  return {
    version: process.env.npm_package_version ?? "0.0.0",
    uptime: process.uptime(),
    dbLatency,
    redisStatus,
    heartbeatStatus: {
      interval: config.heartbeat.scanIntervalMs ?? 30_000,
      timeout: config.heartbeat.timeoutMs ?? 60_000,
      lastScanAt: heartbeatMetrics.lastScanAt?.toISOString() ?? null,
      disruptedCount: heartbeatMetrics.disruptedCount,
    },
    deadlineScannerStatus: {
      interval: deadlineScannerMetrics.scanIntervalMs,
      lastScanAt: deadlineScannerMetrics.lastScanAt?.toISOString() ?? null,
      autoSubmitCount: deadlineScannerMetrics.autoSubmitCount,
    },
    emailStatus: await buildEmailStatus(
      config,
      anyDb,
      getRequestContext(request),
      fastify.now(),
    ),
    config: {
      heartbeatInterval: config.heartbeat.scanIntervalMs ?? 30_000,
      heartbeatTimeout: config.heartbeat.timeoutMs ?? 60_000,
      deadlineScanInterval: deadlineScannerMetrics.scanIntervalMs,
    },
  };
}

/**
 * P7-E2A (ADR-017 D8) — loads the BUSINESS-integrity anomaly block
 * (submitted-not-terminalized / workset-mismatch attempt anomalies). Included
 * only in the full diagnostics response (Admin), never in the operational
 * projection served to Maintainer viewers.
 *
 * P7-S2 Phase 7 — read-only integrity anomalies (detect, never repair).
 * Isolated from the main response: if the detector throws (e.g. a corrupt
 * legacy row that defeats even the defensive jsonb guard), diagnostics
 * degrades the `integrity` block to zeroed evidence instead of 500-ing
 * the whole response — exactly when an admin most needs the OTHER status
 * (redis/email/heartbeat). Mirrors buildEmailStatus's degrade-not-fail.
 */
async function loadIntegrityAnomalies(
  fastify: { db: Database; now: () => Date },
  request: FastifyRequest,
): Promise<{
  submittedNotTerminalized: number;
  submittedWorksetMismatch: number;
  anomalies: Array<{
    kind: "submitted_not_terminalized" | "submitted_workset_mismatch";
    attemptId: string;
    examId: string;
    enrollmentId: string;
    candidateId: string;
    status: string;
    gradingStatus: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    gradingEntries: number;
    snapshotQuestions: number;
  }>;
}> {
  let integrity: {
    submittedNotTerminalized: number;
    submittedWorksetMismatch: number;
    anomalies: Array<{
      kind: "submitted_not_terminalized" | "submitted_workset_mismatch";
      attemptId: string;
      examId: string;
      enrollmentId: string;
      candidateId: string;
      status: string;
      gradingStatus: string | null;
      submittedAt: string | null;
      gradedAt: string | null;
      gradingEntries: number;
      snapshotQuestions: number;
    }>;
  } = {
    submittedNotTerminalized: 0,
    submittedWorksetMismatch: 0,
    anomalies: [],
  };
  try {
    const report = await createIntegrityDiagnosticsRepo(
      fastify.db,
    ).findAttemptAnomalies(getRequestContext(request), { limit: 100 });
    integrity = {
      submittedNotTerminalized: report.submittedNotTerminalized,
      submittedWorksetMismatch: report.submittedWorksetMismatch,
      anomalies: report.anomalies.map((a) => ({
        ...a,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        gradedAt: a.gradedAt?.toISOString() ?? null,
      })),
    };
  } catch (err) {
    request.log.warn(
      { route: "system.diagnostics", err },
      "integrity.diagnostics_failed",
    );
  }
  return integrity;
}

export default systemRoutes;
