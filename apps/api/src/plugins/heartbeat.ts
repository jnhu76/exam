import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { ExamAttempt, Permission, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { markDisrupted, type AttemptRepository } from "@exam/exam-engine";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

export interface DisruptedCandidate {
  id: string;
  status: string;
  lastActivityAt?: Date | null;
}

export interface ScanResult {
  markedCount: number;
}

export async function scanForDisruptedAttempts(
  activeAttempts: DisruptedCandidate[],
  now: Date,
  heartbeatTimeoutMs: number,
  onDisrupted: (attemptId: string) => Promise<void>,
): Promise<ScanResult> {
  let markedCount = 0;

  for (const attempt of activeAttempts) {
    if (attempt.status !== "in_progress") continue;
    if (!attempt.lastActivityAt) continue;

    const elapsed = now.getTime() - attempt.lastActivityAt.getTime();
    if (elapsed >= heartbeatTimeoutMs) {
      await onDisrupted(attempt.id);
      markedCount++;
    }
  }

  return { markedCount };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createSystemContext(organizationId: string): RequestContext {
  return {
    actorId: "system:heartbeat",
    organizationId,
    role: "Admin",
    permissions: [] as Permission[],
    sessionId: "system:heartbeat",
    targetOrganizationId: organizationId,
  };
}

function createAttemptRepoAdapter(
  repo: ReturnType<typeof createAttemptRepo>,
  ctx: RequestContext,
): AttemptRepository {
  return {
    findById: async (id) =>
      (await repo.findById(ctx, id)) as ExamAttempt | null,
    findActiveByEnrollment: async (enrollmentId) =>
      (await repo.findActiveByEnrollment(
        ctx,
        enrollmentId,
      )) as ExamAttempt | null,
    findByEnrollmentAndAttemptNo: async (enrollmentId, attemptNo) =>
      (await repo.findByEnrollmentAndAttemptNo(
        ctx,
        enrollmentId,
        attemptNo,
      )) as ExamAttempt | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as ExamAttempt,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as ExamAttempt | null,
  };
}

export async function scanDatabaseForDisruptedAttempts(
  fastify: Parameters<FastifyPluginAsync>[0],
  now = new Date(),
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
): Promise<ScanResult> {
  const organizationRepo = createOrganizationRepo(fastify.db);
  const organizations = await organizationRepo.list(
    createSystemContext("system"),
  );
  let markedCount = 0;

  for (const organization of organizations) {
    const ctx = createSystemContext(organization.id);
    const attemptRepo = createAttemptRepo(fastify.db);
    const attempts = await attemptRepo.listInProgress(ctx);
    const result = await scanForDisruptedAttempts(
      attempts,
      now,
      heartbeatTimeoutMs,
      async (attemptId) => {
        try {
          await markDisrupted(
            createAttemptRepoAdapter(attemptRepo, ctx),
            attemptId,
          );
        } catch (err) {
          fastify.log.error(
            { err, attemptId, organizationId: organization.id },
            "Failed to mark stale attempt as disrupted",
          );
        }
      },
    );
    markedCount += result.markedCount;
  }

  return { markedCount };
}

const heartbeatPlugin: FastifyPluginAsync = async (fastify) => {
  const { scanIntervalMs, timeoutMs: heartbeatTimeoutMs } =
    getRuntimeConfig().heartbeat;

  let scanRunning = false;
  const interval = setInterval(async () => {
    if (scanRunning) return;
    scanRunning = true;
    try {
      const result = await scanDatabaseForDisruptedAttempts(
        fastify,
        new Date(),
        heartbeatTimeoutMs,
      );
      if (result.markedCount > 0) {
        fastify.log.info(
          { markedCount: result.markedCount },
          "Marked stale exam attempts as disrupted",
        );
      }
    } catch (err) {
      fastify.log.error({ err }, "Error scanning for disrupted attempts");
    } finally {
      scanRunning = false;
    }
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
  });
};

export default fp(heartbeatPlugin);
