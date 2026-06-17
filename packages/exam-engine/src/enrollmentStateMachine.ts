import type { EnrollmentStatus } from "@exam/domain";
import { InvalidStateTransitionError } from "@exam/domain";

/** Valid state transitions for exam enrollments. */
export const ENROLLMENT_VALID_TRANSITIONS: Record<
  EnrollmentStatus,
  EnrollmentStatus[]
> = {
  assigned: ["started", "blocked"],
  started: ["completed", "blocked"],
  blocked: ["started"],
  completed: [],
};

/** Checks whether a transition from the current to the target enrollment status is allowed. */
export function canTransition(
  current: EnrollmentStatus,
  target: EnrollmentStatus,
): boolean {
  return ENROLLMENT_VALID_TRANSITIONS[current]?.includes(target) ?? false;
}

/**
 * Asserts that a transition from the current to the target enrollment status is valid.
 * Throws InvalidStateTransitionError if the transition is not allowed.
 */
export function assertTransition(
  current: EnrollmentStatus,
  target: EnrollmentStatus,
): void {
  if (!canTransition(current, target)) {
    throw new InvalidStateTransitionError(
      `Cannot transition enrollment from ${current} to ${target}`,
    );
  }
}
