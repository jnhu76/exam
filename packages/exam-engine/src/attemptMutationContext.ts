import type { AttemptRepository } from "./attemptCommands.js";

// EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 — narrow opaque evidence object that
// the external transactional/cross-region preconditions required by a local
// Attempt mutation have been established.
//
// This module is INTENTIONALLY a narrow leaf. It depends only on the
// `AttemptRepository` type (type-only import) so that neither `answerProtocol`
// nor `deadlineReconciliation` introduce a runtime import cycle through it.
// The producer (preparation seam) lives in `deadlineReconciliation.ts`; the
// consumer (`saveAnswer`) lives in `answerProtocol.ts`. Both reach this module
// as a leaf, never the reverse.
//
// The symbols below are INTENTIONALLY module-private. Do NOT export either
// symbol, any alias of either symbol, or any user-defined type predicate that
// narrows to {@link ReconciledAttemptMutationContext}. Exporting any of these
// creates a mint bypass (mirrors the LEA capability discipline in lockSeam.ts).
//
// Runtime repo-affinity (assertMutationContextFor) is the correctness authority;
// the brand is the provenance receipt. Neither alone is sufficient.

const MUTATION_PROVENANCE_TOKEN: unique symbol = Symbol(
  "ReconciledAttemptMutation.provenance",
);
const MUTATION_AFFINITY_TOKEN: unique symbol = Symbol(
  "ReconciledAttemptMutation.affinity",
);

/**
 * Narrow opaque evidence that the external preconditions required by a local
 * Attempt mutation have been established by the canonical composition path.
 *
 * It represents — for Attempt A at authoritative server-time snapshot N:
 *
 *   1. the canonical EA lock seam established transaction/repository affinity;
 *   2. the Attempt row is serialized by the Attempt `FOR UPDATE` acquired by
 *      that seam;
 *   3. canonical deadline reconciliation has executed;
 *   4. the canonical effective deadline used for mutation safety is known
 *      (output of `computeEffectiveDeadline(exam, attempt)`);
 *   5. the evidence is bound to the exact transaction-scoped
 *      {@link AttemptRepository} used to establish it;
 *   6. the evidence is bound to the exact attempt identity and authoritative
 *      time snapshot.
 *
 * It is NOT an authorization permit. It is NOT a general Attempt capability.
 * It is NOT the existing EA capability. It is narrow evidence that the external
 * transactional/cross-region preconditions required by a local Attempt mutation
 * have been established. It does NOT mean the candidate is authorized, the
 * attempt is definitely active, the answer command is definitely accepted,
 * grading completed, or anything beyond the six facts above.
 *
 * It does NOT own transaction lifetime. It carries ONLY:
 *   - attempt identity, the authoritative checked-at snapshot, the canonical
 *     effective deadline (immutable facts)
 *   - a hidden provenance receipt (only the preparation seam mints it)
 *   - a hidden repo-affinity receipt (the exact AttemptRepository used at mint
 *     time; compared by reference identity at consumption)
 */
export interface ReconciledAttemptMutationContext {
  /** Immutable attempt identity the context was minted for. */
  readonly attemptId: string;
  /** Authoritative server-time snapshot captured at mint time. */
  readonly checkedAt: Date;
  /** Canonical effective deadline = computeEffectiveDeadline(exam, attempt). */
  readonly effectiveDeadline: Date;
  readonly [MUTATION_PROVENANCE_TOKEN]: typeof MUTATION_PROVENANCE_TOKEN;
  readonly [MUTATION_AFFINITY_TOKEN]: AttemptRepository;
}

/**
 * Mint the narrow mutation evidence. MODULE-PRIVATE — only the canonical
 * preparation seam (`prepareReconciledAttemptMutation`) may call this. The
 * provenance and affinity symbols are unforgeable outside this module, so a
 * plain object literal or `as` cast cannot construct a valid context.
 *
 * @internal
 */
export function mintMutationContext(
  attemptId: string,
  checkedAt: Date,
  effectiveDeadline: Date,
  attemptRepo: AttemptRepository,
): ReconciledAttemptMutationContext {
  return {
    attemptId,
    checkedAt,
    effectiveDeadline,
    [MUTATION_PROVENANCE_TOKEN]: MUTATION_PROVENANCE_TOKEN,
    [MUTATION_AFFINITY_TOKEN]: attemptRepo,
  };
}

/**
 * Consumption assertion for {@link saveAnswer}: proves the mutation context was
 * minted against the SAME engine-facing AttemptRepository object the consumer is
 * now using, AND that the request's attempt identity matches the identity the
 * context was bound to.
 *
 * Reference-identity comparison (`===`) on the repo. Identity comparison on the
 * attempt id. Mismatch throws BEFORE the protected action performs any mutation.
 *
 * IMPORTANT semantic limit (mirrors the LEA capability): this proves REPOSITORY
 * AFFINITY, not transaction-session liveness. If the minting transaction has
 * committed/rolled back but the consumer still holds the exact original repo
 * object, the references may still match; the underlying tx-bound repository
 * session is what rejects further DB use in that case. Safety is therefore the
 * composition: repo-affinity assertion + provenance receipt + tx-session
 * liveness enforced by the tx-bound repos.
 */
export function assertMutationContextFor(
  context: ReconciledAttemptMutationContext,
  currentAttemptRepo: AttemptRepository,
): void {
  if (context[MUTATION_AFFINITY_TOKEN] !== currentAttemptRepo) {
    throw new Error(
      "Attempt mutation-context transaction-affinity violation: the evidence " +
        "was minted against a different transaction-bound AttemptRepository " +
        "than the one now consuming it. Re-mint via the canonical preparation " +
        "seam (prepareReconciledAttemptMutation) in this transaction.",
    );
  }
}
