import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type {
  Exam,
  ExamAttempt,
  Permission,
  RequestContext,
} from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  submitAttempt,
  gradeAttemptIdempotent,
  type EnrollmentRepository,
} from "@exam/exam-engine";
import {
  createExamRepoAdapter,
  createAttemptRepoAdapter,
  createEnrollmentRepoAdapter,
} from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const SYSTEM_ACTOR_ID = "system:deadline-scanner";

export interface ExpiredAttemptCandidate {
  id: string;
  status: string;
  deadlineAt?: Date | null;
  organizationId: string;
}

const AUTOSUBMITTABLE_STATUSES: ReadonlySet<string> = new Set([
  "in_progress",
  "disrupted",
]);

export function selectExpiredAttempts(
  attempts: ExpiredAttemptCandidate[],
  now: Date,
): ExpiredAttemptCandidate[] {
  const nowMs = now.getTime();
  return attempts.filter((attempt) => {
    if (!AUTOSUBMITTABLE_STATUSES.has(attempt.status)) {
      return false;
    }
    if (!attempt.deadlineAt) return false;
    return attempt.deadlineAt.getTime() <= nowMs;
  });
}

export interface ScanResult {
  submittedCount: number;
  failedCount: number;
}

export async function scanExpiredAttempts(
  attempts: ExpiredAttemptCandidate[],
  now: Date,
  onExpired: (attemptId: string) => Promise<boolean | void>,
  options: { onError?: (attemptId: string, err: unknown) => void } = {},
): Promise<ScanResult> {
  const expired = selectExpiredAttempts(attempts, now);
  let submittedCount = 0;
  let failedCount = 0;

  for (const attempt of expired) {
    try {
      const result = await onExpired(attempt.id);
      if (result !== false) {
        submittedCount++;
      }
    } catch (err) {
      failedCount++;
      options.onError?.(attempt.id, err);
    }
  }

  return { submittedCount, failedCount };
}

function createSystemContext(organizationId: string): RequestContext {
  return {
    actorId: SYSTEM_ACTOR_ID,
    organizationId,
    role: "Admin",
    permissions: [] as Permission[],
    sessionId: SYSTEM_ACTOR_ID,
    targetOrganizationId: organizationId,
  };
}

export async function autoSubmitAndGrade(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  now: Date,
): Promise<boolean> {
  const stateChanged = await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const locked = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
    if (!locked) return false;
    if (locked.status !== "in_progress" && locked.status !== "disrupted") {
      return false;
    }

    const attemptRepoAdapter = createAttemptRepoAdapter(txAttemptRepo, ctx);
    await submitAttempt(attemptRepoAdapter, attemptId, now);

    const examRepo = createExamRepo(tx);
    const enrollmentRepo = createEnrollmentRepo(tx);
    await gradeAttemptIdempotent(
      createExamRepoAdapter(examRepo, ctx),
      createEnrollmentRepoAdapter(enrollmentRepo, ctx),
      attemptRepoAdapter,
      attemptId,
      now,
    );

    return true;
  });

  if (!stateChanged) return false;

  try {
    await createAuditLogRepo(db).create(ctx, {
      actorId: SYSTEM_ACTOR_ID,
      action: "attempt.autoSubmit",
      targetType: "attempt",
      targetId: attemptId,
      metadata: { source: "deadline-scanner" },
    });
  } catch {
    // Audit is best-effort; scanner must not fail because of audit write.
  }

  return true;
}

export async function scanDatabaseForExpiredAttempts(
  fastify: FastifyInstance,
  now: Date = fastify.now(),
): Promise<ScanResult> {
  const db = fastify.db as Database;
  const organizationRepo = createOrganizationRepo(db);
  const organizations = await organizationRepo.list(
    createSystemContext("system"),
  );

  let submittedCount = 0;
  let failedCount = 0;

  for (const organization of organizations) {
    const ctx = createSystemContext(organization.id);
    const attemptRepo = createAttemptRepo(db);
    const candidates = await attemptRepo.listExpirableByDeadline(ctx, now);

    const result = await scanExpiredAttempts(
      candidates.map((c) => ({
        id: c.id,
        status: c.status,
        deadlineAt: c.deadlineAt,
        organizationId: c.organizationId,
      })),
      now,
      async (attemptId) => {
        return autoSubmitAndGrade(db, ctx, attemptId, now);
      },
      {
        onError: (attemptId, err) => {
          fastify.log.error(
            {
              err,
              attemptId,
              organizationId: organization.id,
            },
            "Failed to auto-submit expired attempt",
          );
        },
      },
    );

    submittedCount += result.submittedCount;
    failedCount += result.failedCount;
  }

  return { submittedCount, failedCount };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const deadlineScannerPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const scanIntervalMs = readPositiveInteger(
    process.env.DEADLINE_SCAN_INTERVAL_MS,
    config.heartbeat.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
  );

  let scanRunning = false;
  const interval = setInterval(async () => {
    if (scanRunning) return;
    scanRunning = true;
    try {
      const result = await scanDatabaseForExpiredAttempts(fastify);
      if (result.submittedCount > 0 || result.failedCount > 0) {
        fastify.log.info(
          {
            submittedCount: result.submittedCount,
            failedCount: result.failedCount,
          },
          "Deadline scanner auto-submitted expired attempts",
        );
      }
    } catch (err) {
      fastify.log.error({ err }, "Error scanning for expired attempts");
    } finally {
      scanRunning = false;
    }
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
  });
};

export default fp(deadlineScannerPlugin);
