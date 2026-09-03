import type { ExamAttempt } from "@exam/domain";
import {
  GradingStatus,
  InvalidStateTransitionError,
  NotFoundError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import { submitAttempt } from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import { readGradingSnapshot, finalizeGrading } from "./grading.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import {
  assertCapabilityFor,
  type LockedEnrollmentAttemptIdentity,
} from "./lockSeam.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";
import { computeEffectiveDeadline, isAttemptDeadlineExpired } from "./timer.js";

// ── Mutation context authority (EXAM-ANSWER-MINT-AUTHORITY-CORRECTIVE-0) ──
//
// The mutation-context type, brand, and private mint live under the canonical
// preparation owner (this module). There is no publicly importable standalone
// mint function — only prepareReconciledAttemptMutation may construct a genuine
// ReconciledAttemptMutationContext.
//
// The context carries a runtime affinity assertion closure that captures the
// exact AttemptRepository object at mint time, so saveAnswer can prove repo
// identity without a runtime import of this module (type-only edge).

const MUTATION_CONTEXT_BRAND: unique symbol = Symbol(
  "ReconciledAttemptMutationContext",
);

/**
 * Narrow opaque evidence that the external preconditions required by a local
 * Attempt mutation have been established by the canonical composition path.
 *
 * It represents — for Attempt A at authoritative server-time snapshot N:
 *
 *   1. the canonical EA lock seam established transaction/repository affinity;
 *   2. the Attempt row is serialized by the Attempt FOR UPDATE acquired by
 *      that seam;
 *   3. canonical deadline reconciliation has executed;
 *   4. the canonical effective deadline used for mutation safety is known
 *      (output of `computeEffectiveDeadline(exam, attempt)`);
 *   5. the evidence is bound to the exact transaction-scoped
 *      AttemptRepository used to establish it;
 *   6. the evidence is bound to the exact attempt identity and authoritative
 *      time snapshot.
 *
 * It is NOT an authorization permit. It is NOT a general Attempt capability.
 * It is NOT the existing EA capability. It is narrow evidence that the external
 * transactional/cross-region preconditions required by a local Attempt mutation
 * have been established.
 *
 * It does NOT own transaction lifetime. It carries ONLY:
 *   - attempt identity, the authoritative checked-at snapshot, the canonical
 *     effective deadline (immutable facts)
 *   - a hidden provenance receipt (only the preparation seam mints it)
 *   - a runtime repo-affinity assertion closure (captures the exact
 *     AttemptRepository at mint time; compared by reference identity)
 */
export interface ReconciledAttemptMutationContext {
  /** Immutable attempt identity the context was minted for. */
  readonly attemptId: string;
  /** Authoritative server-time snapshot captured at mint time. */
  readonly checkedAt: Date;
  /**
   * Canonical effective deadline = computeEffectiveDeadline(exam, attempt).
   * Nullable since Phase A (#291): untimed attempts have no deadline at all —
   * null means "never expires", NOT "already expired" (the pure save decision
   * treats a null deadline as no deadline guard).
   */
  readonly effectiveDeadline: Date | null;
  readonly [MUTATION_CONTEXT_BRAND]: true;

  /**
   * Proves the mutation context was minted against the SAME engine-facing
   * AttemptRepository object the consumer is now using. Reference-identity
   * comparison (`===`) on the repo. Mismatch throws BEFORE the protected
   * action performs any mutation.
   */
  assertAttemptRepository(attemptRepo: AttemptRepository): void;
}

/**
 * Private mint — ONLY the canonical preparation seam may call this.
 * The brand symbol is module-private; a plain object literal or `as` cast
 * cannot construct a valid context. The affinity assertion closure captures
 * the exact repo reference at mint time.
 *
 * NOT EXPORTED — do not add `export`.
 */
function mintReconciledAttemptMutationContext(
  attemptId: string,
  checkedAt: Date,
  effectiveDeadline: Date | null,
  attemptRepo: AttemptRepository,
): ReconciledAttemptMutationContext {
  return {
    attemptId,
    checkedAt,
    effectiveDeadline,
    [MUTATION_CONTEXT_BRAND]: true as const,
    assertAttemptRepository(candidateRepo: AttemptRepository): void {
      if (candidateRepo !== attemptRepo) {
        throw new Error(
          "Attempt mutation-context transaction-affinity violation: the evidence " +
            "was minted against a different transaction-bound AttemptRepository " +
            "than the one now consuming it. Re-mint via the canonical preparation " +
            "seam (prepareReconciledAttemptMutation) in this transaction.",
        );
      }
    },
  };
}

/**
 * Auto-submittable attempt states for deadline reconciliation.
 * `not_started`/`queued` never started; `submitted`/`grading`/`graded` are
 * already frozen; `voided` is terminal. Only in-flight states get frozen.
 *
 * Typed against ExamAttempt["status"] so a future status rename surfaces at
 * compile time instead of silently breaking reconciliation.
 */
const AUTOSUBMITTABLE_STATUSES: ReadonlySet<ExamAttempt["status"]> = new Set<
  ExamAttempt["status"]
>(["in_progress", "disrupted"]);

// Pure deadline calculation lives in timer.ts so engine callers can share the
// same kernel without depending on reconciliation orchestration; re-exported
// here for deep-import stability.
export { computeEffectiveDeadline, isAttemptDeadlineExpired } from "./timer.js";

/**
 * Lazy-triggered deadline reconciliation (P3-L0-3 / ADR-008 §5.3).
 *
 * Called at candidate attempt entry points (`/take`, save, submit, resume).
 * No background worker, no scheduled scan — reconciliation happens inline at
 * the entry point, transactionally. If the attempt is in an auto-submittable
 * state (`in_progress`/`disrupted`) and `now >= effectiveDeadline`, this
 * freezes the draft answers into `submitted_answers` (via `submitAttempt`
 * with `submissionReason: 'deadline'`), then grades. `submittedAt` is set to
 * the `effectiveDeadline` (the business-effective time), NOT the wall-clock
 * reconciliation instant.
 *
 * Idempotent: a submitted/grading/graded attempt is returned unchanged — its
 * existing `submitted_answers` + `submittedAt` are never rebuilt.
 *
 * The caller MUST wrap this in a transaction holding the attempt row lock
 * (`findByIdForUpdate`) so the read-freeze-write is atomic against concurrent
 * candidate save/submit. This mirrors `autoSubmitAndGrade`.
 *
 * @throws {NotFoundError} attempt or exam not found.
 * @throws {InvalidStateTransitionError} should not occur in normal operation
 *   (defensive against unexpected status mutations).
 */
export async function ensureAttemptDeadlineReconciled(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  now: Date,
  resolution: SubmitInterruptionResolution,
): Promise<ExamAttempt> {
  const { attemptId } = capability;
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // Idempotent already-frozen path: submitted/grading/graded carry a frozen
  // submitted_answers — return unchanged (do NOT rebuild).
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded"
  ) {
    return attempt;
  }

  // not_started/queued/voided: never auto-submitted. Return unchanged — no
  // freeze. voided is terminal; not_started/queued cannot have answers.
  if (!AUTOSUBMITTABLE_STATUSES.has(attempt.status)) {
    return attempt;
  }

  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  // Canonical expiry decision. The inline reconciliation path and the scanner
  // under-lock recheck both go through this single seam — never re-derive.
  if (!isAttemptDeadlineExpired(exam, attempt, now)) {
    return attempt;
  }
  const effectiveDeadline = computeEffectiveDeadline(exam, attempt);
  // INVARIANT: expiry ⇒ a non-null effective deadline (null never expires).
  // The guard keeps that fact type-honest and fails safe (no-op) instead of
  // submitting an attempt that has no deadline.
  if (effectiveDeadline === null) {
    return attempt;
  }

  // Lazy inline submit-and-grade using effectiveDeadline as the submit time,
  // so submittedAt = effectiveDeadline (the business deadline), not the
  // wall-clock reconciliation instant. submissionReason='deadline' marks the
  // freeze as deadline-triggered.
  //
  // P3-L0-2E: submitAttempt owns the grading workset materialization. The
  // gradingWorksetRepo is passed through — no caller-level materialize call.
  const submittedAttempt = await submitAttempt(
    attemptRepo,
    gradingWorksetRepo,
    attemptId,
    effectiveDeadline,
    {
      source: "deadline_scanner",
      submissionReason: "deadline",
      resolution,
    },
  );

  if (submittedAttempt.gradingStatus === GradingStatus.PendingManual) {
    return submittedAttempt;
  }

  const snapshot = await readGradingSnapshot(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    attemptId,
  );
  if (!snapshot) {
    throw new NotFoundError("Attempt not found after reconciliation");
  }

  // Slice 4: finalizeGrading aggregates from the workset. gradingWorksetRepo
  // is the caller's tx-scoped repo (same one submitAttempt materialized into).
  // P3-FORMAL-P0-D2: the caller-minted capability is threaded through to
  // finalizeGrading → finalizeTerminalGrading (affinity-proven).
  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    snapshot.exam,
    now,
  );

  const reconciled = await attemptRepo.findById(attemptId);
  if (!reconciled) {
    throw new InvalidStateTransitionError(
      "Attempt disappeared after reconciliation",
    );
  }
  return reconciled;
}

/**
 * Result of the canonical preparation seam: the authoritative post-reconciliation
 * attempt (available to the API for candidate-ownership checks) plus the narrow
 * opaque mutation evidence required by a local Attempt mutation action.
 *
 * The returned `attempt` MUST NOT be used by the caller to re-establish the
 * P1/P2/P3 preconditions — those are already established by the preparation seam
 * and carried by `mutationContext`. The caller may use it ONLY for checks the
 * evidence deliberately does not carry (e.g. candidate ownership).
 */
export interface PreparedAttemptMutation {
  attempt: ExamAttempt;
  mutationContext: ReconciledAttemptMutationContext;
}

/**
 * Preparation seam — establishes the external preconditions needed by a local
 * Attempt mutation (EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 §7).
 *
 * This seam composes the canonical cross-region preconditions into a single
 * authoritative result:
 *
 *   1. verify the EA capability against the exact repo objects (lock provenance);
 *   2. invoke/reuse the canonical deadline reconciliation
 *      (`ensureAttemptDeadlineReconciled`) — preserving all freeze/grade
 *      behavior — to obtain the authoritative current Attempt;
 *   3. load the Exam state required for the canonical effective deadline;
 *   4. call `computeEffectiveDeadline` — do NOT reimplement the min logic;
 *   5. mint the narrow {@link ReconciledAttemptMutationContext} carrying
 *      attemptId, effectiveDeadline, checkedAt, and AttemptRepository affinity.
 *
 * It does NOT move freeze/grade reconciliation into the local mutation action.
 * It does NOT create a second lock acquisition seam (the EA lock remains owned
 * by `lockEnrollmentAndAttempt`). It does NOT make saveAnswer self-sufficient
 * on cross-region facts — it produces the narrow evidence saveAnswer consumes.
 *
 * The caller must already have minted the EA capability via
 * `lockEnrollmentAndAttempt` in this transaction and pass the SAME repo objects.
 *
 * @throws {Error} EA capability repo-affinity violation.
 * @throws {NotFoundError} attempt or exam not found.
 */
export async function prepareReconciledAttemptMutation(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  now: Date,
  resolution: SubmitInterruptionResolution,
): Promise<PreparedAttemptMutation> {
  // 1. Verify the EA capability against the exact repo objects BEFORE any
  //    further use. This mechanically proves the caller minted the capability
  //    via the canonical seam against this exact tx-bound repo pair, and that
  //    the Attempt row lock is therefore held through this seam.
  assertCapabilityFor(capability, enrollmentRepo, attemptRepo);

  // 2. Canonical deadline reconciliation. Reused as-is — no body duplication.
  //    Preserves freeze/grade behavior and returns the authoritative current
  //    Attempt (possibly frozen if the deadline was reached).
  const attempt = await ensureAttemptDeadlineReconciled(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    now,
    resolution,
  );

  // 3. Load the Exam state required for the canonical effective deadline.
  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  // 4. Canonical effective deadline — single authority, no re-implemented min.
  const effectiveDeadline = computeEffectiveDeadline(exam, attempt);

  // 5. Mint the narrow mutation evidence bound to the exact attempt identity,
  //    authoritative time snapshot, canonical effective deadline, and the exact
  //    AttemptRepository object the consumer (saveAnswer) will assert against.
  const mutationContext = mintReconciledAttemptMutationContext(
    capability.attemptId,
    now,
    effectiveDeadline,
    attemptRepo,
  );

  return { attempt, mutationContext };
}
