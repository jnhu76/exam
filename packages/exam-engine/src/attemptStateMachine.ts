import type { AttemptStatus } from "@exam/domain";

export type AttemptCommand =
  | "submit"
  | "disrupt"
  | "restore"
  | "grade"
  | "complete_grading";

export type TransitionRejectionReason =
  | "INVALID_SOURCE_STATUS"
  | "DEADLINE_EXCEEDED";

export interface TransitionOk {
  ok: true;
  next: AttemptStatus;
}

export interface TransitionFail {
  ok: false;
  reason: TransitionRejectionReason;
}

export type TransitionResult = TransitionOk | TransitionFail;

export interface TransitionGuards {
  deadlineAt?: Date;
  now?: Date;
}

const TRANSITION_TABLE: Record<string, AttemptStatus> = {
  "in_progress:submit": "submitted",
  "in_progress:disrupt": "disrupted",
  "disrupted:submit": "submitted",
  "disrupted:restore": "in_progress",
  "submitted:grade": "grading",
  "grading:complete_grading": "graded",
};

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

export function isTransitionOk(
  result: TransitionResult,
): result is TransitionOk {
  return result.ok;
}
