import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import os from "node:os";
import { computeStatus } from "@exam/exam-engine";
import {
  SystemHealthResponseSchema,
  DashboardResponseSchema,
  DiagnosticsResponseSchema,
} from "@exam/contracts";
import { createSystemStatsRepo } from "@exam/db/src/repository/systemStatsRepo.js";
import { getRequestContext } from "./helpers.js";
import type { Database } from "@exam/db/src/types.js";
import {
  getRuntimeConfig,
  buildPublicConfig,
} from "../config/runtimeConfig.js";
import { heartbeatMetrics } from "../plugins/heartbeat.js";
import { deadlineScannerMetrics } from "../plugins/deadlineScanner.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

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
    preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
    preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
   * heartbeat scanner status, deadline scanner status, and non-sensitive
   * runtime config. Admin-only.
   */
  fastify.get("/system/diagnostics", {
    preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    schema: {
      security: cookieAuth,
      "x-role": ["Admin"],
      response: { 200: DiagnosticsResponseSchema },
    },
    handler: async () => {
      const config = getRuntimeConfig();
      const statsRepo = createSystemStatsRepo(anyDb);
      const dbLatency = await statsRepo.pingDb();

      let redisStatus: { connected: boolean; latencyMs: number | null } = {
        connected: false,
        latencyMs: null,
      };
      if (fastify.redis) {
        try {
          // ADR-006: use fastify.now() (the exam time authority) rather than a
          // raw wall-clock read, even though this is diagnostics-only latency.
          const start = fastify.now().getTime();
          await fastify.redis.ping();
          redisStatus = {
            connected: true,
            latencyMs: fastify.now().getTime() - start,
          };
        } catch {
          redisStatus = { connected: false, latencyMs: null };
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
        config: {
          heartbeatInterval: config.heartbeat.scanIntervalMs ?? 30_000,
          heartbeatTimeout: config.heartbeat.timeoutMs ?? 60_000,
          deadlineScanInterval: deadlineScannerMetrics.scanIntervalMs,
        },
      };
    },
  });
};

export default systemRoutes;
