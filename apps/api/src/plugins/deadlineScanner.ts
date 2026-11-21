import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import type { Exam, ExamAttempt, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { createAttemptInterruptionRepo } from "@exam/db/repository/attemptInterruptionRepo";
import { createAttemptInterruptionEventRepo } from "@exam/db/repository/attemptInterruptionEventRepo";
import { executeInTransaction } from "@exam/db/types";
import type { Database } from "@exam/db/types";
import {
  submitAttempt,
  gradeAttemptIdempotent,
  isAttemptDeadlineExpired,
  computeEffectiveDeadline,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { raceLoopShutdown } from "../lib/loopShutdown.js";

const SYSTEM_ACTOR_ID = SYSTEM_ACTOR_IDS.DeadlineScanner;

/**
 * A candidate for deadline auto-submission, produced by
 * `attemptRepo.listDeadlineCandidates` (DERIVED discovery predicate, NOT an
 * authority). The scanner iterates these and makes the authoritative expiry
 * decision under `Attempt FOR UPDATE` + `Exam FOR UPDATE` in
 * `autoSubmitAndGrade`. A candidate MUST NOT be auto-submitted without that
 * under-lock canonical recheck.
 *
 * Discovery is complete over the scanner-eligible domain. Since #291, NULL
 * per-attempt deadlines are a REACHABLE protocol state: `deadline`-mode
 * attempts carry deadlineAt = null and expire via
 * `exam.closeAt <= now`; `untimed` attempts (closeAt also null) can appear in
 * discovery only by accident and the under-lock canonical recheck always
 * rejects them (null effective deadline never expires).
 */
export interface DeadlineCandidate {
  id: string;
  status: string;
  organizationId: string;
}

export interface ScanResult {
  submittedCount: number;
  failedCount: number;
  /**
   * #1009 tick-local settlement inputs, NOT new persistent counters —
   * `deadlineScannerMetrics` stays the only counter authority.
   *
   * `discoveredCount` is the size of the DERIVED discovery set
   * (`listDeadlineCandidates` rows this scan iterated). `noOpCount` counts
   * candidates whose `autoSubmitAndGrade` resolved `false` under lock (the
   * canonical recheck rejected them — extended/reconciled between discovery
   * and lock). Every iterated candidate lands in exactly one of the three
   * buckets, so submitted + failed + noOp <= discoveredCount.
   */
  discoveredCount: number;
  noOpCount: number;
}

/**
 * In-memory metrics for the deadline scanner, updated after each scan cycle.
 * These are single-instance counters reset on server restart.
 *
 * #547 stall facts: `lastSettledAt` is the STALL AUTHORITY (settled = the
 * tick body finished, success OR error). `lastScanAt` keeps its existing
 * contract (stamped after a completed scan) for diagnostics.
 */
export const deadlineScannerMetrics = {
  startedAt: null as Date | null,
  lastStartedAt: null as Date | null,
  lastSettledAt: null as Date | null,
  activeSince: null as Date | null,
  lastScanAt: null as Date | null,
  autoSubmitCount: 0,
  failedCount: 0,
  /**
   * #862 escalation input: consecutive SETTLED ticks with failedCount > 0,
   * reset to 0 by the first clean settle. A tick-level throw neither
   * increments nor resets this counter (frozen): a thrown cycle carries no
   * business-failure evidence, and a throw is not evidence the business work
   * recovered. Process-local; reset on server restart. Consumed by the
   * operability monitor's `operability.business_failure` transition.
   */
  consecutiveFailedTicks: 0,
  /**
   * #885 escalation input: consecutive ticks whose body THREW — the exception
   * escaped to the tick-level catch. Reset to 0 by the first tick that
   * settles without throwing. A tick that settles WITH business failures is
   * not a throw (that is `consecutiveFailedTicks` above). Process-local;
   * reset on server restart. Consumed by the operability monitor's
   * `operability.tick_failure` transition (ADR-024).
   */
  consecutiveThrowTicks: 0,
  /**
   * Effective scan interval in milliseconds. INVARIANT: this is a
   * pre-registration placeholder (0); the plugin registration writes the
   * configured interval before the server starts listening, so no request
   * ever observes the placeholder.
   */
  scanIntervalMs: 0,
};

/**
 * Iterates DB-discovered candidates and invokes `onCandidate` for each.
 *
 * The candidate set is produced by `listDeadlineCandidates` (DERIVED discovery
 * predicate — an over-approximation; rows with NULL `deadlineAt` resolve to
 * EffectiveDeadline = exam.closeAt, and untimed rows resolve to null). This
 * function performs NO
 * in-memory expiry filtering — there is no second competing authority. The
 * authoritative expiry decision lives in `autoSubmitAndGrade`, which re-checks
 * the canonical `isAttemptDeadlineExpired` seam under `Attempt FOR UPDATE` +
 * `Exam FOR UPDATE`. A `false` return from `onCandidate` (candidate was not
 * actually expired under lock — e.g. extended between discovery and lock) is
 * NOT counted as a submission; it is recorded as `noOpCount` (#1009).
 *
 * `now` is the discovery tick sample that selected the candidates; the
 * per-attempt processing instant is owned by the `onCandidate` callback
 * (see TIME OWNERSHIP below).
 *
 * TIME OWNERSHIP (H-04 review r1): the iterator itself is time-agnostic;
 * the discovery tick that selected the candidates and the per-attempt
 * processing instant are DIFFERENT samples. `scanDatabaseForExpiredAttempts`
 * re-samples its injectable clock inside the `onCandidate` callback so each
 * `autoSubmitAndGrade` observes the actual handling instant (expiry recheck,
 * grading, terminalization) — never a whole-cycle tick that may predate a
 * disruption committed mid-scan by the heartbeat scanner.
 */
export async function scanDeadlineCandidates(
  candidates: DeadlineCandidate[],
  now: Date,
  onCandidate: (attemptId: string) => Promise<boolean | void>,
  options: { onError?: (attemptId: string, err: unknown) => void } = {},
): Promise<ScanResult> {
  let submittedCount = 0;
  let failedCount = 0;
  let noOpCount = 0;

  for (const candidate of candidates) {
    try {
      const result = await onCandidate(candidate.id);
      if (result !== false) {
        submittedCount++;
      } else {
        noOpCount++;
      }
    } catch (err) {
      failedCount++;
      options.onError?.(candidate.id, err);
    }
  }

  return {
    submittedCount,
    failedCount,
    discoveredCount: candidates.length,
    noOpCount,
  };
}

// System actor context from the shared @exam/authz factory (role=System,
// actorId from SYSTEM_ACTOR_IDS). Scanner code never reads ctx.permissions.
function createSystemContext(organizationId: string): RequestContext {
  return createSystemRequestContext(organizationId, SYSTEM_ACTOR_ID);
}

/**
 * Bounded wait for the scanner transaction's EA-seam row locks
 * (Enrollment → Attempt → Exam), applied via `executeInTransaction`'s
 * `lockTimeoutMs` option.
 *
 * WHY (#1071 / R-T4-1): without a bound, a competitor transaction holding
 * one of these rows parks the tick on the lock indefinitely — single-flight
 * then skips every subsequent tick and no candidate settles until the holder
 * releases (measured: 5.2s/8.0s holds → ~20/31 skipped ticks, zero
 * settlements during the hold). With the bound, a held lock degrades to a
 * 55P03 (lock_not_available) failure of THIS candidate for THIS tick — the
 * whole transaction rolls back (the attempt stays in_progress, nothing is
 * half-written), the candidate is counted in `failedCount` and the loop
 * continues; the next tick retries it, so the final settlement is never
 * lost and never duplicated.
 *
 * PROTOCOL: scanner-scoped only. The value sits inside the #1071 contract
 * window (2–5s): long enough to ride out ordinary concurrent-statement
 * jitter, short enough that a blocked tick still settles far below the
 * default 30s scan cadence, so a sustained hold surfaces as counted
 * per-tick failures (the `consecutiveFailedTicks` #862 escalation input)
 * instead of a silent single-flight stall. Candidate submit/save paths do
 * not pass a lock timeout and keep the unbounded wait.
 */
const SCANNER_LOCK_TIMEOUT_MS = 3000;

/**
 * Authoritative deadline auto-submit + grade for ONE attempt.
 *
 * Concurrency model (proven for the `extendExam(closeAt) || Scanner` race):
 *
 * 1. `executeInTransaction` runs at REPEATABLE READ with 40001/40P01 retry.
 *    The transaction is additionally bounded by `SCANNER_LOCK_TIMEOUT_MS`
 *    (#1071): a lock wait longer than the bound aborts the whole
 *    transaction with 55P03, which surfaces as THIS candidate's
 *    per-candidate failure — see the constant doclet for the ownership and
 *    retry semantics.
 * 2. `lockEnrollmentAndAttempt` locks `Enrollment FOR UPDATE` first, then
 *    `Attempt FOR UPDATE` — the EA-seam protocol shared with the operator
 *    time grant engine.
 * 3. Lock `Exam FOR UPDATE` AFTER both — scanner-local lock order is
 *    `Enrollment → Attempt → Exam` (see the audited ordering note inside the
 *    function). Admin exam transitions lock Exam only and `extendExam` locks
 *    Exam only, so no `Exam → Attempt` path exists and no deadlock inversion
 *    is introduced.
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
 * Time semantics (two distinct instants per submission): the deadline
 * submission's business valid `submittedAt` is the canonical effective
 * deadline D — the same semantic as the lazy on-read reconciliation path —
 * while `now` (the PER-CANDIDATE processing sample, not the discovery tick)
 * is the actual-execution instant for the expiry recheck, grading and
 * interruption terminalization (`terminalized.occurredAt`).
 *
 * @returns true iff the attempt was submitted+graded by this call.
 */
export async function autoSubmitAndGrade(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  now: Date,
): Promise<boolean> {
  const stateChanged = await executeInTransaction(
    db,
    async (tx) => {
      // EA lock-order protocol: build the engine repo pair once, mint the
      // EA capability
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
        !isAttemptDeadlineExpired(
          lockedExam as Exam,
          locked as ExamAttempt,
          now,
        )
      ) {
        // Discovery was a superset / stale snapshot (extended, or already
        // reconciled): no-op this tick. Not an error.
        return false;
      }

      // The scanner bypasses minSubmitAfterStartMinutes (ADR-005) and marks the
      // submission source/reason so the frozen submitted_answers carry the
      // deadline-trigger marker. Grading workset materialization is owned by
      // submitAttempt, not by this caller.
      const gradingWorksetRepo = createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        ctx,
      );

      // The deadline submission's business valid submittedAt is the canonical
      // effective deadline D, not the scan tick (same semantic as the lazy
      // on-read reconciliation path; exam-runtime.md §5.4). A positive
      // `isAttemptDeadlineExpired` above implies D is non-null (null never
      // expires); the guard keeps that fact type-honest and fails safe as a
      // no-op instead of freezing an attempt that has no deadline. The tick
      // `now` stays the actual-execution instant for grading below.
      const effectiveDeadline = computeEffectiveDeadline(
        lockedExam as Exam,
        locked as ExamAttempt,
      );
      if (effectiveDeadline === null) {
        return false;
      }

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

      await submitAttempt(
        attempts,
        gradingWorksetRepo,
        attemptId,
        effectiveDeadline,
        {
          source: "deadline_scanner",
          submissionReason: "deadline",
          resolution,
          // Two distinct instants: the submit is backdated to the business
          // effective deadline D, while an interruption terminalization must
          // record when this tick actually observed/processed it. Passing D
          // there could place `terminalized.occurredAt` before the episode's
          // detected event.
          terminalizationObservedAt: now,
        },
      );

      // Grade in the same transaction from the workset entries submitAttempt just
      // materialized; `cap` is the EA (enrollment+attempt) protocol authority
      // minted under the lock above.
      await gradeAttemptIdempotent(
        exams,
        enrollments,
        attempts,
        gradingWorksetRepo,
        cap,
        now,
      );

      return true;
    },
    { lockTimeoutMs: SCANNER_LOCK_TIMEOUT_MS },
  );

  if (!stateChanged) return false;

  return true;
}

/**
 * @param tickId #1009: the firing tick's own identity (one `randomUUID()` per
 * tick, owned by the plugin tick body — never an HTTP requestId). Propagated
 * into the per-candidate error lines below as the join key to the tick's
 * `scanner.tick.completed` settlement line. Optional so direct callers
 * (regression suites) can invoke the scan without minting a tick identity;
 * the serialized field is simply absent then.
 */
export async function scanDatabaseForExpiredAttempts(
  fastify: FastifyInstance,
  nowFn: () => Date = () => fastify.now(),
  tickId?: string,
): Promise<ScanResult> {
  // Whole-cycle discovery tick: one sample up front selects the candidate
  // set (listDeadlineCandidates). Per-candidate processing re-samples
  // nowFn() so the expiry recheck, grading and interruption terminalization
  // observe the actual handling instant — never a tick that may predate a
  // disruption committed mid-scan by the heartbeat scanner.
  const now = nowFn();
  const db = fastify.db as Database;
  const organizationRepo = createOrganizationRepo(db);
  const organizations = await organizationRepo.list(
    createSystemContext("system"),
  );

  let submittedCount = 0;
  let failedCount = 0;
  let discoveredCount = 0;
  let noOpCount = 0;

  for (const organization of organizations) {
    const ctx = createSystemContext(organization.id);
    const attemptRepo = createAttemptRepo(db);
    // DERIVED discovery predicate (over-approximation over the full
    // scanner-eligible domain). The authoritative decision is the under-lock
    // canonical recheck in autoSubmitAndGrade — candidate membership never
    // submits directly, and untimed attempts (null close + null deadline)
    // are never expired by that recheck.
    const candidates = await attemptRepo.listDeadlineCandidates(ctx, now);

    const result = await scanDeadlineCandidates(
      candidates.map((c) => ({
        id: c.id,
        status: c.status,
        organizationId: c.organizationId,
      })),
      now,
      async (attemptId) => {
        return autoSubmitAndGrade(db, ctx, attemptId, nowFn());
      },
      {
        onError: (attemptId, err) => {
          // INTENTIONAL (review of #1009): the per-candidate error line is
          // post-failure diagnostics, isolated from the candidate loop and
          // the scan-throw classification exactly like the settlement line
          // in the tick body. A synchronously throwing sink must neither
          // abort the remaining candidates of this tick nor reclassify the
          // tick as a throw (consecutiveThrowTicks /
          // operability.tick_failure): the candidate's failure has already
          // been counted where it belongs (failedCount →
          // consecutiveFailedTicks). Losing this line is the accepted cost —
          // the sink that just threw is not a channel to report the loss on.
          try {
            fastify.log.error(
              {
                err,
                attemptId,
                organizationId: organization.id,
                ...(tickId === undefined ? {} : { tickId }),
              },
              "Failed to auto-submit expired attempt",
            );
          } catch {
            // swallowed by design — see INTENTIONAL above
          }
        },
      },
    );

    submittedCount += result.submittedCount;
    failedCount += result.failedCount;
    discoveredCount += result.discoveredCount;
    noOpCount += result.noOpCount;
  }

  return { submittedCount, failedCount, discoveredCount, noOpCount };
}

const deadlineScannerPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  // Plugin config reads go through the canonical loader, never process.env.
  const scanIntervalMs = config.heartbeat.deadlineScanIntervalMs;
  deadlineScannerMetrics.scanIntervalMs = scanIntervalMs;
  // #547: WARMING grace origin — recorded once, at registration.
  deadlineScannerMetrics.startedAt = fastify.now();

  let activeScan: Promise<void> | null = null;
  // #1055: identity of the in-flight tick, kept beside its promise so the
  // close hook can name the tick it abandons when the shutdown budget expires.
  let activeTickId: string | null = null;
  let closing = false;
  const interval = setInterval(() => {
    if (closing || activeScan) return;
    // #885: tick-local throw evidence, declared in the tick's own scope so the
    // existing .finally() below — the one point every tick passes through —
    // maintains the run-length counter without a second write point.
    let threw = false;
    // PROTOCOL (#1009): one randomUUID per FIRED tick — the join key between
    // this tick's per-candidate error lines, its settlement line, and its
    // tick-level error line. A background identity, never an HTTP requestId;
    // skipped ticks (the early return above) mint none.
    const tickId = randomUUID();
    activeTickId = tickId;
    activeScan = (async () => {
      // #547 stall facts: in-flight window; settle clears activeSince and
      // stamps lastSettledAt in .finally (success or error alike).
      const startedAt = fastify.now();
      deadlineScannerMetrics.lastStartedAt = startedAt;
      deadlineScannerMetrics.activeSince = startedAt;
      try {
        const result = await scanDatabaseForExpiredAttempts(
          fastify,
          undefined,
          tickId,
        );
        deadlineScannerMetrics.lastScanAt = fastify.now();
        deadlineScannerMetrics.autoSubmitCount += result.submittedCount;
        deadlineScannerMetrics.failedCount += result.failedCount;
        // #862 escalation input: a settled tick with failures extends the
        // consecutive run; the first clean settle resets it.
        deadlineScannerMetrics.consecutiveFailedTicks =
          result.failedCount > 0
            ? deadlineScannerMetrics.consecutiveFailedTicks + 1
            : 0;
        // INVARIANT (#1009): exactly ONE settlement line per NON-EMPTY tick
        // (any discovered/submitted/failed candidate); empty ticks stay
        // silent — the accepted blindspot, there is no `empty` outcome. The
        // three buckets are exhaustive over the discovery set, so the mapping
        // covers every settled non-empty tick. A thrown tick never reaches
        // this point (the catch path keeps the error line, no settlement).
        if (
          result.submittedCount + result.failedCount + result.discoveredCount >
          0
        ) {
          const outcome =
            result.failedCount > 0
              ? "partial_failure"
              : result.submittedCount > 0
                ? "acted"
                : "no_op";
          // INTENTIONAL (review of #1009): the settlement line is post-scan
          // telemetry, so its emission is isolated from the scan-throw
          // classification below. A failing log sink must never be counted
          // as a scan throw, or operability.tick_failure (fed by
          // consecutiveThrowTicks) would fire on a healthy scanner. Losing
          // this tick's line is the accepted cost — the sink that just threw
          // is not a channel to report the loss on.
          try {
            fastify.log.info({
              event: "scanner.tick.completed",
              scanner: "deadline",
              tickId,
              outcome,
              submittedCount: result.submittedCount,
              failedCount: result.failedCount,
              discoveredCount: result.discoveredCount,
              noOpCount: result.noOpCount,
            });
          } catch {
            // swallowed by design — see INTENTIONAL above
          }
        }
      } catch (err) {
        threw = true;
        // INTENTIONAL (review of #1009): the tick-level error line is
        // post-failure diagnostics, isolated exactly like the settlement
        // line above. A synchronously throwing sink must not escape the tick
        // body: activeScan would become an unhandled rejection
        // (process-fatal under Node's default policy) while the scan has
        // already settled as a throw. Losing the tick's only error record is
        // the accepted cost — the sink that just threw is not a channel to
        // report the loss on.
        try {
          fastify.log.error(
            { err, tickId },
            "Error scanning for expired attempts",
          );
        } catch {
          // swallowed by design — see INTENTIONAL above
        }
      }
    })().finally(() => {
      activeScan = null;
      activeTickId = null;
      deadlineScannerMetrics.activeSince = null;
      deadlineScannerMetrics.consecutiveThrowTicks = threw
        ? deadlineScannerMetrics.consecutiveThrowTicks + 1
        : 0;
      deadlineScannerMetrics.lastSettledAt = fastify.now();
    });
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    // #1055: never await an in-flight tick unbounded — a tick blocked on a
    // DB lock would hold app.close() past the compose stop grace (SIGKILL /
    // 137). The shared loop budget bounds the wait; an abandoned tick keeps
    // running and its transaction still settles under executeInTransaction.
    await raceLoopShutdown({
      fastify,
      inFlight: activeScan,
      messages: {
        clean: "Deadline scanner stopped cleanly",
        failed: "Deadline scanner failed during shutdown",
        abandoned:
          "Deadline scanner shutdown timeout; in-flight tick abandoned and will settle under its own transaction owner",
      },
      abandonedFields: activeTickId === null ? {} : { tickId: activeTickId },
    });
  });
};

export default fp(deadlineScannerPlugin);
