import { NotFoundError, ValidationError } from "@exam/domain";
import type { ExamAttempt } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";

/**
 * P3-FORMAL-P0-D1C3 / D2 — Canonical attemptId-rooted Enrollment→Attempt lock
 * acquisition seam.
 *
 * The symbols below are INTENTIONALLY module-private. Do NOT export either
 * symbol, any alias of either symbol, or any user-defined type predicate that
 * narrows to {@link LockedEnrollmentAttemptIdentity}. Exporting any of these
 * creates a mint bypass (see `docs/archive/audits/p3-formal-p0-d1-lock-seam-design.md`
 * §17.G: TYPE_GUARD_NARROWING_FORGERY = REACHABLE for an exported guard).
 *
 * Runtime repo-affinity (assertCapabilityFor) is the correctness authority;
 * the brand is the provenance receipt. Neither alone is sufficient.
 */
const LOCK_TOKEN: unique symbol = Symbol("LEA.identity");
const TX_AFFINITY_TOKEN: unique symbol = Symbol("LEA.affinity");

/**
 * Opaque, identity-only, transaction-affine witness that the canonical
 * Enrollment→Attempt lock protocol ran in some transaction.
 *
 * Carries ONLY:
 *   - enrollment identity, attempt identity (immutable FK columns)
 *   - a hidden provenance receipt (only `lockEnrollmentAndAttempt` mints it)
 *   - a hidden repo-affinity receipt (the exact engine-facing repo pair used
 *     at mint time; compared by reference identity at consumption)
 *
 * It MUST NOT carry mutable ExamEnrollment / ExamAttempt snapshots. Downstream
 * consumers re-read mutable state inside the same transaction; under
 * REPEATABLE READ a transaction always sees its own writes.
 */
export interface LockedEnrollmentAttemptIdentity {
  readonly enrollmentId: string;
  readonly attemptId: string;
  readonly [LOCK_TOKEN]: typeof LOCK_TOKEN;
  readonly [TX_AFFINITY_TOKEN]: {
    readonly enrollmentRepo: EnrollmentRepository;
    readonly attemptRepo: AttemptRepository;
  };
}

/**
 * Acquires the Enrollment row lock before the Attempt row lock, in the
 * current transaction, and mints an identity-only transaction-affine witness.
 *
 * Protocol (DO NOT REORDER):
 *   1. Attempt locator read WITHOUT FOR UPDATE (identity columns are
 *      immutable: enrollmentId, examId, candidateId).
 *   2. Enrollment FOR UPDATE, located via the locator's (examId, candidateId).
 *   3. Revalidate lockedEnrollment.id === locator.enrollmentId.
 *   4. Attempt FOR UPDATE.
 *   5. Revalidate lockedAttempt.enrollmentId === lockedEnrollment.id.
 *   6. Mint the capability, capturing the exact repo object references passed
 *      in (these are the engine-facing tx-bound adapter identities).
 *
 * Caller-owned domain guards (attempt.status eligibility, enrollment
 * transition legality, exam timing, retake policy, score strategy) are NOT
 * evaluated here — the seam proves only the lock-order + identity protocol.
 *
 * @throws {NotFoundError} attempt or enrollment row is missing.
 * @throws {ValidationError} enrollment / attempt identity mismatch.
 */
export async function lockEnrollmentAndAttempt(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
): Promise<LockedEnrollmentAttemptIdentity> {
  // 1. Locator read without FOR UPDATE. Identity columns are immutable; the
  //    status read here is a hint only and MUST be re-evaluated under lock
  //    by the caller's domain guards.
  const locator = await attemptRepo.findById(attemptId);
  if (!locator) {
    throw new NotFoundError("Attempt not found");
  }

  // 2. Enrollment FOR UPDATE — first row lock in the protocol.
  const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
    locator.examId,
    locator.candidateId,
  );
  if (!enrollment) {
    throw new NotFoundError("Enrollment not found");
  }

  // 3. Enrollment identity revalidation: the (examId, candidateId) join must
  //    resolve to exactly the enrollment that owns this attempt.
  if (enrollment.id !== locator.enrollmentId) {
    throw new ValidationError(
      "Enrollment mismatch — attempt identity does not resolve to a consistent enrollment",
    );
  }

  // 4. Attempt FOR UPDATE — second row lock, strictly after the Enrollment lock.
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // 5. Attempt identity revalidation: the locked attempt must still belong to
  //    the locked enrollment.
  if (attempt.enrollmentId !== enrollment.id) {
    throw new ValidationError(
      "Attempt enrollment mismatch — data integrity violation",
    );
  }

  // 6. Mint. Only this module can attach the private symbols; the affinity
  //    receipt is the exact repo pair received.
  return {
    enrollmentId: enrollment.id,
    attemptId: attempt.id,
    [LOCK_TOKEN]: LOCK_TOKEN,
    [TX_AFFINITY_TOKEN]: { enrollmentRepo, attemptRepo },
  };
}

/**
 * Consumption assertion: proves the capability was minted with the SAME
 * engine-facing repo object references the consumer is now using.
 *
 * Reference-identity comparison (`===`) on both repos. Mismatch throws BEFORE
 * the protected consumer performs any repository operation.
 *
 * IMPORTANT semantic limit: this proves REPOSITORY AFFINITY, not transaction-
 * session liveness. If the minting transaction has committed/rolled back but
 * the consumer still holds the exact original repo objects, the references
 * may still match; the underlying tx-bound repository session is what rejects
 * further DB use in that case (Drizzle: "Transaction query already complete").
 * Safety is therefore the composition: repo-affinity assertion + tx-session
 * liveness enforced by the tx-bound repos.
 */
export function assertCapabilityFor(
  capability: LockedEnrollmentAttemptIdentity,
  currentEnrollmentRepo: EnrollmentRepository,
  currentAttemptRepo: AttemptRepository,
): void {
  const affinity = capability[TX_AFFINITY_TOKEN];
  if (
    affinity.enrollmentRepo !== currentEnrollmentRepo ||
    affinity.attemptRepo !== currentAttemptRepo
  ) {
    throw new Error(
      "EA capability transaction-affinity violation: the witness was minted " +
        "against a different transaction-bound repo pair than the one now " +
        "consuming it. Re-mint via lockEnrollmentAndAttempt in this transaction.",
    );
  }
}

/**
 * Result of the canonical Enrollment→active-Attempt lock acquisition for
 * the `/start` route (R3/R8). The lock order is Enrollment FOR UPDATE first,
 * then the active attempt (if any) FOR UPDATE.
 *
 * - `activeAttempt` is present when the candidate has an `in_progress` or
 *   `disrupted` attempt. The caller branches on `activeAttempt.status` to
 *   decide whether to restore (disrupted) or resume (in_progress).
 * - `activeAttempt` is `null` when no active attempt exists; the caller
 *   creates a new attempt.
 * - `capability` is present only when an active attempt was found and locked.
 */
export interface EnrollmentActiveAttemptLock {
  enrollmentId: string;
  activeAttempt: ExamAttempt | null;
  capability: LockedEnrollmentAttemptIdentity | null;
}

/**
 * Acquires the Enrollment row lock before the active Attempt row lock (R3),
 * for the `/start` route. Unlike {@link lockEnrollmentAndAttempt}, this seam
 * starts from the Enrollment identity (examId + candidateId) rather than a
 * known attemptId, because the caller may not yet have an active attempt.
 *
 * Protocol (DO NOT REORDER):
 *   1. Enrollment FOR UPDATE via (examId, candidateId).
 *   2. Locate the active attempt (in_progress or disrupted) via the
 *      enrollment id.
 *   3. If an active attempt exists, Attempt FOR UPDATE + identity
 *      revalidation.
 *   4. Mint the capability, capturing the exact repo object references.
 *
 * @throws {NotFoundError} enrollment not found.
 */
export async function lockEnrollmentAndActiveAttempt(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
): Promise<EnrollmentActiveAttemptLock> {
  // 1. Enrollment FOR UPDATE — first row lock.
  const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
    examId,
    candidateId,
  );
  if (!enrollment) {
    throw new NotFoundError("Enrollment not found");
  }

  // 2. Locate the active attempt (in_progress or disrupted).
  const activeAttempt = await attemptRepo.findActiveByEnrollment(enrollment.id);

  if (activeAttempt) {
    // 3a. Attempt FOR UPDATE — second row lock, strictly after Enrollment.
    const locked = await attemptRepo.findByIdForUpdate(activeAttempt.id);
    if (!locked) {
      throw new NotFoundError("Active attempt not found under lock");
    }

    // 3b. Identity revalidation.
    if (locked.enrollmentId !== enrollment.id) {
      throw new ValidationError(
        "Active attempt enrollment mismatch — data integrity violation",
      );
    }

    // 4. Mint with the locked attempt's identity.
    const capability: LockedEnrollmentAttemptIdentity = {
      enrollmentId: enrollment.id,
      attemptId: locked.id,
      [LOCK_TOKEN]: LOCK_TOKEN,
      [TX_AFFINITY_TOKEN]: { enrollmentRepo, attemptRepo },
    };

    return { enrollmentId: enrollment.id, activeAttempt: locked, capability };
  }

  // No active attempt — no capability to mint.
  return { enrollmentId: enrollment.id, activeAttempt: null, capability: null };
}
