import { ApiError } from "@/lib/api";
import type { SaveAnswerRejectReason } from "@exam/contracts";

/**
 * EXAM-519 — terminal-attempt signal classification.
 *
 * A terminal error response is a SIGNAL to re-read the authoritative
 * CandidateTakeSnapshot; it is NOT itself terminal state. These predicates
 * distinguish "the server terminalized the attempt" from transport or
 * connectivity failure, so the page can converge instead of showing the
 * generic disconnect banner for an attempt that will never save again.
 *
 * Wire facts (server authority, packages/domain/src/errors.ts):
 *   - heartbeat on a non-in_progress attempt → HTTP 409, code
 *     INVALID_STATE_TRANSITION (InvalidStateTransitionError).
 *   - save-answer on a terminal attempt → HTTP 200 { accepted: false,
 *     reason } with a SaveAnswerRejectReason from the frozen vocabulary.
 */

/** Save-rejection reasons that mean the attempt itself became terminal. */
const TERMINAL_SAVE_REJECT_REASONS: ReadonlySet<SaveAnswerRejectReason> =
  new Set(["ATTEMPT_ALREADY_SUBMITTED", "ATTEMPT_CLOSED", "DEADLINE_EXCEEDED"]);

/** True when a save rejection reports a terminal attempt, not a local conflict. */
export function isTerminalSaveRejection(
  reason: SaveAnswerRejectReason,
): boolean {
  return TERMINAL_SAVE_REJECT_REASONS.has(reason);
}

/**
 * True when a heartbeat failure is the server reporting a terminal attempt
 * (409 INVALID_STATE_TRANSITION). Any other failure — network errors
 * (status 0), validation, permission — stays a connectivity-class failure.
 */
export function isTerminalHeartbeatSignal(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    err.code === "INVALID_STATE_TRANSITION"
  );
}
