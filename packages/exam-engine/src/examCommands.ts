import type { Exam, Question, QuestionSnapshot } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";
import { plainTextProjection } from "@exam/domain";
import { assertTransition } from "./examStateMachine.js";
import { assertExamPolicyValid } from "./examPolicy.js";

export { assertTransition as assertExamTransition } from "./examStateMachine.js";

/**
 * P3-L0-5: placeholder strings that look non-empty but carry no real answer
 * or rubric. CONTEXT.md: "Empty strings like '暂无' do not count as valid."
 * Trimmed + lowercased before comparison so "  N/A  " matches.
 */
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  "暂无",
  "无",
  "n/a",
  "na",
  "null",
  "none",
]);

/** True when the value is missing, blank, or a known placeholder. */
function isEmptyOrPlaceholder(value: unknown): boolean {
  // Strict null/undefined check (project lint bans == / !=).
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" || PLACEHOLDER_VALUES.has(trimmed);
  }
  // Arrays/objects: empty array or empty object counts as empty.
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  // Numbers/booleans: never treated as placeholder answers.
  return false;
}

/** Repository interface for persisting exam records. */
export interface ExamRepository {
  findById(examId: string): Promise<Exam | null> | Exam | null;
  /**
   * Loads an exam under the caller's row lock (FOR UPDATE). Required by
   * interruption restore/bounded-grace evaluation to serialize the
   * authoritative `closeAt` read against exam-window changes, and by
   * `publishResults` to serialize the write-once `resultsPublishedAt`
   * decision (P7-S2-A). Lock order Enrollment → Attempt → Exam must be
   * preserved; no Exam → Attempt path.
   */
  findByIdForUpdate(examId: string): Promise<Exam | null> | Exam | null;
  update(
    examId: string,
    data: Partial<Exam>,
  ): Promise<Exam | null> | Exam | null;
}

/**
 * Builds a snapshot of the questions assigned to an exam, preserving order and copying
 * question data to prevent later bank edits from affecting existing attempts.
 */
export function buildQuestionSnapshot(
  questionIds: string[],
  questions: Question[],
): QuestionSnapshot[] {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  return questionIds.map((qid, index) => {
    const q = questionMap.get(qid);
    if (!q) {
      throw new ValidationError(`Question ${qid} not found`);
    }
    return {
      originalQuestionId: q.id,
      type: q.type,
      content: q.content,
      // #301: freeze the B′ rich-content authority alongside its derived
      // projection. Null (Plain) on legacy rows.
      contentDocument: q.contentDocument ?? null,
      answerMode: q.answerMode ?? null,
      attachments: q.attachments,
      options: q.options.map((o) => ({
        id: o.id,
        content: o.content,
        contentDocument: o.contentDocument ?? null,
      })),
      standardAnswer: q.standardAnswer,
      score: q.score,
      gradingRule: q.gradingRule,
      order: index,
      // P3-L0-1: rubric dual-layer — copy authoring source into the frozen
      // grading source. Always string | null; objective questions carry null.
      rubric: q.rubric ?? null,
    };
  });
}

/**
 * Publishes an exam: validates all preconditions (questions, scores, timing, policies),
 * builds the question snapshot, and transitions the exam to published status.
 */
export async function publishExam(
  repo: ExamRepository,
  examId: string,
  questions: Question[],
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "published");

  if (exam.questionIds.length === 0) {
    throw new ValidationError("Exam must have at least one question");
  }
  // P7-M1: Phase-1 invariants. The timing/selection/retake enum values are
  // narrowed by Zod literals at the contract boundary; these guards are the
  // engine-side re-check (publish is the freeze/acceptance gate) and also
  // defend against historically/stale data that predates a narrower contract.
  // Phase A2 (#291): timed_window/deadline/untimed are publishable; the
  // canonical revalidation below is the authority that rejects timed_sync.
  if (exam.timingMode === "timed_sync") {
    throw new ValidationError("timed_sync exams are not supported");
  }
  if (exam.questionSelectionMode !== "manual") {
    throw new ValidationError(
      "Phase 1 only supports manual question selection",
    );
  }
  if (
    !["unlimited", "max_attempts", "pass_then_stop"].includes(exam.retakePolicy)
  ) {
    throw new ValidationError("Retake policy is not supported in Phase 1");
  }
  // `duration_minutes` has no DB CHECK (> 0), so publish is the last line for
  // historical/stale rows that bypass the Zod `.positive()` shape boundary
  // (P7-M1 design §9: duration is "Zod + publish"). Shape invariant, not
  // cross-field — stays here rather than in the canonical validator. Null is
  // legal since Phase A (#291): deadline/untimed exams carry no duration
  // (their mode matrix lives in the canonical revalidation below).
  if (exam.durationMinutes !== null && exam.durationMinutes <= 0) {
    throw new ValidationError("Duration must be positive");
  }

  // P7-M1: canonical cross-field policy revalidation (design §11). Publish is
  // the authority/freeze boundary and revalidates the WHOLE resolved policy —
  // window ordering, passing<=total, max_attempts sanity, and interruption
  // caps (ADR-013). Replaces the previously scattered inline guards. Pure;
  // resource-integrity checks (standardAnswer/rubric, totalScore==sum) below
  // remain here because they need DB-loaded question facts.
  assertExamPolicyValid(exam);

  const questionSnapshot = buildQuestionSnapshot(exam.questionIds, questions);
  if (questions.some((question) => question.courseId !== exam.courseId)) {
    throw new ValidationError("Exam questions must belong to its course");
  }

  // P3-L0-5 publish validation (CONTEXT.md "Publish validation"):
  //   - auto questions (single_choice/multiple_choice/true_false/fill_blank)
  //     require a non-empty, non-placeholder standardAnswer.
  //   - text_response requires a non-empty, non-placeholder rubric;
  //     standardAnswer is optional for text_response.
  // Draft-time empty values are allowed; publish enforces.
  //
  // The auto-grading check is gated on an explicit autoGradedTypes set rather
  // than a bare `else`, so any future subjective type (added to QuestionType)
  // is NOT silently required to have a standardAnswer.
  const autoGradedTypes: ReadonlySet<Question["type"]> = new Set([
    "single_choice",
    "multiple_choice",
    "true_false",
    "fill_blank",
  ]);
  for (const question of questions) {
    // #301 §16 HARD RULE (publish-side defense in depth): fill_blank is
    // Plain-only. Create/update validation already rejects rich fill_blank;
    // publish is the freeze gate, so stale or bypassing rows fail closed
    // here before any attempt can freeze them.
    if (question.type === "fill_blank" && question.contentDocument != null) {
      throw new ValidationError(
        `fill_blank question ${question.id} must not carry rich content at publish`,
      );
    }
    // #301: answerMode is only meaningful for text_response.
    if (question.answerMode != null && question.type !== "text_response") {
      throw new ValidationError(
        `question ${question.id} carries answerMode but is not text_response`,
      );
    }
    // #301 B′ projection invariant: for Rich questions the stored `content`
    // must be exactly the deterministic projection of the frozen document.
    // A mismatch means a writer bypassed the server-side derivation seam.
    if (question.contentDocument != null) {
      const projection = plainTextProjection(question.contentDocument);
      if (question.content !== projection) {
        throw new ValidationError(
          `rich question ${question.id} content must equal plainTextProjection(contentDocument) at publish`,
        );
      }
    }
    // #301 corrective pass: the SAME projection invariant holds for rich
    // OPTIONS — a divergent frozen option would show candidates one text
    // (plain projection) while the rich renderer draws another. Publish is
    // the freeze gate: fail closed, never auto-repair.
    for (const option of question.options) {
      if (option.contentDocument != null) {
        const optionProjection = plainTextProjection(option.contentDocument);
        if (option.content !== optionProjection) {
          throw new ValidationError(
            `rich option ${option.id} of question ${question.id} content must equal plainTextProjection(contentDocument) at publish`,
          );
        }
      }
    }
    if (question.type === "text_response") {
      if (isEmptyOrPlaceholder(question.rubric)) {
        throw new ValidationError(
          `text_response question ${question.id} requires a non-empty rubric at publish`,
        );
      }
    } else if (autoGradedTypes.has(question.type)) {
      if (isEmptyOrPlaceholder(question.standardAnswer)) {
        throw new ValidationError(
          `auto-graded question ${question.id} requires a non-empty standardAnswer at publish`,
        );
      }
    }
    // Any other type: publish validation is intentionally permissive here;
    // future subjective types will add their own rubric-style guard as needed.
  }
  const totalScore = questionSnapshot.reduce(
    (sum, question) => sum + question.score,
    0,
  );
  if (exam.totalScore !== totalScore) {
    throw new ValidationError("Exam totalScore must match question scores");
  }
  if (exam.passingScore > totalScore) {
    throw new ValidationError("Passing score cannot exceed total score");
  }

  const updated = await repo.update(examId, {
    status: "published",
    questionSnapshot,
  });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Transitions an exam from published to open status, making it available for candidates. */
export async function openExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "open");

  const updated = await repo.update(examId, { status: "open" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Transitions an exam from open to closed status, preventing further attempts.
 *
 * ADR-005 Slice 1 / review decision #2: idempotent for `closed` — a `closed`
 * exam returns unchanged (no `InvalidStateTransitionError`). The route layer
 * uses this to detect the idempotent case and suppress the duplicate audit.
 * The unresolved-attempts guard lives at the route layer (it needs the
 * attempt repo); this engine function performs only the status transition.
 */
export async function closeExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  // Idempotent: already closed -> return as-is.
  if (exam.status === "closed") {
    return exam;
  }

  assertTransition(exam.status, "closed");

  const updated = await repo.update(examId, { status: "closed" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Cancels an exam abnormally (published -> canceled, open -> canceled).
 *
 * ADR-005 Slice 4 (cancel-minimal): the engine performs only the status
 * transition. It does NOT void or force-submit attempts. The unresolved-
 * attempts guard (open with in_progress/disrupted/submitted/grading) lives at
 * the route layer (needs the attempt repo), surfacing as
 * EXAM_CANCEL_NOT_ALLOWED / UNRESOLVED_ATTEMPTS_EXIST. cancel is NOT idempotent
 * (canceled -> canceled is rejected); to settle a canceled exam, archive it.
 */
export async function cancelExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "canceled");

  const updated = await repo.update(examId, { status: "canceled" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Reverts a published exam back to draft (published -> draft).
 *
 * ADR-005 Slice 2 §3.2: only allowed from `published`. The route layer
 * reconciles status by now BEFORE calling this, so a stale `published` exam
 * whose openAt already passed (logically `open`) is rejected at the route as
 * `EXAM_UNPUBLISH_NOT_ALLOWED`. This engine function performs only the
 * transition; it never accepts `open -> draft`.
 */
export async function unpublishExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "draft");

  const updated = await repo.update(examId, { status: "draft" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Extends an open exam's closeAt by a positive number of minutes
 * (open -> open, only closeAt changes).
 *
 * ADR-005 Slice 2 §3.4: only allowed for `open`. The route layer reconciles
 * first, so a stale `open` exam whose closeAt already passed (logically
 * `closed`) is rejected at the route as `EXAM_EXTEND_NOT_ALLOWED` and cannot
 * be revived. `extendMinutes` must be a positive integer; the new closeAt is
 * the old closeAt + extendMinutes (keeps the remaining window semantics).
 */
export async function extendExam(
  repo: ExamRepository,
  examId: string,
  extendMinutes: number,
): Promise<Exam> {
  if (!Number.isInteger(extendMinutes) || extendMinutes <= 0) {
    throw new ValidationError("extendMinutes must be a positive integer");
  }

  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  // extend is NOT a state transition (status stays "open"); it only updates
  // closeAt. So require the status to be exactly "open" rather than using
  // assertTransition (the transition table has no "open -> open" entry).
  if (exam.status !== "open") {
    throw new InvalidStateTransitionError(
      `Cannot extend exam in ${exam.status} state`,
    );
  }

  // #291 Phase A: untimed exams have no closeAt to extend.
  if (exam.closeAt === null) {
    throw new ValidationError("Cannot extend an untimed exam (no closeAt)");
  }

  const oldCloseAt = new Date(exam.closeAt);
  const newCloseAt = new Date(oldCloseAt.getTime() + extendMinutes * 60_000);
  const updated = await repo.update(examId, { closeAt: newCloseAt });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Result of a check-on-access auto-transition, including whether a transition occurred. */
export interface CheckAndUpdateResult {
  exam: Exam;
  transition?: "open" | "closed";
  previousStatus?: string;
}

/**
 * Check-on-access auto-transition for exam status.
 * Lazily transitions published→open when now >= openAt, and open→closed when
 * now >= closeAt. Untimed exams (#291 Phase A) never auto-close — they are
 * open-ended until an admin lifecycle command closes/cancels them.
 * timed_sync exams (#291 Phase B) never auto-open: their open transition is
 * the operator's synchronized start command, so an un-triggered sitting stays
 * published no matter how far past openAt the clock runs. closeAt auto-close
 * still applies once the sitting is open.
 * Returns the exam (potentially updated) with transition info, or null if not found.
 */
export async function checkAndUpdateExamStatus(
  repo: ExamRepository,
  examId: string,
  now: Date,
): Promise<CheckAndUpdateResult | null> {
  let exam = await repo.findById(examId);
  if (!exam) {
    return null;
  }

  const previousStatus = exam.status;
  let transition: "open" | "closed" | undefined;

  if (
    exam.status === "published" &&
    now >= exam.openAt &&
    exam.timingMode !== "timed_sync"
  ) {
    exam = await openExam(repo, examId);
    transition = "open";
  }

  if (exam.status === "open" && exam.closeAt !== null && now >= exam.closeAt) {
    exam = await closeExam(repo, examId);
    transition = "closed";
  }

  return {
    exam,
    ...(transition ? { transition, previousStatus } : {}),
  };
}

/** Transitions an exam to archived status, making it read-only. */
export async function archiveExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "archived");

  const updated = await repo.update(examId, { status: "archived" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Publishes results for an exam (P2D-J5a).
 *
 * Sets `resultsPublishedAt` on the exam so manual-mode result visibility
 * flips from hidden → visible. This is NOT a lifecycle status transition
 * (`status` is unchanged); it only advances the result-visibility state.
 *
 * Allowed only from `published | open | closed` — i.e. any state where the
 * exam is past draft and not in a terminal/canceled state. `draft` (no
 * attempts yet), `canceled`, and `archived` are rejected.
 *
 * Idempotent: if `resultsPublishedAt` is already set, the exam is returned
 * unchanged (the timestamp is never updated on repeat calls). The caller can
 * detect the no-op case via the `alreadyPublished` return flag and suppress
 * duplicate audit/metadata accordingly.
 *
 * P7-S2-A (RESULT_PUBLISH_IS_SINGLE_WINNER): the `resultsPublishedAt`
 * transition NULL → timestamp happens exactly once per exam. The exam row is
 * locked (FOR UPDATE) and the timestamp re-read under the lock, so two
 * concurrent publishers cannot both observe NULL; the loser returns
 * alreadyPublished=true with the committed truth. The caller MUST invoke this
 * inside a transaction so the row lock and the update commit together.
 *
 * NOTE: publish does NOT itself advance grading. If attempts still have
 * `gradingStatus=pending_manual`, their results stay hidden behind the
 * `not_graded` hiddenReason even after this call. Visibility is the AND of
 * "publish done" (manual mode) and "result computable" (grading done).
 */
export async function publishResults(
  repo: ExamRepository,
  examId: string,
  now: Date,
): Promise<{ exam: Exam; alreadyPublished: boolean }> {
  // P7-S2-A: read the exam under the row lock and re-check
  // `resultsPublishedAt` under the lock. Without this serialization two
  // concurrent publishers can both observe NULL and both claim the first
  // publication (double audit, timestamp overwrite).
  const exam = await repo.findByIdForUpdate(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  const allowed = new Set(["published", "open", "closed"]);
  if (!allowed.has(exam.status)) {
    throw new InvalidStateTransitionError(
      `Cannot publish results for exam in ${exam.status} state`,
    );
  }

  // Idempotent: already published -> return as-is, flag the no-op.
  if (exam.resultsPublishedAt != null) {
    return { exam, alreadyPublished: true };
  }

  const updated = await repo.update(examId, { resultsPublishedAt: now });
  if (!updated) throw new ValidationError("Exam not found after update");
  return { exam: updated, alreadyPublished: false };
}
