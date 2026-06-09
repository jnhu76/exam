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

const DEADLINE_GUARDED_COMMANDS: Set<AttemptCommand> = new Set(["submit"]);

export function transition(
  current: AttemptStatus,
  command: AttemptCommand,
  guards?: TransitionGuards,
): TransitionResult {
  const key = `${current}:${command}`;
  const next = TRANSITION_TABLE[key];

  if (!next) {
    return { ok: false, reason: "INVALID_SOURCE_STATUS" };
  }

  if (
    DEADLINE_GUARDED_COMMANDS.has(command) &&
    guards?.deadlineAt &&
    guards?.now
  ) {
    if (guards.now.getTime() > guards.deadlineAt.getTime()) {
      return { ok: false, reason: "DEADLINE_EXCEEDED" };
    }
  }

  return { ok: true, next };
}

export function isTransitionOk(
  result: TransitionResult,
): result is TransitionOk {
  return result.ok;
}
