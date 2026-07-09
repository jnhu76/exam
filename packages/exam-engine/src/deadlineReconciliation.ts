import type { Exam, ExamAttempt } from "@exam/domain";
import {
  GradingStatus,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
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
import {
  mintMutationContext,
  type ReconciledAttemptMutationContext,
} from "./attemptMutationContext.js";

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

/**
 * Computes the effective deadline for an attempt.
 *
 * `effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)` — derived from
 * existing fields, no new deadline model (L0 §5.1). A null attempt deadline
 * falls back to the exam close.
 *
 * REACHABILITY BOUNDARY (P0-C1): the NULL `attempt.deadlineAt` branch is a
 * DEFENSIVE recovery over the schema-admissible NULL domain, NOT a normative
 * Phase-1 timing mode. The Phase-1 `timed_window` protocol invariant is:
 *
 *   ProtocolReachable(a) AND Active(a)  =>  a.deadlineAt != NULL
 *
 * because every ordinary production active-Attempt writer
 * (`startOrRestoreAttempt` via `calculateDeadlineAt`, `extendAttemptTime`)
 * writes a non-null `deadlineAt`, and no transition into `in_progress`/
 * `disrupted` introduces NULL (`restoreAttempt` only preserves it). The
 * fallback therefore covers schema-admissible but protocol-unreachable
 * legacy / corrupt / historical NULL rows; it does not declare NULL a valid
 * protocol timing state. See `docs/phase3/exam-protocol.md` §5.1 for the
 * reachable-invariant / defensive-recovery split.
 *
 * CANONICAL DEADLINE AUTHORITY: this is the single source of truth for the
 * "effective deadline" value. The scanner's DB candidate predicate is a
 * DERIVED discovery approximation that agrees with this seam over BOTH the
 * reachable domain (non-NULL `deadlineAt`) and the defensive NULL domain
 * (NULL => `exam.closeAt`); the authoritative expiry decision is
 * `isAttemptDeadlineExpired` below, which is the ONLY place "is this attempt
 * expired?" is answered for mutation purposes.
 */
export function computeEffectiveDeadline(
  exam: Exam,
  attempt: ExamAttempt,
): Date {
  const examClose = exam.closeAt;
  if (examClose == null) {
    throw new ValidationError(
      "Exam closeAt is required for deadline computation (timed_window invariant)",
    );
  }
  // attempt.deadlineAt == null is a defensive recovery branch: reachable
  // active attempts always carry a non-null deadlineAt (P0-C1 invariant
  // ACTIVE-DEADLINE-001). Falling back to exam.closeAt here lets the scanner
  // and inline reconciliation converge on legacy/schema-admissible NULL rows.
  return attempt.deadlineAt && attempt.deadlineAt < examClose
    ? attempt.deadlineAt
    : examClose;
}

/**
 * Canonical "is this attempt past its effective deadline?" decision.
 *
 * `now >= computeEffectiveDeadline(exam, attempt)`. This is the SOLE
 * authoritative expiry seam for any code path that mutates attempt state on
 * deadline (inline reconciliation AND the scanner under-lock recheck). Both
 * the candidate path and the scanner MUST call this — never re-derive
 * `deadlineAt <= now || closeAt <= now` inline.
 *
 * @throws {ValidationError} if `exam.closeAt` is null (timed_window invariant).
 */
export function isAttemptDeadlineExpired(
  exam: Exam,
  attempt: ExamAttempt,
  now: Date,
): boolean {
  return now.getTime() >= computeEffectiveDeadline(exam, attempt).getTime();
}

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

  // Slice 4: finalizeGrading aggregates from the grading workset internally —
  // no externally computed result. gradingWorksetRepo is the caller's
  // tx-scoped repo (same one submitAttempt materialized into).
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
  const mutationContext = mintMutationContext(
    capability.attemptId,
    now,
    effectiveDeadline,
    attemptRepo,
  );

  return { attempt, mutationContext };
}
