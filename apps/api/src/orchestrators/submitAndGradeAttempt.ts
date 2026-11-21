import type { RequestContext, ExamAttempt } from "@exam/domain";
import type { FastifyRequest } from "fastify";
import { InvalidStateTransitionError, NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/types";
import { executeInTransaction } from "@exam/db/types";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import { createAttemptInterruptionRepo } from "@exam/db/repository/attemptInterruptionRepo";
import { createAttemptInterruptionEventRepo } from "@exam/db/repository/attemptInterruptionEventRepo";
import {
  submitAttempt,
  readGradingSnapshot,
  finalizeGrading,
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

/**
 * Closed five-value classification of a COMMITTED submit execution (#1007,
 * commit-authoritative). Carried as the transaction callback's return
 * value so every failed/retried attempt's classification is discarded with
 * its transaction — never stashed in an outer mutable variable.
 *
 * | locked-in authoritative path                  | outcome            |
 * | ---------------------------------------------- | ------------------ |
 * | locked `graded`, idempotent early return      | replay_no_change   |
 * | deadline reconciliation froze this execution  | deadline_frozen    |
 * | post-submit gradingStatus pending_manual      | pending_manual     |
 * | fresh submit + finalizeGrading committed      | graded             |
 * | entry `submitted` + finalizeGrading committed | recovered          |
 */
export type SubmitOutcomeClassification =
  | "graded"
  | "pending_manual"
  | "replay_no_change"
  | "deadline_frozen"
  | "recovered";

export interface SubmitAndGradeResult {
  attempt: ExamAttempt;
  /** Legacy boolean: outcome ∈ {replay_no_change, deadline_frozen}. */
  alreadyGraded: boolean;
  /** New closed channel (not part of the public HTTP schema). */
  outcome: SubmitOutcomeClassification;
}

/**
 * Owner-local typed emission boundary for `attempt.submit.completed`
 * (#1007; #1001 方案 A — no central observability module). This is the
 * ONLY place allowed to assemble the line: closed event/outcome vocabulary,
 * field whitelist, identity source (the request-scoped Pino logger, whose
 * `reqId` IS `request.id` — ADR-025 — so no duplicate requestId field) and
 * failure isolation all live here.
 *
 * Payload is a whitelist-only object — never spread request/ctx/result — and
 * carries no answer/score/error/reason content. The emitted line inherits
 * the request-child bindings every authenticated request log already carries
 * (actorId/actorRole/organizationId — plugins/auth.ts, the documented
 * business-line tenant scoping) plus the pino envelope; the emitter itself
 * adds ONLY {event, outcome, attemptId}.
 *
 * INVARIANT (commit-authoritative): the ONLY call site sits after
 * `await executeInTransaction(...)` resolves (COMMIT confirmed) and before
 * the out-of-tx response re-read, so rollback, failed retries and
 * post-commit response failures can neither emit nor rewrite the line.
 * Known blindspot (acceptance pending owner review): a process crash
 * between COMMIT and this synchronous emit loses the line — the durable
 * business fact lives in the database, not the log; no outbox/retry
 * exists by design.
 *
 * INVARIANT (failure isolation): a synchronous sink throw is swallowed at
 * this single point — the committed result, the HTTP response and the
 * transaction retry behavior are unchanged, and the failure is never
 * re-logged (no recursive emission).
 */
export function emitSubmitCompleted(
  log: Pick<FastifyRequest["log"], "info">,
  outcome: SubmitOutcomeClassification,
  attemptId: string,
): void {
  try {
    log.info({
      event: "attempt.submit.completed",
      outcome,
      attemptId,
    });
  } catch {
    // OBSERVABILITY_MUST_NOT_AFFECT_BUSINESS: drop the signal; the committed
    // business outcome stands.
  }
}

/**
 * Orchestrates the candidate submit + grade flow.
 *
 * Submit freeze barrier (ADR-008): submit, answer snapshot read, score
 * computation, and finalization all run inside ONE transaction holding the
 * attempt row lock. Splitting them into separate transactions would leave an
 * inter-tx window where a concurrent `saveAnswer(baseVersion ===
 * currentVersion)` changes which answer the score is computed from (0/100
 * swing). Folding everything into the locked transaction makes the answers
 * captured under the submit lock the grading authority: any save that arrives
 * after `submitAttempt` flips the row to `submitted` is rejected by the answer
 * protocol (`ATTEMPT_ALREADY_SUBMITTED`), and the score is computed from the
 * locked, post-submit answers in the same tx.
 *
 * `submitted` (not yet `graded`) is treated as a crash-recovery case: submit
 * landed but grading didn't, so a retry grades it idempotently without
 * re-submitting. `graded` is the only truly terminal state.
 *
 * When the optional `audit` HTTP handle is present (the candidate submit
 * route), the committed outcome is additionally reported as one
 * `attempt.submit.completed` log line AFTER the transaction resolves — see
 * {@link emitSubmitCompleted}. Callers without a real HTTP request (demo
 * seed grader) omit the handle and emit nothing.
 *
 * Does NOT handle: request validation, candidate profile lookup, or
 * HTTP response serialization.
 */
export async function submitAndGradeAttempt(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  candidateProfileId: string,
  now: Date,
  audit?: { request: FastifyRequest },
): Promise<SubmitAndGradeResult> {
  const outcome: SubmitOutcomeClassification = await executeInTransaction(
    db,
    async (tx) => {
      // EA lock-order protocol: build the engine repo pair ONCE, mint the
      // transaction-affine EA capability via the canonical seam (Enrollment
      // FOR UPDATE before Attempt FOR UPDATE), and thread the SAME repo
      // object instances + capability to every affinity-dependent consumer.
      const txAttemptRepo = createAttemptRepo(tx);
      const txEnrollmentRepo = createEnrollmentRepo(tx);
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
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

      // Re-read mutable attempt state inside this tx (the seam already holds the
      // Attempt lock; REPEATABLE READ sees own writes). Ownership check + status
      // branch use this fresh read.
      const lockedAttempt = await attempts.findById(attemptId);
      if (!lockedAttempt || lockedAttempt.candidateId !== candidateProfileId) {
        throw new NotFoundError("Attempt not found");
      }

      const status = lockedAttempt.status;
      // `graded` is the only truly terminal, nothing-more-to-do state.
      if (status === "graded") {
        return "replay_no_change" as const;
      }
      // `in_progress`/`disrupted` need the submit transition first; `submitted`
      // is a crash-recovery case (submit landed but grading didn't) and is
      // graded directly without re-submitting. Both then run the SAME
      // locked-tx grading block below (the freeze barrier).
      if (
        status === "in_progress" ||
        status === "disrupted" ||
        status === "submitted"
      ) {
        const gradingWorksetRepo = createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(tx),
          ctx,
        );

        // R1/R9: build interruption repos for resolution. These are needed for
        // both reconciliation and submit terminalization.
        const episodeRepo = createInterruptionEpisodeRepoAdapter(
          createAttemptInterruptionRepo(tx),
          ctx,
        );
        const eventRepo = createInterruptionEventRepoAdapter(
          createAttemptInterruptionEventRepo(tx),
          ctx,
        );

        // Build the resolution based on the locked attempt's status.
        // For disrupted: active_interruption with candidate_submit_terminalization.
        // For in_progress: mode none (no active interruption).
        const buildResolution = (
          attemptStatus: ExamAttempt["status"],
        ): SubmitInterruptionResolution => {
          if (attemptStatus === "disrupted") {
            return {
              mode: "active_interruption",
              episodeRepo,
              eventRepo,
              hint: {
                policy:
                  lockedAttempt.interruptionTimingPolicySnapshot?.policy ??
                  "strict",
                eligibleSeconds: null,
                adjustmentId: null,
                reasonCode: "candidate_submit_terminalization",
              },
            };
          }
          return { mode: "none", episodeRepo, eventRepo };
        };

        // Lazy deadline reconciliation before submit. If the attempt
        // is past its effective deadline, freeze it as deadline-submitted
        // (submittedAt = effectiveDeadline, submissionReason='deadline') and
        // return that frozen result. The candidate's submit then returns the
        // existing deadline-submitted snapshot — no new answer payload accepted.
        //
        // After reconciliation the returned attempt carries the authoritative
        // current state. Use its status directly instead of the stale
        // pre-reconciliation `status` captured above, so we never issue a
        // redundant second submitAttempt call.
        let currentStatus: ExamAttempt["status"] = status;
        if (status === "in_progress" || status === "disrupted") {
          const reconciled = await ensureAttemptDeadlineReconciled(
            exams,
            enrollments,
            attempts,
            gradingWorksetRepo,
            cap,
            now,
            buildResolution(status),
          );
          const reconciledStatus = reconciled.status;
          // If reconciliation already froze the attempt, skip the remaining
          // submit+grade work. This avoids redundant readGradingSnapshot,
          // computeGradingResult, and finalizeGrading calls that would extend
          // the FOR UPDATE lock unnecessarily.
          if (
            reconciledStatus === "graded" ||
            reconciledStatus === "submitted"
          ) {
            return "deadline_frozen" as const;
          }
          currentStatus = reconciledStatus;
        }

        if (currentStatus === "in_progress" || currentStatus === "disrupted") {
          // Reconciliation did not freeze (deadline not yet expired), or this
          // is the `submitted` crash-recovery path that skipped reconciliation.
          // Submit flips the row to `submitted` under the same lock. After this,
          // any concurrent saveAnswer sees `submitted` and is rejected
          // (ATTEMPT_ALREADY_SUBMITTED), so the answers can no longer mutate.
          // submitAttempt owns grading workset materialization.
          await submitAttempt(attempts, gradingWorksetRepo, attemptId, now, {
            source: "candidate",
            minSubmitAfterStartMinutes:
              (await exams.findById(lockedAttempt.examId))
                ?.minSubmitAfterStartMinutes ?? null,
            resolution: buildResolution(currentStatus),
          });
          if (audit) {
            await recordAtomicHttpAudit(tx, audit.request, ctx, {
              action: "attempt.submit",
              targetType: "attempt",
              targetId: attemptId,
            });
          }
        }

        // Branch on the authoritative gradingStatus established at
        // the submit/freeze barrier. A pending_manual attempt MUST hold at
        // submitted — the manual-grading queue owns the final transition. No
        // question-type rescan here; the freeze barrier is the single
        // classification authority. Both the fresh-submit case (submitAttempt
        // just wrote pending_manual) and the crash-recovery `submitted` case
        // (carrying its previously-established gradingStatus) are covered.
        const postSubmit = await attempts.findByIdForUpdate(attemptId);
        if (!postSubmit) {
          throw new NotFoundError("Attempt not found after submit");
        }

        if (postSubmit.gradingStatus === "pending_manual") {
          return "pending_manual" as const;
        }

        // Re-read the grading snapshot from the SAME transaction so the answers
        // feeding the score are the locked, post-submit answers. This is the
        // freeze barrier: the score is derived from exactly the answer set that
        // existed when the submit lock was held. (For the crash-recovery
        // `submitted` path this re-runs objective auto-grading deterministically.)
        const snapshot = await readGradingSnapshot(
          exams,
          enrollments,
          attempts,
          attemptId,
        );
        if (!snapshot) {
          throw new NotFoundError("Attempt not found after submit");
        }

        // FinalizeGrading is the single terminal authority — it loads
        // the grading workset and aggregates via `aggregateGradingEntries`. No
        // externally computed result is supplied (that would be a second score
        // authority). The gradingWorksetRepo is tx-scoped (created above) and
        // reads the same committed entries the freeze barrier materialized.
        // The capability is the EA protocol authority threaded
        // into finalizeGrading → finalizeTerminalGrading.
        await finalizeGrading(
          enrollments,
          attempts,
          exams,
          gradingWorksetRepo,
          cap,
          now,
        );
        // Entry `submitted` means this transaction recovered a crash-landed
        // submit (no submitAttempt ran); in_progress/disrupted means this
        // transaction performed the submit itself.
        return status === "submitted"
          ? ("recovered" as const)
          : ("graded" as const);
      }
      throw new InvalidStateTransitionError(
        `Cannot submit attempt in ${status} state`,
      );
    },
  );

  // Only the awaited resolve above proves COMMIT — a rollback or an exhausted
  // retry left this scope via the exception path with zero emission. The
  // classification of every failed intermediate attempt died with its
  // transaction (it lived only in the discarded callback return value).
  const alreadyGraded =
    outcome === "replay_no_change" || outcome === "deadline_frozen";

  // #1007: the single emit point, BEFORE the out-of-tx response
  // re-read below, so a later re-read/parse/serialization failure cannot
  // lose or rewrite the committed outcome. The HTTP handle doubles as the
  // identity source: the route passes it, non-HTTP callers (demo seed
  // grader) omit it and emit nothing — no fabricated HTTP identity.
  if (audit) {
    emitSubmitCompleted(audit.request.log, outcome, attemptId);
  }

  // Read the final committed attempt state for the response. Outside the tx
  // is safe here: this is a pure read of the now-committed result, and no
  // further mutation depends on it.
  const attemptRepo = createAttemptRepo(db);
  const attempt = await attemptRepo.findById(ctx, attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found after grading");
  }

  return { attempt: attempt as ExamAttempt, alreadyGraded, outcome };
}
