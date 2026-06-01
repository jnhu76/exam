import type { FastifyPluginAsync } from "fastify";
import os from "node:os";
import { computeStatus } from "@exam/exam-engine";
import {
  SystemHealthResponseSchema,
  DashboardResponseSchema,
} from "@exam/contracts";
import { createSystemStatsRepo } from "@exam/db/src/repository/systemStatsRepo.js";
import type { AnyDatabase } from "@exam/db/src/types.js";

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

function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.min(100, Math.round(((total - free) / total) * 100));
}

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  const anyDb = fastify.db as unknown as AnyDatabase;

  fastify.get("/system/health", {
    preHandler: [fastify.authenticate],
    handler: async () => {
      const cpu = getCpuUsage();
      const memory = getMemoryUsage();
      const statsRepo = createSystemStatsRepo(anyDb);
      const dbResponseMs = await statsRepo.pingDb();
      const status = computeStatus({ cpu, memory, dbResponseMs });

      const response = { cpu, memory, dbResponseMs, status };
      SystemHealthResponseSchema.parse(response);
      return response;
    },
  });

  fastify.get("/system/dashboard", {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const ctx = request.ctx!;
      const statsRepo = createSystemStatsRepo(anyDb);
      const stats = await statsRepo.getDashboardStats(ctx);
      const recentExams = await statsRepo.getRecentExams(ctx);

      const response = {
        totalQuestions: stats.totalQuestions,
        activeExams: stats.activeExams,
        totalCandidates: stats.totalCandidates,
        todayExams: stats.todayAttempts,
        recentExams,
      };
      DashboardResponseSchema.parse(response);
      return response;
    },
  });
};

export default systemRoutes;
