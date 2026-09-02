import type { CandidateTakeSnapshot } from "@exam/contracts";

/**
 * Question view derived from a snapshot question — input control disabled
 * exactly when the attempt is not editable, per L0 §7.2.
 */
export interface DerivedQuestionView {
  id: string;
  type: CandidateTakeSnapshot["questions"][number]["type"];
  prompt: string;
  /** Rich prompt document (null → Plain mode); passthrough from snapshot. */
  promptDocument: CandidateTakeSnapshot["questions"][number]["promptDocument"];
  /** How candidates answer text_response questions; passthrough. */
  answerMode: CandidateTakeSnapshot["questions"][number]["answerMode"];
  options: CandidateTakeSnapshot["questions"][number]["options"];
  inputMode: CandidateTakeSnapshot["questions"][number]["inputMode"];
  maxScore: number;
  answerValue: unknown;
  answerSource: CandidateTakeSnapshot["questions"][number]["answerSource"];
  disabled: boolean;
}

/**
 * Page display state derived purely from a CandidateTakeSnapshot.
 *
 * The backend snapshot is the business truth source; this function never
 * copies raw DB state and never invents business rules. It only projects
 * the snapshot's derived-capability fields into a shape the UI consumes.
 */
export interface TakeExamView {
  attemptId: string;
  examId: string;
  attemptStatus: CandidateTakeSnapshot["attemptStatus"];
  isLocked: boolean;
  lockReason: CandidateTakeSnapshot["lockReason"];
  canSave: boolean;
  canSubmit: boolean;
  canResume: boolean;
  showResult: boolean;
  showAnswers: boolean;
  serverNow: string;
  /** Canonical timing mode — gates the personal countdown (Phase A2 (Issue 291)). */
  timingMode: CandidateTakeSnapshot["timingMode"];
  effectiveDeadline: string | null;
  submittedAt: string | null;
  questions: DerivedQuestionView[];
}

/**
 * Derives page display state from a CandidateTakeSnapshot (L0 §7.2).
 *
 * `disabled` on each question equals `!isEditable`, so a submitted/disrupted/
 * deadline-locked attempt shows disabled inputs without the page re-deriving
 * business rules. `showResult` / `showAnswers` project the snapshot's
 * visibility flags; the snapshot is the single source that decides whether
 * scores or standard answers may be shown.
 */
export function deriveTakeExamView(
  snapshot: CandidateTakeSnapshot,
): TakeExamView {
  const isLocked = !snapshot.isEditable;

  return {
    attemptId: snapshot.attemptId,
    examId: snapshot.examId,
    attemptStatus: snapshot.attemptStatus,
    isLocked,
    lockReason: snapshot.lockReason,
    canSave: snapshot.canSave,
    canSubmit: snapshot.canSubmit,
    canResume: snapshot.canResume,
    showResult: snapshot.resultVisibility === "visible",
    showAnswers: snapshot.answerVisibility === "visible",
    serverNow: snapshot.serverNow,
    timingMode: snapshot.timingMode,
    effectiveDeadline: snapshot.effectiveDeadline,
    submittedAt: snapshot.submittedAt,
    questions: snapshot.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      promptDocument: q.promptDocument,
      answerMode: q.answerMode,
      options: q.options,
      inputMode: q.inputMode,
      maxScore: q.maxScore,
      answerValue: q.answerValue,
      answerSource: q.answerSource,
      disabled: isLocked,
    })),
  };
}
