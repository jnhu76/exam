import { describe, expect, it } from "vitest";
import { AttemptStatus } from "@exam/domain";
import { transition, type AttemptCommand } from "./attemptStateMachine.js";

describe("attemptStateMachine", () => {
  describe("valid transitions", () => {
    it("in_progress → submitted via submit", () => {
      const result = transition("in_progress", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("in_progress → disrupted via disrupt", () => {
      const result = transition("in_progress", "disrupt");
      expect(result).toEqual({ ok: true, next: "disrupted" });
    });

    it("disrupted → submitted via submit", () => {
      const result = transition("disrupted", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("disrupted → in_progress via restore", () => {
      const result = transition("disrupted", "restore");
      expect(result).toEqual({ ok: true, next: "in_progress" });
    });

    it("submitted → graded via grade (terminal grading closes in one step, #542)", () => {
      const result = transition("submitted", "grade");
      expect(result).toEqual({ ok: true, next: "graded" });
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["not_started", "submit" as const],
      ["not_started", "disrupt" as const],
      ["not_started", "restore" as const],
      ["not_started", "grade" as const],
      ["queued", "submit" as const],
      ["queued", "disrupt" as const],
      ["queued", "restore" as const],
      ["queued", "grade" as const],
      ["in_progress", "grade" as const], // cannot skip submit
      ["in_progress", "restore" as const], // not disrupted
      ["disrupted", "disrupt" as const], // already disrupted
      ["disrupted", "grade" as const], // grading requires the submitted freeze snapshot
      ["submitted", "submit" as const],
      ["submitted", "disrupt" as const],
      ["submitted", "restore" as const],
      ["graded", "submit" as const],
      ["graded", "disrupt" as const],
      ["graded", "restore" as const],
      ["graded", "grade" as const],
      ["voided", "submit" as const],
      ["voided", "disrupt" as const],
      ["voided", "restore" as const],
      ["voided", "grade" as const],
    ] as const)(
      "rejects %s → %s with INVALID_SOURCE_STATUS",
      (status, command) => {
        const result = transition(status, command);
        expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
      },
    );
  });
  // The isTransitionOk guard is a 1-line `return result.ok` pass-through
  // exercised implicitly by every transition() row above; it has no separate
  // hand-built-literal tests.
});

/**
 * Exhaustive matrix over `Object.values(AttemptStatus) × all commands`,
 * derived from the domain enum (same closed-tuple derivation pattern as
 * `packages/contracts/src/recovery.ts:33-42`). A new AttemptStatus value
 * automatically enters the matrix; the type assertion below keeps COMMANDS
 * closed over AttemptCommand vocabulary growth.
 */
describe("attemptStateMachine exhaustive matrix", () => {
  const COMMANDS = [
    "submit",
    "disrupt",
    "restore",
    "grade",
  ] as const satisfies readonly AttemptCommand[];

  type Assert<T extends true> = T;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type CommandsExhaustive = Assert<
    Exclude<AttemptCommand, (typeof COMMANDS)[number]> extends never
      ? true
      : false
  >;

  // The canonical valid cells; every other (status, command) combination must
  // be rejected with INVALID_SOURCE_STATUS. These five rows are the authority
  // markDisrupted/restoreAttemptState write points consult via transition().
  const EXPECTED_NEXT: Partial<
    Record<AttemptStatus, Partial<Record<AttemptCommand, AttemptStatus>>>
  > = {
    in_progress: { submit: "submitted", disrupt: "disrupted" },
    disrupted: { submit: "submitted", restore: "in_progress" },
    submitted: { grade: "graded" },
  };

  for (const status of Object.values(AttemptStatus)) {
    for (const command of COMMANDS) {
      const expectedNext = EXPECTED_NEXT[status]?.[command];
      it(`${status} × ${command} → ${
        expectedNext ?? "INVALID_SOURCE_STATUS"
      }`, () => {
        const result = transition(status, command);
        if (expectedNext) {
          expect(result).toEqual({ ok: true, next: expectedNext });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: "INVALID_SOURCE_STATUS",
          });
        }
      });
    }
  }
});
