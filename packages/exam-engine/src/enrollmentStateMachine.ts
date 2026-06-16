import type { EnrollmentStatus } from "@exam/domain";
import { InvalidStateTransitionError } from "@exam/domain";

export const ENROLLMENT_VALID_TRANSITIONS: Record<
  EnrollmentStatus,
  EnrollmentStatus[]
> = {
  assigned: ["started", "blocked"],
  started: ["completed", "blocked"],
  blocked: ["started"],
  completed: [],
};

export function canTransition(
  current: EnrollmentStatus,
  target: EnrollmentStatus,
): boolean {
  return ENROLLMENT_VALID_TRANSITIONS[current]?.includes(target) ?? false;
}

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
