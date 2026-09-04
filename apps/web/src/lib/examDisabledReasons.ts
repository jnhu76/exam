import type {
  DeleteDisabledReasonCode,
  ScoreViewDisabledReasonCode,
} from "@exam/contracts";

/**
 * i18n presentation key for a machine DisabledReasonCode (message contract
 * D0.8, C3): first-party tooltips/explanations render from the machine code
 * via Web i18n; the legacy natural-language wire sibling is never required.
 */
export type ExamDisabledReasonKey =
  | "admin.exams.disabledReasons.canceled"
  | "admin.exams.disabledReasons.notFinished"
  | "admin.exams.disabledReasons.noGradedAttempts"
  | "admin.exams.disabledReasons.notDraft";

const SCORE_VIEW_KEYS: Record<
  ScoreViewDisabledReasonCode,
  ExamDisabledReasonKey
> = {
  EXAM_CANCELED: "admin.exams.disabledReasons.canceled",
  EXAM_NOT_FINISHED: "admin.exams.disabledReasons.notFinished",
  NO_GRADED_ATTEMPTS: "admin.exams.disabledReasons.noGradedAttempts",
};

const DELETE_KEYS: Record<DeleteDisabledReasonCode, ExamDisabledReasonKey> = {
  EXAM_NOT_DRAFT: "admin.exams.disabledReasons.notDraft",
};

/**
 * Returns the i18n key for a score-view block reason, or null for an unknown
 * future code — callers then fall back to the legacy natural-language wire
 * field (compatibility-only, D0.8 migration rule).
 */
export function scoreViewDisabledReasonKey(
  code: ScoreViewDisabledReasonCode,
): ExamDisabledReasonKey | null {
  return SCORE_VIEW_KEYS[code] ?? null;
}

/** Same forward-compat contract as {@link scoreViewDisabledReasonKey}. */
export function deleteDisabledReasonKey(
  code: DeleteDisabledReasonCode,
): ExamDisabledReasonKey | null {
  return DELETE_KEYS[code] ?? null;
}
