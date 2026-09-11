import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { SaveAnswerRejectReason } from "@exam/contracts";
import {
  isTerminalHeartbeatSignal,
  isTerminalSaveRejection,
} from "./terminalAttemptSignal";

/**
 * EXAM-519 — terminal-signal classification unit tests.
 *
 * The predicates map wire facts to one of two client reactions:
 *   terminal signal   → re-read the authoritative take snapshot (converge)
 *   anything else     → existing connectivity/save-error handling
 * A terminal error is a signal to re-read authority, never authority itself;
 * these tests pin the exact wire shapes (status + code for heartbeat, the
 * typed SaveAnswerRejectReason vocabulary for saves).
 */

describe("isTerminalHeartbeatSignal", () => {
  it("classifies heartbeat 409 INVALID_STATE_TRANSITION as terminal", () => {
    expect(
      isTerminalHeartbeatSignal(
        new ApiError(
          409,
          "Cannot heartbeat attempt: status changed or attempt not found",
          "INVALID_STATE_TRANSITION",
        ),
      ),
    ).toBe(true);
  });

  it("does not classify a network failure as terminal", () => {
    expect(
      isTerminalHeartbeatSignal(new ApiError(0, "Network request failed")),
    ).toBe(false);
  });

  it("does not classify other HTTP errors as terminal", () => {
    expect(
      isTerminalHeartbeatSignal(
        new ApiError(400, "bad request", "VALIDATION_ERROR"),
      ),
    ).toBe(false);
    expect(
      isTerminalHeartbeatSignal(
        new ApiError(403, "forbidden", "PERMISSION_DENIED"),
      ),
    ).toBe(false);
    expect(
      isTerminalHeartbeatSignal(
        new ApiError(409, "conflict", "ANSWER_VERSION_CONFLICT"),
      ),
    ).toBe(false);
  });

  it("does not classify non-ApiError throws as terminal", () => {
    expect(isTerminalHeartbeatSignal(new Error("boom"))).toBe(false);
    expect(isTerminalHeartbeatSignal("network")).toBe(false);
    expect(isTerminalHeartbeatSignal(undefined)).toBe(false);
  });
});

describe("isTerminalSaveRejection", () => {
  const terminal: SaveAnswerRejectReason[] = [
    "ATTEMPT_ALREADY_SUBMITTED",
    "ATTEMPT_CLOSED",
    "DEADLINE_EXCEEDED",
  ];
  const nonTerminal: SaveAnswerRejectReason[] = [
    "STALE_VERSION",
    "FUTURE_VERSION",
    "CONFLICTING_PAYLOAD",
    "INVALID_ANSWER",
  ];

  it("classifies the terminal reason vocabulary", () => {
    for (const reason of terminal) {
      expect(isTerminalSaveRejection(reason), reason).toBe(true);
    }
  });

  it("leaves ordinary rejection reasons non-terminal", () => {
    for (const reason of nonTerminal) {
      expect(isTerminalSaveRejection(reason), reason).toBe(false);
    }
  });
});
