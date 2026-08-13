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
  BackupEvidenceResponseSchema,
  RestoreReadinessResponseSchema,
  OpsPolicyResponseSchema,
  UpsertOpsPolicyRequestSchema,
  type ComplianceStatus,
} from "@exam/contracts";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createOperationalPolicyRepo } from "@exam/db/src/repository/operationalPolicyRepo.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";
import { createSystemStatsRepo } from "@exam/db/src/repository/systemStatsRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createWorkerHeartbeatRepo } from "@exam/db/src/repository/workerHeartbeatRepo.js";
import { createIntegrityDiagnosticsRepo } from "@exam/db/src/repository/integrityDiagnosticsRepo.js";
import { createBackupEvidenceRepo } from "@exam/db/src/repository/backupEvidenceRepo.js";
import type {
  BackupRunRow,
  RestoreDrillRow,
} from "@exam/db/src/repository/backupEvidenceRepo.js";
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
      // P7-RBAC-REMEDIATION F-02: runtime gate SystemHealthView is held by BOTH
      // Admin and Maintainer presets; OpenAPI x-role must agree (was Admin-only).
      "x-role": ["Admin", "Maintainer"],
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
      // P7-E2C: the dashboard returns BUSINESS aggregates (questions/exams/
      // candidates/attempts) — gated by the Admin-only business-summary
      // capability, never by the operational health capability.
      fastify.requireCapability(Permission.SystemBusinessSummaryView),
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
      // P7-RBAC-REMEDIATION F-02: runtime gate SystemDiagnosticsView is held by
      // BOTH Admin and Maintainer presets; OpenAPI x-role must agree (was
      // Admin-only). The business-integrity `integrity` block is still
      // Admin-only — gated server-side by SystemBusinessIntegrityView (D8).
      "x-role": ["Admin", "Maintainer"],
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

  /**
   * GET /system/backups
   *
   * P7-E2B — READ-ONLY backup evidence projection: latest run, latest
   * VERIFIED run, last failure, status counts, and bounded history. The
   * artifact is referenced by safe label only (no host paths, no
   * credentials). No write sibling exists: backup.trigger / schedule /
   * retention are decision-gated (ADR-017 D5) and NOT implemented.
   *
   * Gated by SystemBackupView (Admin + Maintainer presets).
   */
  fastify.get("/system/backups", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemBackupView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin", "Maintainer"],
      response: { 200: BackupEvidenceResponseSchema },
    },
    handler: async (request) => {
      const ctx = getRequestContext(request);
      const repo = createBackupEvidenceRepo(anyDb);
      const [latest, latestVerified, lastFailure, counts, history] =
        await Promise.all([
          repo.latestRun(ctx),
          repo.latestSucceededRun(ctx),
          repo.lastFailure(ctx),
          repo.statusCounts(ctx),
          repo.listRuns(ctx, 50),
        ]);
      return {
        latest: latest ? toBackupRunWire(latest) : null,
        latestVerified: latestVerified ? toBackupRunWire(latestVerified) : null,
        lastFailure: lastFailure ? toBackupRunWire(lastFailure) : null,
        counts,
        history: history.map(toBackupRunWire),
      };
    },
  });

  /**
   * GET /system/ops-policy
   *
   * P7-E3 (ADR-017 D9) — the Admin's DESIRED operational objectives (intent)
   * plus the DESIRED vs OBSERVED vs STATUS compliance projection. The intent
   * NEVER binds infrastructure; the projection is computed from ledger
   * evidence (last verified backup, restore drills) against the current
   * policy. No policy row = NOT_CONFIGURED.
   *
   * Gated by SystemOpsPolicyView (Admin + Maintainer).
   */
  fastify.get("/system/ops-policy", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemOpsPolicyView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin", "Maintainer"],
      response: { 200: OpsPolicyResponseSchema },
    },
    handler: async (request) => {
      const ctx = getRequestContext(request);
      const policy = await createOperationalPolicyRepo(anyDb).getPolicy(ctx);
      return buildOpsPolicyProjection(fastify, request, policy);
    },
  });

  /**
   * PUT /system/ops-policy
   *
   * P7-E3 (ADR-017 D9) — Admin is the SOLE intent owner. Records the desired
   * RPO / retention / drill cadence as a typed, versioned (CAS), audited
   * intent record. This writes ONLY the intent — it never schedules,
   * triggers, or rewrites infrastructure (host cron remains the execution
   * authority). The `version` echo + required `reason` are enforced; a
   * concurrent edit rejects with VERSION_CONFLICT.
   *
   * Gated by SystemOpsPolicyManage (Admin preset ONLY — Maintainer never).
   */
  fastify.put("/system/ops-policy", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemOpsPolicyManage),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin"],
      body: UpsertOpsPolicyRequestSchema,
      response: { 200: OpsPolicyResponseSchema },
    },
    handler: async (request) => {
      const ctx = getRequestContext(request);
      const data = UpsertOpsPolicyRequestSchema.parse(request.body);
      const policy = await executeInTransaction(anyDb, async (tx) => {
        const updated = await createOperationalPolicyRepo(
          tx,
        ).upsertPolicyWithinTransaction(ctx, tx, {
          desiredRpoSeconds: data.desiredRpoSeconds,
          desiredRetentionDays: data.desiredRetentionDays,
          desiredDrillCadenceDays: data.desiredDrillCadenceDays,
          expectedVersion: data.version,
          reason: data.reason,
          actorId: ctx.actorId,
          now: fastify.now(),
        });
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "ops.policy.updated",
          targetType: "system",
          targetId: "ops-policy",
          metadata: {
            desiredRpoSeconds: updated.desiredRpoSeconds,
            desiredRetentionDays: updated.desiredRetentionDays,
            desiredDrillCadenceDays: updated.desiredDrillCadenceDays,
            reason: updated.reason,
          },
        });
        return updated;
      });
      return buildOpsPolicyProjection(fastify, request, policy);
    },
  });

  /**
   * GET /system/restore-readiness
   *
   * P7-E2B — READ-ONLY restore-readiness / drill evidence projection: latest
   * drill, latest successful drill, and drill history. The `source` field
   * distinguishes automated proof from operator declaration. Restore itself
   * remains host-only (ADR-017 D4); this route reads drill EVIDENCE only.
   *
   * Gated by SystemRestoreReadinessView (Admin + Maintainer presets).
   */
  fastify.get("/system/restore-readiness", {
    preHandler: [
      fastify.authenticate,
      fastify.requireCapability(Permission.SystemRestoreReadinessView),
    ],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin", "Maintainer"],
      response: { 200: RestoreReadinessResponseSchema },
    },
    handler: async (request) => {
      const ctx = getRequestContext(request);
      const repo = createBackupEvidenceRepo(anyDb);
      const [latestDrill, latestSuccess, drills] = await Promise.all([
        repo.latestDrill(ctx),
        repo.latestSucceededDrill(ctx),
        repo.listDrills(ctx, 20),
      ]);
      // Unbounded lookups: a long run of recent drill failures must not hide
      // an older successful drill from the projection. The latest SUCCEEDED
      // drill (automated or operator-declared — the source is shown on the
      // row) is the recency truth; an older automated success must not
      // outrank a newer operator-declared success (P7-E review P2).
      return {
        latestDrill: latestDrill ? toRestoreDrillWire(latestDrill) : null,
        latestSuccessfulDrill: latestSuccess
          ? toRestoreDrillWire(latestSuccess)
          : null,
        drillHistory: drills.map(toRestoreDrillWire),
      };
    },
  });
};

/** Maps a backup-run row to the wire shape (ISO timestamps). */
function toBackupRunWire(r: BackupRunRow) {
  return {
    id: r.id,
    operationId: r.operationId,
    backupType: r.backupType,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    artifactLabel: r.artifactLabel,
    artifactSizeBytes: r.artifactSizeBytes,
    verificationMethod: r.verificationMethod,
    verificationStatus: r.verificationStatus,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    failureReason: r.failureReason,
    executorType: r.executorType,
  };
}

/**
 * P7-E3 (ADR-017 D9) — builds the DESIRED vs OBSERVED vs STATUS compliance
 * projection from the policy intent + ledger evidence.
 *
 * Truthfulness rules:
 *   - RPO: observed = age of the last VERIFIED backup (seconds). No policy →
 *     NOT_CONFIGURED; no verified backup → UNKNOWN (cannot measure); age <=
 *     desired → SATISFIED; otherwise NOT_SATISFIED.
 *   - Retention: retention/pruning is host-managed today (host cron +
 *     manual + fail-closed invariant) — the product has no enforcement
 *     evidence, so the status is always NOT_ENFORCED (never a lie).
 *   - Drill: observed = age of the most recent SUCCESSFUL drill evidence,
 *     whether automated or operator-declared (the source is shown on the
 *     row). A FAILED drill — automated or operator-declared — NEVER
 *     satisfies cadence; it surfaces via the restore-readiness projection as
 *     the latest drill, not as proof. No successful drill → UNKNOWN; age <=
 *     cadence → SATISFIED; otherwise NOT_SATISFIED. Recency is the truth:
 *     an older automated success does NOT outrank a newer operator-declared
 *     success (P7-E review P2) — picking the older one would be a false
 *     NOT_SATISFIED despite a successful restore today.
 *   - The projection NEVER changes infrastructure — it only renders truth.
 */
async function buildOpsPolicyProjection(
  fastify: FastifyInstance,
  request: FastifyRequest,
  policy: Awaited<
    ReturnType<ReturnType<typeof createOperationalPolicyRepo>["getPolicy"]>
  >,
) {
  const ctx = getRequestContext(request);
  const evidence = createBackupEvidenceRepo(fastify.db);
  const now = fastify.now();
  const [latestVerified, latestSuccess, drills] = await Promise.all([
    evidence.latestSucceededRun(ctx),
    evidence.latestSucceededDrill(ctx),
    evidence.listDrills(ctx, 20),
  ]);

  const policyWire = policy
    ? {
        desiredRpoSeconds: policy.desiredRpoSeconds,
        desiredRetentionDays: policy.desiredRetentionDays,
        desiredDrillCadenceDays: policy.desiredDrillCadenceDays,
        version: policy.version,
        reason: policy.reason,
        updatedBy: policy.updatedBy,
        updatedAt: policy.updatedAt.toISOString(),
      }
    : null;

  // ── RPO ──
  let rpoStatus: ComplianceStatus;
  let rpoDetail: string | null;
  const rpoObservedSeconds =
    latestVerified?.verifiedAt != null
      ? Math.max(
          0,
          (now.getTime() - latestVerified.verifiedAt.getTime()) / 1000,
        )
      : null;
  if (!policy) {
    rpoStatus = "NOT_CONFIGURED";
    rpoDetail = "no operational policy intent recorded";
  } else if (rpoObservedSeconds === null) {
    rpoStatus = "UNKNOWN";
    rpoDetail = "no verified backup exists — RPO cannot be measured";
  } else if (rpoObservedSeconds <= policy.desiredRpoSeconds) {
    rpoStatus = "SATISFIED";
    rpoDetail = `last verified backup age ${Math.round(rpoObservedSeconds)}s <= desired ${policy.desiredRpoSeconds}s`;
  } else {
    rpoStatus = "NOT_SATISFIED";
    rpoDetail = `last verified backup age ${Math.round(rpoObservedSeconds)}s > desired ${policy.desiredRpoSeconds}s`;
  }

  // ── Retention (host-managed — no product enforcement evidence) ──
  const retentionStatus: ComplianceStatus = policy
    ? "NOT_ENFORCED"
    : "NOT_CONFIGURED";
  const retentionDetail = policy
    ? "retention/pruning is host-managed (host cron + operator) — the product records no enforcement evidence"
    : "no operational policy intent recorded";

  // ── Restore drill cadence ──
  let drillStatus: ComplianceStatus;
  let drillDetail: string | null;
  // Only SUCCEEDED drills can prove cadence — a failed drill (automated OR
  // operator-declared) never satisfies it, so there is deliberately NO
  // "latest declared drill" fallback here. `latestSucceededDrill` is
  // unbounded: a long run of recent failures must not hide an older
  // success. The latest SUCCEEDED drill — automated or operator-declared,
  // with its source shown — is the recency truth; an older automated
  // success must not outrank a newer operator-declared success (P7-E
  // review P2).
  const provenDrill = latestSuccess ?? null;
  const drillAgeSeconds =
    provenDrill?.completedAt != null
      ? Math.max(0, (now.getTime() - provenDrill.completedAt.getTime()) / 1000)
      : null;
  if (!policy) {
    drillStatus = "NOT_CONFIGURED";
    drillDetail = "no operational policy intent recorded";
  } else if (provenDrill === null) {
    drillStatus = "UNKNOWN";
    drillDetail =
      "no SUCCESSFUL restore drill evidence recorded (failed drills never satisfy cadence)";
  } else if (
    drillAgeSeconds !== null &&
    drillAgeSeconds <= policy.desiredDrillCadenceDays * 86400
  ) {
    drillStatus = "SATISFIED";
    drillDetail = `last drill ${Math.round(drillAgeSeconds / 86400)}d ago <= desired ${policy.desiredDrillCadenceDays}d (${provenDrill.source})`;
  } else {
    drillStatus = "NOT_SATISFIED";
    drillDetail = `last drill ${drillAgeSeconds !== null ? Math.round(drillAgeSeconds / 86400) + "d" : "?"} ago > desired ${policy.desiredDrillCadenceDays}d (${provenDrill.source})`;
  }

  return {
    policy: policyWire,
    compliance: {
      rpo: {
        desired: policy ? `${policy.desiredRpoSeconds}s` : null,
        observed:
          rpoObservedSeconds !== null
            ? `${Math.round(rpoObservedSeconds)}s`
            : null,
        status: rpoStatus,
        observedDetail: rpoDetail,
      },
      retention: {
        desired: policy ? `${policy.desiredRetentionDays}d` : null,
        observed: "host-managed",
        status: retentionStatus,
        observedDetail: retentionDetail,
      },
      drill: {
        desired: policy ? `${policy.desiredDrillCadenceDays}d` : null,
        observed: provenDrill
          ? `${Math.round((drillAgeSeconds ?? 0) / 86400)}d ago`
          : null,
        status: drillStatus,
        observedDetail: drillDetail,
      },
    },
  };
}

/** Maps a restore-drill row to the wire shape (ISO timestamps). */
function toRestoreDrillWire(r: RestoreDrillRow) {
  return {
    id: r.id,
    operationId: r.operationId,
    backupType: r.backupType,
    result: r.result,
    source: r.source,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    failureReason: r.failureReason,
  };
}

/**
 * P7-E2A (ADR-017 D8) — builds the OPERATIONAL diagnostics payload (the
 * diagnostics response minus the business-integrity `integrity` block). It is
 * the shared base of GET /system/diagnostics: every caller (Admin + Maintainer)
 * receives this operational projection; Admin additionally receives the
 * `integrity` block (field-level projection, gated server-side by
 * SystemBusinessIntegrityView). There is NO separate /system/operational-
 * diagnostics route — the D8 authority-domain split is implemented as a
 * field-level projection inside GET /system/diagnostics, not a second route.
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
