import type { ExamStatus } from "@exam/domain";
import { InvalidStateTransitionError } from "@exam/domain";

/** Valid state transitions for exams. */
export const EXAM_VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  draft: ["published"],
  published: ["draft", "open", "canceled", "archived"],
  open: ["closed", "canceled"],
  closed: ["archived"],
  canceled: ["archived"],
  archived: [],
};

/** Checks whether a transition from the current to the target exam status is allowed. */
export function canTransition(
  current: ExamStatus,
  target: ExamStatus,
): boolean {
  return EXAM_VALID_TRANSITIONS[current]?.includes(target) ?? false;
}

/**
 * Asserts that a transition from the current to the target exam status is valid.
 * Throws InvalidStateTransitionError if the transition is not allowed.
 */
export function assertTransition(
  current: ExamStatus,
  target: ExamStatus,
): void {
  if (!canTransition(current, target)) {
    throw new InvalidStateTransitionError(
      `Cannot transition exam from ${current} to ${target}`,
    );
  }
}
