/**
 * Transient UI state for the TakeExam page (L0 §7.3).
 *
 * This is deliberately NOT a copy of AttemptStatus. It only tracks
 * short-lived UI phases (saving / submitting / error). The backend
 * CandidateTakeSnapshot remains the business truth source.
 */
export type TransientState =
  | "idle"
  | "saving"
  | "save_failed"
  | "submitting"
  | "submit_failed"
  | "load_failed";

/**
 * Events that drive transient UI state transitions (L0 §7.3).
 */
export type TransientEvent =
  | { type: "SAVE_REQUEST" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_FAILED" }
  | { type: "SUBMIT_REQUEST" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_FAILED" }
  | { type: "LOAD_FAILED" }
  | { type: "RESET" };

/**
 * Reduces a transient state + event into the next transient state.
 *
 * Two anti-repeat guards (L0 §7.3):
 * - `submitting` ignores `SUBMIT_REQUEST` so a double-click cannot fire a
 *   second submit.
 * - `save_failed` (and any other non-locked state) still honors SAVE_REQUEST
 *   so retries work.
 *
 * Any state accepts RESET → idle and LOAD_FAILED → load_failed.
 */
export function transientReducer(
  state: TransientState,
  event: TransientEvent,
): TransientState {
  switch (event.type) {
    case "RESET":
      return "idle";
    case "LOAD_FAILED":
      return "load_failed";
    case "SAVE_REQUEST":
      if (state === "submitting") return state;
      return "saving";
    case "SAVE_SUCCESS":
      return state === "saving" ? "idle" : state;
    case "SAVE_FAILED":
      return state === "saving" ? "save_failed" : state;
    case "SUBMIT_REQUEST":
      // Double-submit guard: ignore while already submitting.
      if (state === "submitting") return state;
      return "submitting";
    case "SUBMIT_SUCCESS":
      return state === "submitting" ? "idle" : state;
    case "SUBMIT_FAILED":
      return state === "submitting" ? "submit_failed" : state;
    default: {
      // Exhaustiveness guard — if a new event is added without a case, the
      // compiler flags it here.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
