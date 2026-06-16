import type { ExamStatus } from "@exam/domain";
import { InvalidStateTransitionError } from "@exam/domain";

export const EXAM_VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  draft: ["published"],
  published: ["open", "archived"],
  open: ["closed"],
  closed: ["archived"],
  archived: [],
};

export function canTransition(
  current: ExamStatus,
  target: ExamStatus,
): boolean {
  return EXAM_VALID_TRANSITIONS[current]?.includes(target) ?? false;
}

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
