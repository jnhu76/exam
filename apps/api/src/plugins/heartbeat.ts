import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { ExamAttempt, Permission, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { markDisrupted, type AttemptRepository } from "@exam/exam-engine";

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

export function scanForDisruptedAttempts(
  activeAttempts: DisruptedCandidate[],
  now: Date,
  heartbeatTimeoutMs: number,
  onDisrupted: (attemptId: string) => void,
): ScanResult {
  let markedCount = 0;

  for (const attempt of activeAttempts) {
    if (attempt.status !== "in_progress") continue;
    if (!attempt.lastActivityAt) continue;

    const elapsed = now.getTime() - attempt.lastActivityAt.getTime();
    if (elapsed >= heartbeatTimeoutMs) {
      onDisrupted(attempt.id);
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
    role: "SuperAdmin",
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
    findById: (id) => repo.findById(ctx, id) as ExamAttempt | null,
    findActiveByEnrollment: (enrollmentId) =>
      repo.findActiveByEnrollment(ctx, enrollmentId) as ExamAttempt | null,
    findByEnrollmentAndAttemptNo: (enrollmentId, attemptNo) =>
      repo.findByEnrollmentAndAttemptNo(
        ctx,
        enrollmentId,
        attemptNo,
      ) as ExamAttempt | null,
    create: (input) =>
      repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      ) as ExamAttempt,
    update: (id, data) =>
      repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      ) as ExamAttempt | null,
  };
}

export function scanDatabaseForDisruptedAttempts(
  fastify: Parameters<FastifyPluginAsync>[0],
  now = new Date(),
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
): ScanResult {
  const organizationRepo = createOrganizationRepo(fastify.db);
  const organizations = organizationRepo.list(createSystemContext("system"));
  let markedCount = 0;

  for (const organization of organizations) {
    const ctx = createSystemContext(organization.id);
    const attemptRepo = createAttemptRepo(fastify.db);
    const attempts = attemptRepo.listInProgress(ctx);
    const result = scanForDisruptedAttempts(
      attempts,
      now,
      heartbeatTimeoutMs,
      (attemptId) =>
        markDisrupted(createAttemptRepoAdapter(attemptRepo, ctx), attemptId),
    );
    markedCount += result.markedCount;
  }

  return { markedCount };
}

const heartbeatPlugin: FastifyPluginAsync = async (fastify) => {
  const scanIntervalMs = readPositiveInteger(
    process.env.HEARTBEAT_SCAN_INTERVAL_MS,
    DEFAULT_SCAN_INTERVAL_MS,
  );
  const heartbeatTimeoutMs = readPositiveInteger(
    process.env.HEARTBEAT_TIMEOUT_MS,
    DEFAULT_HEARTBEAT_TIMEOUT_MS,
  );

  const interval = setInterval(() => {
    const result = scanDatabaseForDisruptedAttempts(
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
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
  });
};

export default fp(heartbeatPlugin);
