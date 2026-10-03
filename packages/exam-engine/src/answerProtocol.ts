import { createHash } from "node:crypto";
import {
  NotFoundError,
  ValidationError,
  type AnswerRecord,
  type AttemptStatus,
  type ExamAttempt,
  type QuestionSnapshot,
  type SaveAnswerRequest,
  type SaveAnswerResponse,
  type SubmittedAnswersSnapshot,
} from "@exam/domain";
import type { AnswerReceipt, AttemptRepository } from "./attemptCommands.js";
import type { ReconciledAttemptMutationContext } from "./deadlineReconciliation.js";

/**
 * Deterministic serialization of a canonical answer value, injective over the
 * SaveAnswer value domain: every value that can reach persistence is
 * JSON-serializable (validated shapes: strings, booleans, string arrays,
 * string-keyed string records, null, canonical ContentDocumentV1), and for
 * such values distinct values serialize to distinct strings:
 *
 *   - objects: keys sorted, keys JSON-escaped → key order never matters
 *     (matches the prior structural-equality semantics);
 *   - arrays: ordered, delimiters cannot collide with quoted strings;
 *   - numbers: `String(v)` is the ECMAScript shortest-round-trip form, so one
 *     JS number maps to exactly one token; -0 is spelled "-0" so it stays
 *     distinct from 0 (Object.is semantics);
 *   - booleans/null: distinct tokens.
 *
 * Non-JSON values (undefined, functions, symbols) and non-finite numbers have
 * no representation and throw: they cannot arrive over the JSON wire or from
 * the canonicalization seam, so throwing surfaces a defect instead of
 * silently conflating distinct answers.
 */
function serializeAnswerIdentityValue(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          "answer identity serialization requires finite JSON numbers",
        );
      }
      return Object.is(value, -0) ? "-0" : String(value);
    case "object":
      break;
    default:
      throw new Error(
        `answer identity serialization requires JSON-serializable values, got ${typeof value}`,
      );
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((element) => serializeAnswerIdentityValue(element))
      .join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return `{${entries
    .map(
      ([key, v]) => `${JSON.stringify(key)}:${serializeAnswerIdentityValue(v)}`,
    )
    .join(",")}}`;
}

/**
 * Canonical answer identity — the storage representation used to decide
 * "same accepted clientSeq + same canonical answer identity" (frozen replay
 * semantics, rich-content-semantic-contract §12).
 *
 * The SEMANTIC definition of identity remains structural identity of the
 * D1-accepted canonical value (N(d1) == N(d2), contract §3.1). This digest is
 * its collision-resistant REPRESENTATION: the serialization above is
 * injective over the value domain, so digest equality holds whenever canonical
 * values are equal; the only divergence source is a SHA-256 collision
 * (~2^-128 birthday bound, ~2^256 work to target) — the standard accepted
 * risk model for content-addressed identity, not a mathematical exactness
 * claim. Digest comparison therefore never treats two different canonical
 * answers as equal in any realistic execution.
 *
 * Must be called ONLY on the canonical value accepted by the D1 write
 * boundary (#669 D2-I): identity of the canonical value, never of the
 * pre-normalized candidate.
 */
export function canonicalAnswerIdentity(value: unknown): string {
  return createHash("sha256")
    .update(serializeAnswerIdentityValue(value))
    .digest("hex");
}

/** State required by the answer save protocol to evaluate an incoming save request. */
export interface AnswerState {
  attemptStatus: AttemptStatus;
  answers: AnswerRecord[];
  /**
   * The replay receipt for THIS request's (questionId, clientSeq) key if a
   * prior save accepted it, else null (#669 Phase D2). The caller resolves it
   * with one indexed repository lookup — replay recognition is bounded by the
   * lookup key, not proportional to the attempt's whole receipt history.
   */
  knownReceipt: AnswerReceipt | null;
  // Nullable: an untimed attempt's canonical effective deadline is null — no
  // deadline guard applies (null != expired).
  deadlineAt?: Date | null;
  now?: Date;
}

/** Response from the answer save protocol, including newly created answer and replay receipt when accepted. */
export type ProcessSaveResult = SaveAnswerResponse & {
  newAnswer?: AnswerRecord;
  /** Receipt for the newly accepted replay key; persisted in the same transaction as `newAnswer`. */
  newReceipt?: AnswerReceipt;
};

/**
 * Canonical answer-shape validation/canonicalization seam, supplied by the
 * caller and invoked by the decision core at the CANONICAL precedence point:
 * after the status and effective-deadline guards, before idempotency and
 * version semantics (#301). The caller (API route) binds the
 * FROZEN QuestionSnapshot into this callback; the engine owns WHEN it runs,
 * so a malformed payload can never change the status/deadline rejection
 * precedence. The returned value replaces the request answer for every
 * downstream decision (equality, persistence) — rich answers arrive here in
 * canonical form.
 */
export type CanonicalizeAnswer = (
  answer: unknown,
) => { ok: true; value: unknown } | { ok: false; reason: string };

/** Processes a single answer save request using versioned, idempotent conflict detection. */
export function processSaveAnswer(
  state: AnswerState,
  request: SaveAnswerRequest,
  canonicalize?: CanonicalizeAnswer,
): ProcessSaveResult {
  // ADR-006: the exam-engine layer never reads the wall clock. The operation
  // `now` arrives via `state.now` from the API layer (fastify.now()). It is the
  // single time authority for every timestamp this function emits. The fallback
  // only applies if a caller forgets to supply it; the production route always
  // does, so the engine never reaches the fallback at runtime.
  const now = state.now ?? new Date();
  const savedAtIso = now.toISOString();

  if (state.attemptStatus === "voided") {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "ATTEMPT_CLOSED" },
    };
  }

  if (state.attemptStatus === "submitted" || state.attemptStatus === "graded") {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "ATTEMPT_ALREADY_SUBMITTED" },
    };
  }

  // EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 §11 — canonical expiry predicate is
  // `now >= effectiveDeadline`. Equality at the deadline is expired, aligning
  // the pure Save decision with the canonical `isAttemptDeadlineExpired`
  // authority (`now >= computeEffectiveDeadline(...)`). This closes the prior
  // `>` vs `>=` boundary divergence at the instant `now === deadlineAt`.
  if (state.deadlineAt && now.getTime() >= state.deadlineAt.getTime()) {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "DEADLINE_EXCEEDED" },
    };
  }

  // Canonical ordering (#301 corrective pass §5): shape validation and rich
  // canonicalization run AFTER the lifecycle/deadline guards and BEFORE
  // idempotency/version semantics, so an INVALID payload cannot mask (or be
  // masked by) a protocol rejection, and equality/idempotency/persistence
  // only ever see canonical values.
  let answer = request.answer;
  let answerIdentity: string | null = null;
  if (canonicalize) {
    const validation = canonicalize(answer);
    if (!validation.ok) {
      const existingAnswer = state.answers.find(
        (a) => a.questionId === request.questionId,
      );
      return {
        accepted: false,
        serverVersion: existingAnswer?.version ?? 0,
        savedAt: savedAtIso,
        conflict: { reason: "INVALID_ANSWER" },
      };
    }
    answer = validation.value;
  }
  // Identity is computed on the CANONICAL value (post-canonicalization) so
  // semantically equivalent candidate inputs share one identity (#669 D2-I /
  // R8) — never on the pre-normalized candidate.
  answerIdentity = canonicalAnswerIdentity(answer);

  if (state.knownReceipt) {
    // Known replay key: same canonical identity → safe replay, return the
    // prior acknowledgement verbatim with zero new writes. Different identity
    // → the client is misusing this key; reject as conflicting payload to
    // prevent silent data loss. (`latestAnswer` is deliberately omitted: the
    // receipt no longer retains payloads, and the wire contract never
    // serialized this internal field for CONFLICTING_PAYLOAD anyway.)
    if (state.knownReceipt.answerIdentity === answerIdentity) {
      return {
        accepted: true,
        serverVersion: state.knownReceipt.version,
        savedAt: state.knownReceipt.savedAt.toISOString(),
      };
    }
    return {
      accepted: false,
      serverVersion: state.knownReceipt.version,
      savedAt: savedAtIso,
      conflict: {
        reason: "CONFLICTING_PAYLOAD" as const,
      },
    };
  }

  const existingAnswer = state.answers.find(
    (a) => a.questionId === request.questionId,
  );
  const currentVersion = existingAnswer?.version ?? 0;

  if (request.baseVersion < currentVersion) {
    return {
      accepted: false,
      serverVersion: currentVersion,
      savedAt: savedAtIso,
      conflict: {
        reason: "STALE_VERSION",
        latestAnswer: existingAnswer?.answer,
      },
    };
  }

  // ANSWER_BASE_VERSION_MUST_EQUAL_CURRENT_VERSION: a baseVersion ahead of the
  // server cannot denote a legitimate update. The idempotency-key replay above
  // already handled same-`clientSeq` replays, so any request reaching here with
  // `baseVersion > currentVersion` claims a version that does not exist yet —
  // reject it instead of silently advancing to `currentVersion+1`.
  if (request.baseVersion > currentVersion) {
    return {
      accepted: false,
      serverVersion: currentVersion,
      savedAt: savedAtIso,
      conflict: {
        reason: "FUTURE_VERSION",
        latestAnswer: existingAnswer?.answer,
      },
    };
  }

  const newVersion = currentVersion + 1;
  const newAnswer: AnswerRecord = {
    questionId: request.questionId,
    answer,
    version: newVersion,
    savedAt: now,
  };

  return {
    accepted: true,
    serverVersion: newVersion,
    savedAt: savedAtIso,
    newAnswer,
    newReceipt: {
      questionId: request.questionId,
      clientSeq: request.clientSeq,
      answerIdentity,
      version: newVersion,
      savedAt: now,
    },
  };
}

// ── Save Answer composite action ─────────────────────────────────
//
// The helpers below are the protocol-state reconstruction + accepted-result
// application for `saveAnswer`, which owns load → reconstruct → decide (pure
// `processSaveAnswer`) → apply → persist. `processSaveAnswer` stays a pure,
// independently-tested decision core; the API route delegates the whole action.

/**
 * Folds the accepted answer into the persisted draft-answer list (#669 Phase
 * D2): the persisted element is now a pure `AnswerRecord`. The replay
 * receipts that used to ride alongside it (`clientSeq` / `clientSeqHistory`
 * JSONB fields with full payload copies) live in the append-only
 * `exam_answer_save_receipts` table instead — adding receipt N+1 no longer
 * rewrites prior receipt state. Pure — returns the next answers array without
 * mutating the input.
 */
function applyAcceptedResult(
  storedAnswers: AnswerRecord[],
  newAnswer: AnswerRecord,
  request: SaveAnswerRequest,
): AnswerRecord[] {
  return storedAnswers
    .filter((a) => a.questionId !== request.questionId)
    .concat([
      {
        questionId: request.questionId,
        answer: newAnswer.answer,
        version: newAnswer.version,
        savedAt: newAnswer.savedAt,
      },
    ]);
}

/**
 * Canonical composite Save Answer protocol action (single engine-owned action).
 *
 * Owns the full SAVE_ANSWER action inside the engine:
 *
 *   consume opaque mutation evidence (provenance + repo affinity)
 *     → load authoritative persisted attempt state
 *     → P1: validate questionId ∈ attempt.questionSnapshot (local legality)
 *     → reconstruct AnswerState (one indexed replay-receipt lookup for the
 *       request's own key)
 *     → invoke the pure `processSaveAnswer` decision core using the CANONICAL
 *       effective deadline from the mutation context (P3), not attempt.deadlineAt
 *       → status guards → deadline guard → canonical answer shape validation /
 *         canonicalization (caller-supplied, frozen-question-bound) →
 *         idempotency / version semantics
 *     → on accept: apply the result and persist `attempt.answers` + heartbeat
 *       + the immutable replay receipt, stamped with the context's
 *       authoritative checkedAt
 *     → return the semantic result
 *
 * Precondition evidence (`mutationContext`): minted by the canonical
 * preparation seam (`prepareReconciledAttemptMutation`) AFTER the EA lock seam
 * and canonical deadline reconciliation have run. The evidence carries attempt
 * identity, the authoritative checked-at snapshot, the canonical effective
 * deadline (output of `computeEffectiveDeadline`), and the exact
 * transaction-scoped AttemptRepository the seam minted against. This action
 * runtime-asserts repo affinity against that exact object — proving the
 * Attempt row lock established through the EA capability path is the one this
 * action mutates under (P2).
 *
 * The action does NOT accept the EA capability directly, does NOT acquire its
 * own row lock, does NOT load the Exam, and does NOT run deadline
 * reconciliation — those cross-region facts arrive as narrow evidence. The
 * context is attempt-bound, checkedAt-bound, and AttemptRepository-bound; it
 * cannot be reused with a different transaction/repository object.
 *
 * The caller (API route) is responsible ONLY for: transaction composition, the
 * EA lock predecessor seam (`lockEnrollmentAndAttempt`), the canonical
 * preparation seam, candidate-ownership checks, and mapping the returned
 * semantic result to the wire contract. It must NOT construct `AnswerState`,
 * look up replay receipts, compute the effective deadline, or write
 * `attempt.answers` itself.
 *
 * Persistence semantics:
 *   - accepted NEW answer        → one `update({ answers, lastActivityAt })`
 *                                  + one `appendAnswerReceipt` (same
 *                                  transaction: one protocol commit)
 *   - accepted idempotent replay → NO WRITE (the prior savedAt is returned)
 *   - any rejection              → NO WRITE (draft answers unchanged)
 *
 * @throws {NotFoundError} attempt not found.
 * @throws {ValidationError} request.attemptId does not match the context's
 *   bound attempt identity, or the request targets a question that is not a
 *   member of the attempt's frozen question snapshot (P1 local legality).
 * @throws {Error} mutation-context repo-affinity violation (P2).
 */
export async function saveAnswer(
  attemptRepo: AttemptRepository,
  mutationContext: ReconciledAttemptMutationContext,
  request: SaveAnswerRequest,
  canonicalizeAnswer?: (
    question: QuestionSnapshot,
    answer: unknown,
  ) => { ok: true; value: unknown } | { ok: false; reason: string },
): Promise<ProcessSaveResult> {
  // P2 — mechanical precondition evidence. Assert the context was minted against
  // the exact AttemptRepository object this action is now using. This proves the
  // Attempt row lock established through the EA capability path is the one whose
  // read-modify-write window this action runs under. Throws before any mutation.
  mutationContext.assertAttemptRepository(attemptRepo);

  // Identity binding — the context is bound to one attempt identity; the request
  // must target that same attempt. Do not silently trust a mismatched identity.
  if (request.attemptId !== mutationContext.attemptId) {
    throw new ValidationError(
      "Save answer request attemptId does not match the mutation context's bound attempt identity",
    );
  }

  const attempt = await attemptRepo.findById(mutationContext.attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // P1 — local legality. The attempt is a frozen universe of questions
  // (`questionSnapshot`, INV-010). Accepting an answer for a question outside
  // that universe produces a structurally invalid `attempt.answers` element, so
  // the Save Answer command itself must be illegal. This internalizes the
  // invariant the old route owned (the route's `.some(...)` guard is removed).
  // Preserved error semantics: ValidationError, matching the old route throw.
  // Defensive guard: questionSnapshot may be null/undefined on legacy rows.
  const snapshot = attempt.questionSnapshot ?? [];
  const snapshotQuestion = snapshot.find(
    (q) => q.originalQuestionId === request.questionId,
  );
  if (!snapshotQuestion) {
    // i18n-copy-allow: developer-diagnostic — thrown message never reaches the client; the error handler serializes the code only
    throw new ValidationError("问题不在此尝试中");
  }

  const storedAnswers = (attempt.answers ?? []) as AnswerRecord[];

  // Replay recognition for THIS request's key: one indexed repository lookup,
  // transactionally consistent with the answers write below (same tx-scoped
  // repository, proven by the P2 affinity assertion). An accepted clientSeq
  // MUST NOT become unknown while the attempt is mutable — receipts are
  // append-only with no retention bound (#669 Phase D2).
  const knownReceipt = await attemptRepo.findAnswerReceipt(
    mutationContext.attemptId,
    request.questionId,
    request.clientSeq,
  );

  // P3 — the canonical effective deadline. The pure decision receives the
  // canonical effective deadline from the mutation context (output of
  // `computeEffectiveDeadline(exam, attempt)`), NOT `attempt.deadlineAt`. This
  // closes the reachability gap where a reachable active attempt can have
  // `attempt.deadlineAt > exam.closeAt`: the action now refuses a save past the
  // canonical `min(exam.closeAt, attempt.deadlineAt)` even when called without
  // the predecessor. The checkedAt snapshot is the single time authority for
  // the deadline decision, savedAt, and lastActivityAt — never a second
  // caller-provided `now`.
  const saveResult = processSaveAnswer(
    {
      attemptStatus: attempt.status as AttemptStatus,
      answers: attempt.answers,
      knownReceipt,
      deadlineAt: mutationContext.effectiveDeadline,
      now: mutationContext.checkedAt,
    },
    request,
    // The frozen snapshot question is the shape authority (#301 §21); the
    // engine owns WHEN canonicalization runs (after status/deadline, before
    // idempotency), the caller owns HOW a question's answers are validated.
    canonicalizeAnswer
      ? (answer) => canonicalizeAnswer(snapshotQuestion, answer)
      : undefined,
  );

  // Apply ONLY on an accepted NEW answer. An idempotent replay returns
  // accepted:true with no `newAnswer` and must NOT trigger a write — the prior
  // savedAt is returned to the caller verbatim. Rejections never write.
  //
  // Atomicity (#669 Phase D2 §8): the accepted answer transition and the
  // replay receipt creation are ONE protocol commit — both writes go through
  // the same transaction-scoped repository, so a receipt-storage failure
  // rolls the answer write back (and vice versa). There is no committed state
  // with only one side of the acceptance.
  if (saveResult.accepted && saveResult.newAnswer && saveResult.newReceipt) {
    const newAnswers = applyAcceptedResult(
      storedAnswers,
      saveResult.newAnswer,
      request,
    );
    await attemptRepo.update(mutationContext.attemptId, {
      answers: newAnswers,
      lastActivityAt: mutationContext.checkedAt,
    });
    await attemptRepo.appendAnswerReceipt(
      mutationContext.attemptId,
      saveResult.newReceipt,
    );
  }

  return saveResult;
}

/**
 * Builds the frozen {@link SubmittedAnswersSnapshot} written to
 * `exam_attempts.submitted_answers` at submit time (ADR-008).
 *
 * Normalizes draft {@link AnswerRecord}s against the attempt's question
 * snapshot: every snapshot question becomes one entry, ordered by the
 * snapshot's `order` field (NOT by answer-record arrival order). Protocol
 * metadata (version / savedAt / clientSeq / baseVersion) is stripped — the
 * frozen snapshot carries only `{ questionId, value }`. Unanswered questions
 * yield `value: null` so the snapshot is a complete answer set.
 *
 * Pure function: no IO, no mutation of inputs. Caller (`submitAttempt`)
 * runs this inside the locked submit transaction so the captured answers
 * are exactly those that existed when the row lock was held.
 */
export function buildSubmittedAnswersSnapshot(
  draftAnswers: AnswerRecord[],
  questionSnapshot: QuestionSnapshot[],
): SubmittedAnswersSnapshot {
  const answerByQuestion = new Map(
    draftAnswers.map((a) => [a.questionId, a.answer]),
  );

  const ordered = [...questionSnapshot].sort((a, b) => a.order - b.order);

  return {
    schemaVersion: 1,
    answers: ordered.map((q) => ({
      questionId: q.originalQuestionId,
      // Map.get returns undefined for missing keys; ?? null normalizes both
      // "no answer record" and "answer record with null value" to null.
      value: answerByQuestion.get(q.originalQuestionId) ?? null,
    })),
  };
}
