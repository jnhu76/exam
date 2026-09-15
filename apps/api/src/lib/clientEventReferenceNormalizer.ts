import type { RequestContext } from "@exam/domain";
import type { ClientEvent } from "@exam/contracts";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";

/**
 * Client-event reference trust boundary (#544).
 *
 * Contract: accepting a client event is NOT accepting the resource references
 * it claims. `attemptId` / `examId` / `questionId` are client-asserted opaque
 * strings; they are persisted only when the server can independently prove the
 * claimed relationship for the authenticated actor, and are NULLed otherwise.
 * The event itself is always accepted — reference NULLIFICATION must never
 * surface as an HTTP error, a reduced `accepted` count, or any other
 * existence oracle (a batch of N schema-valid events always responds
 * `{ accepted: N }` regardless of how many references were dropped).
 *
 * Normalization rules (minimal, producer-verified):
 *
 * - `attemptId` is kept iff the attempt resolves under the caller's
 *   organization AND its owning candidate user (`candidateProfiles.userId`)
 * equals the actor. Staff roles therefore cannot bind candidate attempts
 *   to telemetry — no privileged exception exists by design.
 * - `examId` is never taken from the payload when a valid attempt anchors the
 *   event: the canonical value is the attempt's own exam (server-derived
 *   relationship wins over the client's claim). Without a valid attempt, the
 *   claimed examId is kept only when the actor's candidate profile has an
 *   enrollment for that exam (the `exam_start_failed` producer needs this).
 * - `questionId` is kept only if it belongs to the anchor exam's FROZEN
 *   publication snapshot (`exams.questionSnapshot[*].originalQuestionId`).
 *   The mutable `questions` bank is never consulted.
 *
 * Atomic-consistency invariant: a persisted row never mixes proven and
 * unproven references. `questionId != null` implies `examId != null` and
 * membership in that exam's frozen question set; `attemptId != null` implies
 * `examId` equals the attempt's canonical exam.
 */

/** Per-event persisted references after trust normalization. */
export interface NormalizedEventReferences {
  attemptId: string | null;
  examId: string | null;
  questionId: string | null;
}

/**
 * Server-verified reference evidence for one batch, keyed by claimed id.
 * Produced by {@link loadReferenceEvidence}; consumed by the pure
 * {@link resolveEventReferences}.
 */
export interface ReferenceEvidence {
  /** Valid (org + actor-owned) attemptId → the attempt's canonical examId. */
  readonly ownedAttemptExamIds: ReadonlyMap<string, string>;
  /** ExamIds whose candidate enrollment/ownership chain is proven for the actor. */
  readonly eligibleExamIds: ReadonlySet<string>;
  /** ExamId → frozen publication snapshot question ids (`originalQuestionId`). */
  readonly examQuestionIds: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The client-claimed references of one event (post-schema-validation). */
export interface ClaimedEventReferences {
  attemptId: string | null;
  examId: string | null;
  questionId: string | null;
}

/**
 * Pure reference resolution for one event. Deterministic and DB-free so the
 * atomic-consistency invariant is testable without fixtures.
 */
export function resolveEventReferences(
  claimed: ClaimedEventReferences,
  evidence: ReferenceEvidence,
): NormalizedEventReferences {
  // Attempt-anchored path: ownership proven → canonical exam wins over the
  // client's examId claim; questionId must sit in the canonical exam's frozen set.
  if (claimed.attemptId !== null) {
    const canonicalExamId = evidence.ownedAttemptExamIds.get(claimed.attemptId);
    if (canonicalExamId !== undefined) {
      return {
        attemptId: claimed.attemptId,
        examId: canonicalExamId,
        questionId: normalizeQuestionId(
          claimed.questionId,
          canonicalExamId,
          evidence,
        ),
      };
    }
    // Unproven attempt claim: fall through — the event may still anchor on an
    // independently provable exam, but the attempt reference itself is dropped.
  }

  // Exam-anchored path: requires the actor's own candidate enrollment chain.
  if (claimed.examId !== null && evidence.eligibleExamIds.has(claimed.examId)) {
    return {
      attemptId: null,
      examId: claimed.examId,
      questionId: normalizeQuestionId(
        claimed.questionId,
        claimed.examId,
        evidence,
      ),
    };
  }

  // Nothing provable: persist the event with no resource references.
  return { attemptId: null, examId: null, questionId: null };
}

/** Keeps a claimed questionId only inside the anchor exam's frozen question set. */
function normalizeQuestionId(
  claimedQuestionId: string | null,
  examId: string,
  evidence: ReferenceEvidence,
): string | null {
  if (claimedQuestionId === null) return null;
  return evidence.examQuestionIds.get(examId)?.has(claimedQuestionId)
    ? claimedQuestionId
    : null;
}

/**
 * Loads the server-verified evidence for a batch of claimed references.
 * Uses batched repository methods so the DB query count is O(1) with respect
 * to batch size — exactly 3 round trips regardless of how many distinct ids
 * appear in the batch:
 *
 *   1. Batch attempt ownership (WHERE attempt.id IN (...))
 *   2. Batch exam eligibility (WHERE exam.id IN (...))
 *   3. Batch exam snapshots (WHERE exam.id IN (...))
 */
export async function loadReferenceEvidence(
  db: Database,
  ctx: RequestContext,
  claimed: ClaimedEventReferences[],
): Promise<ReferenceEvidence> {
  const attemptRepo = createAttemptRepo(db);
  const examRepo = createExamRepo(db);

  // --- Step 1: Batch attempt ownership (single DB round trip) ---
  const distinctAttemptIds = distinct(claimed.map((c) => c.attemptId));
  const attemptChains = await attemptRepo.findOwnAttemptChains(
    ctx,
    distinctAttemptIds,
  );

  const ownedAttemptExamIds = new Map<string, string>();
  for (const attemptId of distinctAttemptIds) {
    const chain = attemptChains.get(attemptId);
    if (
      chain &&
      chain.ownerUserId !== null &&
      chain.ownerUserId === ctx.actorId &&
      chain.examId !== null
    ) {
      ownedAttemptExamIds.set(attemptId, chain.examId);
    }
  }

  // --- Step 2: Batch exam eligibility (single DB round trip) ---
  const distinctExamIds = distinct(claimed.map((c) => c.examId));
  const examChains = await examRepo.findCandidateEligibilityChains(
    ctx,
    distinctExamIds,
    ctx.actorId,
  );

  const eligibleExamIds = new Set<string>();
  for (const examId of distinctExamIds) {
    const chain = examChains.get(examId);
    if (
      chain &&
      chain.examId !== null &&
      chain.candidateProfileId !== null &&
      chain.ownerUserId !== null &&
      chain.ownerUserId === ctx.actorId &&
      chain.enrollmentId !== null
    ) {
      eligibleExamIds.add(examId);
    }
  }

  // --- Step 3: Batch exam snapshots (single DB round trip) ---
  const anchorExamIds = distinct([
    ...ownedAttemptExamIds.values(),
    ...eligibleExamIds,
  ]);
  const examSnapshots = await examRepo.findByIdsForSnapshot(ctx, anchorExamIds);

  const examQuestionIds = new Map<string, ReadonlySet<string>>();
  for (const examId of anchorExamIds) {
    const snapshot = examSnapshots.get(examId);
    if (!snapshot) continue; // fail closed → refs drop
    examQuestionIds.set(
      examId,
      new Set(snapshot.map((q) => q.originalQuestionId)),
    );
  }

  return { ownedAttemptExamIds, eligibleExamIds, examQuestionIds };
}

/** Per-event normalization for a whole batch, preserving order. */
export async function normalizeClientEventReferences(
  db: Database,
  ctx: RequestContext,
  events: ClientEvent[],
): Promise<NormalizedEventReferences[]> {
  const claimed = events.map((e) => ({
    attemptId: e.attemptId ?? null,
    examId: e.examId ?? null,
    questionId: e.questionId ?? null,
  }));
  const evidence = await loadReferenceEvidence(db, ctx, claimed);
  return claimed.map((c) => resolveEventReferences(c, evidence));
}

function distinct(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
