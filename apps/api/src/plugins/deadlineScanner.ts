import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Exam, ExamAttempt, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  submitAttempt,
  gradeAttemptIdempotent,
  isAttemptDeadlineExpired,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const SYSTEM_ACTOR_ID = SYSTEM_ACTOR_IDS.DeadlineScanner;

/**
 * A candidate for deadline auto-submission, produced by
 * `attemptRepo.listDeadlineCandidates` (DERIVED discovery predicate, NOT an
 * authority). The scanner iterates these and makes the authoritative expiry
 * decision under `Attempt FOR UPDATE` + `Exam FOR UPDATE` in
 * `autoSubmitAndGrade`. A candidate MUST NOT be auto-submitted without that
 * under-lock canonical recheck.
 *
 * Discovery is complete over the scanner-eligible domain (P0-C coverage):
 * NULL per-attempt deadlines are candidates once `exam.closeAt <= now`. Per
 * P0-C1 this NULL coverage is DEFENSIVE recovery over the schema-admissible
 * NULL domain — reachable active attempts always carry a non-null
 * `deadlineAt` (invariant ACTIVE-DEADLINE-001) — not a Phase-1 timing mode.
 */
export interface DeadlineCandidate {
  id: string;
  status: string;
  organizationId: string;
}

export interface ScanResult {
  submittedCount: number;
  failedCount: number;
}

/**
 * In-memory metrics for the deadline scanner, updated after each scan cycle.
 * These are single-instance counters reset on server restart.
 */
export const deadlineScannerMetrics = {
  lastScanAt: null as Date | null,
  autoSubmitCount: 0,
  failedCount: 0,
  /**
   * Effective scan interval in milliseconds. Updated at plugin registration.
   */
  scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
};

/**
 * Iterates DB-discovered candidates and invokes `onCandidate` for each.
 *
 * The candidate set is produced by `listDeadlineCandidates` (DERIVED discovery
 * predicate, exact over the FULL scanner-eligible domain — reachable non-NULL
 * `deadlineAt` rows PLUS the defensive NULL domain where
 * EffectiveDeadline = exam.closeAt per P0-C1). This function performs NO
 * in-memory expiry filtering — there is no second competing authority. The
 * authoritative expiry decision lives in `autoSubmitAndGrade`, which re-checks
 * the canonical `isAttemptDeadlineExpired` seam under `Attempt FOR UPDATE` +
 * `Exam FOR UPDATE`. A `false` return from `onCandidate` (candidate was not
 * actually expired under lock — e.g. extended between discovery and lock) is
 * NOT counted as a submission.
 *
 * `now` is threaded through as the single time sample for the cycle.
 */
export async function scanDeadlineCandidates(
  candidates: DeadlineCandidate[],
  now: Date,
  onCandidate: (attemptId: string) => Promise<boolean | void>,
  options: { onError?: (attemptId: string, err: unknown) => void } = {},
): Promise<ScanResult> {
  let submittedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    try {
      const result = await onCandidate(candidate.id);
      if (result !== false) {
        submittedCount++;
      }
    } catch (err) {
      failedCount++;
      options.onError?.(candidate.id, err);
    }
  }

  return { submittedCount, failedCount };
}

// SYSTEM-M1: system actor context built by the shared @exam/authz factory
// (role=System, actorId=system:deadline-scanner). Replaces the prior
// role:"Admin" synthetic context. Scanner code never reads ctx.permissions.
function createSystemContext(organizationId: string): RequestContext {
  return createSystemRequestContext(organizationId, SYSTEM_ACTOR_ID);
}

/**
 * Authoritative deadline auto-submit + grade for ONE attempt.
 *
 * Concurrency model (proven for the `extendExam(closeAt) || Scanner` race):
 *
 * 1. `executeInTransaction` runs at REPEATABLE READ with 40001/40P01 retry.
 * 2. Lock `Attempt FOR UPDATE` first.
 * 3. Lock `Exam FOR UPDATE` AFTER the attempt lock — lock order is
 *    `Attempt → Exam`. This is consistent with `extendAttemptTime` (which
 *    locks Attempt then reads Exam) and inverts no existing path (admin
 *    exam transitions lock Exam only; `extendExam` locks Exam only). No
 *    `Exam → Attempt` path exists, so no deadlock inversion is introduced.
 * 4. The `Exam FOR UPDATE` is the SERIALIZATION POINT vs `extendExam`
 *    (which takes `Exam FOR UPDATE` in `executeAdminExamTransition`):
 *    - if the scanner's Exam lock acquires before `extendExam` commits, the
 *      scanner sees the pre-extension closeAt (and may submit if it is past);
 *    - if `extendExam` commits first, the scanner's `Exam FOR UPDATE` under
 *      REPEATABLE READ raises 40001 serialization_failure, which
 *      `executeInTransaction` retries; on retry the scanner sees the
 *      post-extension closeAt and correctly does NOT submit.
 *    Either outcome is a valid linearization.
 * 5. The canonical `isAttemptDeadlineExpired(exam, lockedAttempt, now)` seam
 *    is the SOLE authority for "submit or skip". A candidate that was extended
 *    or reconciled between discovery and lock returns false here → no-op.
 *
 * @returns true iff the attempt was submitted+graded by this call.
 */
export async function autoSubmitAndGrade(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  now: Date,
): Promise<boolean> {
  const stateChanged = await executeInTransaction(db, async (tx) => {
    // P3-FORMAL-P0-D2: build the engine repo pair once, mint the EA capability
    // via the canonical seam BEFORE the Exam FOR UPDATE. The resulting
    // scanner-local lock order is Enrollment → Attempt → Exam (the seam's
    // E→A followed by the Exam lock). Documented here only as the audited
    // scanner ordering; NOT promoted to a global invariant.
    const txAttemptRepo = createAttemptRepo(tx);
    const txEnrollmentRepo = createEnrollmentRepo(tx);
    const txExamRepo = createExamRepo(tx);
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: txExamRepo,
        attemptRepo: txAttemptRepo,
        enrollmentRepo: txEnrollmentRepo,
      },
      ctx,
    );
    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      attemptId,
    );
    const locked = await attempts.findById(attemptId);
    if (!locked) return false;
    if (locked.status !== "in_progress" && locked.status !== "disrupted") {
      return false;
    }

    // Authoritative Exam read under FOR UPDATE — serialization point vs
    // extendExam (Decision B). Lock order Enrollment → Attempt → Exam here.
    const lockedExam = await txExamRepo.findByIdForUpdate(ctx, locked.examId);
    if (!lockedExam) return false;

    // CANONICAL AUTHORITY: the ONLY "is this attempt expired?" decision that
    // triggers mutation. Never re-derive deadlineAt<=now || closeAt<=now here;
    // that OR predicate exists ONLY in the DB discovery query. Cast the locked
    // DB rows to domain types (status string -> Exam/AttemptStatus), matching
    // createExamRepoAdapter's cast — the canonical seam needs the union types.
    if (
      !isAttemptDeadlineExpired(lockedExam as Exam, locked as ExamAttempt, now)
    ) {
      // Discovery was a superset / stale snapshot (extended, or already
      // reconciled): no-op this tick. Not an error.
      return false;
    }

    // ADR-005 Slice 3: deadline scanner bypasses minSubmitAfterStartMinutes
    // (source = deadline_scanner). P3-L0-2: record submissionReason='deadline'
    // so the frozen submitted_answers carries the deadline-trigger marker.
    // P3-L0-2E: submitAttempt owns grading workset materialization.
    const gradingWorksetRepo = createGradingWorksetRepoAdapter(
      createAttemptGradingEntryRepo(tx),
      ctx,
    );

    // R1/R9: build the interruption resolution based on the locked attempt's
    // status. The deadline scanner handles both in_progress and disrupted
    // attempts. For disrupted attempts, the resolution terminalizes the active
    // interruption episode with a deadline_terminalization reason code.
    const episodeRepo = createInterruptionEpisodeRepoAdapter(
      createAttemptInterruptionRepo(tx),
      ctx,
    );
    const eventRepo = createInterruptionEventRepoAdapter(
      createAttemptInterruptionEventRepo(tx),
      ctx,
    );

    let resolution: SubmitInterruptionResolution;
    if (locked.status === "disrupted") {
      // Disrupted: terminalize with the attempt's policy snapshot.
      // eligibleSeconds is null because the scanner does not make a
      // compensation decision — it directly terminalizes.
      const policy =
        (locked as ExamAttempt).interruptionTimingPolicySnapshot?.policy ??
        "strict";
      resolution = {
        mode: "active_interruption",
        episodeRepo,
        eventRepo,
        hint: {
          policy,
          eligibleSeconds: null,
          adjustmentId: null,
          reasonCode: "deadline_terminalization",
        },
      };
    } else {
      // in_progress: no active interruption to resolve.
      resolution = {
        mode: "none",
        episodeRepo,
        eventRepo,
      };
    }

    await submitAttempt(attempts, gradingWorksetRepo, attemptId, now, {
      source: "deadline_scanner",
      submissionReason: "deadline",
      resolution,
    });

    // Slice 4: gradeAttemptIdempotent now takes the tx-scoped workset repo so
    // it can aggregate from the entries submitAttempt just materialized.
    // P3-FORMAL-P0-D2: the capability is the EA protocol authority.
    await gradeAttemptIdempotent(
      exams,
      enrollments,
      attempts,
      gradingWorksetRepo,
      cap,
      now,
    );

    return true;
  });

  if (!stateChanged) return false;

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
    // DERIVED discovery predicate (exact over the full scanner-eligible
    // domain — reachable non-NULL deadlineAt rows plus the defensive NULL
    // domain per P0-C1, where NULL => exam.closeAt). The authoritative
    // decision is the under-lock canonical recheck in autoSubmitAndGrade —
    // candidate membership never submits directly.
    const candidates = await attemptRepo.listDeadlineCandidates(ctx, now);

    const result = await scanDeadlineCandidates(
      candidates.map((c) => ({
        id: c.id,
        status: c.status,
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
  deadlineScannerMetrics.scanIntervalMs = scanIntervalMs;

  let activeScan: Promise<void> | null = null;
  let closing = false;
  const interval = setInterval(() => {
    if (closing || activeScan) return;
    activeScan = (async () => {
      try {
        const result = await scanDatabaseForExpiredAttempts(fastify);
        deadlineScannerMetrics.lastScanAt = fastify.now();
        deadlineScannerMetrics.autoSubmitCount += result.submittedCount;
        deadlineScannerMetrics.failedCount += result.failedCount;
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
      }
    })().finally(() => {
      activeScan = null;
    });
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    await activeScan;
  });
};

export default fp(deadlineScannerPlugin);
