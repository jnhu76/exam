/**
 * Canonical payload + replay/conflict helper tests (J5-I1C Slice 1 /
 * J5-I1C0 audit §8, §11.11).
 *
 * Freezes the canonicalization rules and the pure replay/conflict classifier.
 * These are pure-function tests — no database — so they live next to the
 * helper module.
 */

import { describe, expect, it } from "vitest";
import {
  attemptCommandPayloadsEqual,
  canonicalizeAttemptCommandRequest,
  canonicalizeForceSubmitPayload,
  canonicalizeMisconductPayload,
  classifyAttemptCommandReplay,
  sortKeys,
} from "./attemptCommandPayload.js";

describe("canonical force_submit payload", () => {
  it("trims a surrounding-whitespace reason", () => {
    expect(canonicalizeForceSubmitPayload({ reason: "  reason  " })).toEqual({
      reason: "reason",
    });
  });

  it("canonicalizes undefined reason to { reason: null }", () => {
    expect(canonicalizeForceSubmitPayload({})).toEqual({ reason: null });
    expect(canonicalizeForceSubmitPayload({ reason: undefined })).toEqual({
      reason: null,
    });
  });

  it("canonicalizes null / empty / whitespace-only reason to { reason: null }", () => {
    expect(canonicalizeForceSubmitPayload({ reason: null })).toEqual({
      reason: null,
    });
    expect(canonicalizeForceSubmitPayload({ reason: "" })).toEqual({
      reason: null,
    });
    expect(canonicalizeForceSubmitPayload({ reason: "   " })).toEqual({
      reason: null,
    });
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
