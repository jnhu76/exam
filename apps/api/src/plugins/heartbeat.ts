import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { ExamAttempt, Permission, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { markDisrupted, type AttemptRepository } from "@exam/exam-engine";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * Minimal representation of an active exam attempt used by the heartbeat
 * scanner. Only the fields required to evaluate staleness are included.
 */
export interface DisruptedCandidate {
  id: string;
  status: string;
  lastActivityAt?: Date | null;
}

/**
 * Result returned by the heartbeat scan, indicating how many active
 * attempts were marked as disrupted during the scan cycle.
 */
export interface ScanResult {
  markedCount: number;
}

/**
 * Scans a list of active attempts and invokes `onDisrupted` for each
 * in-progress attempt whose `lastActivityAt` is older than
 * `heartbeatTimeoutMs` relative to the provided `now` timestamp.
 * Returns the total number of attempts marked as disrupted.
 */
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

/**
 * Parses an environment variable as a positive integer. Returns `fallback`
 * if the value is undefined, not a number, or not a positive integer.
 */
function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Creates a synthetic `RequestContext` representing the system heartbeat
 * actor, used when the background scanner needs to interact with
 * repositories that require a context.
 */
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

/**
 * Wraps a database attempt repository into the `AttemptRepository` interface
 * expected by the exam engine's `markDisrupted` function, binding all
 * calls to the provided system context.
 */
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

/**
 * Iterates over all organizations and scans their in-progress attempts for
 * staleness. Each stale attempt is marked as disrupted via the exam engine.
 * Returns the aggregate count of disrupted attempts across all organizations.
 */
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

/**
 * Fastify plugin that starts a periodic background scanner to detect
 * exam candidates whose heartbeat has timed out and marks their attempts
 * as disrupted. The interval is read from runtime config and the timer
 * is unref'd so it does not keep the process alive.
 */
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
