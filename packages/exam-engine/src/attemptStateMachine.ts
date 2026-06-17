import type { AttemptStatus } from "@exam/domain";

/** Commands that drive the attempt state machine transitions. */
export type AttemptCommand =
  | "submit"
  | "disrupt"
  | "restore"
  | "grade"
  | "complete_grading";

/** Reasons a state transition may be rejected by the guard. */
export type TransitionRejectionReason =
  | "INVALID_SOURCE_STATUS"
  | "DEADLINE_EXCEEDED";

/** Successful transition result indicating the next attempt status. */
export interface TransitionOk {
  ok: true;
  next: AttemptStatus;
}

/** Failed transition result with the rejection reason. */
export interface TransitionFail {
  ok: false;
  reason: TransitionRejectionReason;
}

/** Discriminated union of transition outcomes: success or failure. */
export type TransitionResult = TransitionOk | TransitionFail;

/** Optional guards evaluated before a transition is applied (e.g., deadline check). */
export interface TransitionGuards {
  deadlineAt?: Date;
  now?: Date;
}

/** Valid state transitions for exam attempts keyed by "currentStatus:command". */
const TRANSITION_TABLE: Record<string, AttemptStatus> = {
  "in_progress:submit": "submitted",
  "in_progress:disrupt": "disrupted",
  "disrupted:submit": "submitted",
  "disrupted:restore": "in_progress",
  "submitted:grade": "grading",
  "grading:complete_grading": "graded",
};

/**
 * Evaluates whether a state transition is valid and returns the resulting state.
 * Uses the transition table to look up the target status for a given command.
 */
export function transition(
  current: AttemptStatus,
  command: AttemptCommand,
): TransitionResult {
  const key = `${current}:${command}`;
  const next = TRANSITION_TABLE[key];

  if (!next) {
    return { ok: false, reason: "INVALID_SOURCE_STATUS" };
  }

  return { ok: true, next };
}

/** Type guard that narrows TransitionResult to TransitionOk when the transition succeeded. */
export function isTransitionOk(
  result: TransitionResult,
): result is TransitionOk {
  return result.ok;
}
