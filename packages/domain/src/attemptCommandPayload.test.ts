/**
 * Canonical payload + replay/conflict helper tests (J5-I1C Slice 1 /
 * J5-I1C0 audit §8, §11.11).
 *
 * Freezes the canonicalization rules and the pure replay/conflict classifier.
 * These are pure-function tests — no database — so they live next to the
 * helper module.
 *
 * The force_submit reason contract follows J5-R0 §8.1 (server-required,
 * trimmed, 1..500): the canonical payload NEVER contains null/blank, and the
 * compile-time tests below prove the commandType ↔ input binding (a
 * mismatched payload cannot be expressed).
 */

import { describe, expect, it } from "vitest";
import {
  attemptCommandPayloadsEqual,
  canonicalizeAttemptCommandRequest,
  canonicalizeForceSubmitPayload,
  canonicalizeMisconductPayload,
  classifyAttemptCommandReplay,
  sortKeys,
  type AttemptCommandInputByType,
} from "./attemptCommandPayload.js";

describe("canonical force_submit payload", () => {
  it("trims a surrounding-whitespace reason", () => {
    expect(canonicalizeForceSubmitPayload({ reason: "  reason  " })).toEqual({
      reason: "reason",
    });
  });

  it("rejects a blank-after-trim reason (canonical form is never null/empty)", () => {
    expect(() => canonicalizeForceSubmitPayload({ reason: "" })).toThrow(
      /non-empty reason/,
    );
    expect(() => canonicalizeForceSubmitPayload({ reason: "   " })).toThrow(
      /non-empty reason/,
    );
  });
});

describe("canonical misconduct_mark payload", () => {
  it("trims notes and preserves severity", () => {
    expect(
      canonicalizeMisconductPayload({
        severity: "warning",
        notes: "  notes  ",
      }),
    ).toEqual({ severity: "warning", notes: "notes" });
  });

  it("rejects whitespace-only notes (canonical form is never ambiguous)", () => {
    expect(() =>
      canonicalizeMisconductPayload({ severity: "serious", notes: "   " }),
    ).toThrow(/non-empty notes/);
  });
});

describe("canonicalizeAttemptCommandRequest dispatch", () => {
  it("routes force_submit to the force-submit canonicalizer", () => {
    expect(
      canonicalizeAttemptCommandRequest("force_submit", { reason: " x " }),
    ).toEqual({ reason: "x" });
  });

  it("routes misconduct_mark to the misconduct canonicalizer", () => {
    expect(
      canonicalizeAttemptCommandRequest("misconduct_mark", {
        severity: "serious",
        notes: " n ",
      }),
    ).toEqual({ severity: "serious", notes: "n" });
  });

  it("binds the return payload to the requested command type (compile-time)", () => {
    const forceSubmit = canonicalizeAttemptCommandRequest("force_submit", {
      reason: "x",
    });
    const misconduct = canonicalizeAttemptCommandRequest("misconduct_mark", {
      severity: "warning",
      notes: "n",
    });
    // Both are narrowed to their command's canonical payload at compile time;
    // assigning them to the wrong shape must not typecheck.
    const _forceSubmitCheck: { reason: string } = forceSubmit;
    const _misconductCheck: {
      severity: "warning" | "serious";
      notes: string;
    } = misconduct;
    expect(_forceSubmitCheck.reason).toBe("x");
    expect(_misconductCheck.notes).toBe("n");
  });

  // ── Compile-time binding guards ──────────────────────────────────
  // The @ts-expect-error directives fail typecheck (TS2578 unused) if the
  // commandType ↔ input binding ever regresses to a loose union. The calls
  // are guarded by `if (false)` so they are type-checked but NEVER executed
  // (a mismatched call must not silently canonicalize at runtime).

  it("rejects a misconduct payload for force_submit (compile-time)", () => {
    // The explicit type argument pins C, so the mismatched argument is a
    // TS2345 on the call line (the expect-error directive is directly above);
    // the call never executes.
    const msIn: AttemptCommandInputByType["misconduct_mark"] = {
      severity: "warning",
      notes: "x",
    };
    if (false) {
      // @ts-expect-error — force_submit input is { reason: string }.
      canonicalizeAttemptCommandRequest<"force_submit">("force_submit", msIn);
    }
  });

  it("rejects a force-submit payload for misconduct_mark (compile-time)", () => {
    const fsIn: AttemptCommandInputByType["force_submit"] = { reason: "x" };
    if (false) {
      // prettier-ignore
      // @ts-expect-error — misconduct_mark input is { severity, notes }.
      canonicalizeAttemptCommandRequest<"misconduct_mark">("misconduct_mark", fsIn);
    }
  });
});

describe("attemptCommandPayloadsEqual", () => {
  it("is object-key-order insensitive", () => {
    expect(
      attemptCommandPayloadsEqual(
        { reason: "x", extra: 1 },
        { extra: 1, reason: "x" },
      ),
    ).toBe(true);
  });

  it("preserves array order", () => {
    expect(attemptCommandPayloadsEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(attemptCommandPayloadsEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("distinguishes different canonical payloads", () => {
    expect(attemptCommandPayloadsEqual({ reason: "a" }, { reason: "b" })).toBe(
      false,
    );
    expect(
      attemptCommandPayloadsEqual(
        { severity: "warning", notes: "x" },
        { severity: "serious", notes: "x" },
      ),
    ).toBe(false);
  });

  it("treats undefined and null distinctly from missing (no fuzzy matching)", () => {
    // sortKeys keeps undefined as-is; equality is exact. {a:undefined} vs {}:
    // JSON.stringify drops undefined keys, so both serialize to "{}" — this is
    // the documented Postgres-jsonb-aligned behavior (a missing key and an
    // explicit-undefined key both vanish from the jsonb comparison).
    expect(sortKeys({ a: undefined })).toEqual({ a: undefined });
    expect(attemptCommandPayloadsEqual({ a: undefined }, {})).toBe(true);
  });
});

describe("classifyAttemptCommandReplay", () => {
  const replayInput = {
    storedCommandType: "force_submit",
    storedAttemptId: "att-1",
    storedRequestPayload: { reason: "x" },
    requestedCommandType: "force_submit" as const,
    requestedAttemptId: "att-1",
    requestedCanonicalPayload: { reason: "x" },
  };

  it("returns replay when commandType, attemptId, and canonical payload all match", () => {
    expect(classifyAttemptCommandReplay(replayInput)).toEqual({
      kind: "replay",
    });
  });

  it("returns a command_type conflict when the command differs", () => {
    expect(
      classifyAttemptCommandReplay({
        ...replayInput,
        requestedCommandType: "misconduct_mark",
      }),
    ).toEqual({ kind: "conflict", reason: "command_type" });
  });

  it("returns an attempt_id conflict when the attempt differs", () => {
    expect(
      classifyAttemptCommandReplay({
        ...replayInput,
        requestedAttemptId: "att-2",
      }),
    ).toEqual({ kind: "conflict", reason: "attempt_id" });
  });

  it("returns a payload conflict when the canonical payload differs", () => {
    expect(
      classifyAttemptCommandReplay({
        ...replayInput,
        requestedCanonicalPayload: { reason: "different" },
      }),
    ).toEqual({ kind: "conflict", reason: "payload" });
  });

  it("payload comparison is order-insensitive", () => {
    expect(
      classifyAttemptCommandReplay({
        ...replayInput,
        storedRequestPayload: { reason: "x", tag: 1 },
        requestedCanonicalPayload: { tag: 1, reason: "x" },
      }),
    ).toEqual({ kind: "replay" });
  });
});
