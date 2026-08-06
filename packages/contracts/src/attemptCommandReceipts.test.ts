/**
 * Attempt command receipt contract tests (J5-I1C Slice 1 / J5-I1C0 audit §7).
 *
 * Verifies the Zod schemas for the durable receipt foundation: enums, the
 * operationId-carrying request shapes (coexisting with the legacy schemas),
 * the persistent receipt record, and the wire response. These contracts are
 * NOT yet wired into any route (Slice 1 is backend-foundation only).
 *
 * Overnight hardening additions:
 *   - force_submit reason is REQUIRED non-null (J5-R0 §8.1) everywhere,
 *     including the canonical payload stored in the receipt;
 *   - every durable canonical payload schema is `.strict()` — unknown fields
 *     are rejected, never silently stripped into a canonical identity;
 *   - the result payload union freezes the FULL per-command committed fact;
 *   - the wire response discriminates on `disposition` so
 *     disposition/outcome inconsistencies cannot be expressed.
 */

import { describe, expect, it } from "vitest";
import {
  AttemptCommandOutcomeSchema,
  AttemptCommandReceiptRecordSchema,
  AttemptCommandReceiptResponseSchema,
  AttemptCommandReceiptResultPayloadSchema,
  AttemptCommandDispositionSchema,
  AttemptCommandTypeSchema,
  ForceSubmitRequestPayloadSchema,
  ForceSubmitWithOperationRequestSchema,
  MisconductMarkRequestPayloadSchema,
  MisconductMarkWithOperationRequestSchema,
} from "./attempt.js";

const OP = "11111111-1111-4111-8111-111111111111";
const TS = "2026-01-01T00:00:00.000Z";

/** A fully-formed force_submit result payload (audit §4.2). */
const forceSubmitResultPayload = {
  commandType: "force_submit" as const,
  beforeStatus: "in_progress" as const,
  afterStatus: "graded" as const,
  submittedAt: TS,
  gradedAt: TS,
  appliedAt: TS,
};

/** A fully-formed misconduct_mark result payload (audit §4.4). */
const misconductResultPayload = {
  commandType: "misconduct_mark" as const,
  misconduct: {
    flaggedAt: TS,
    flaggedBy: "user-1",
    notes: "cheating",
    severity: "warning" as const,
  },
  appliedAt: TS,
};

describe("AttemptCommandTypeSchema", () => {
  it("accepts the two frozen command types", () => {
    expect(AttemptCommandTypeSchema.parse("force_submit")).toBe("force_submit");
    expect(AttemptCommandTypeSchema.parse("misconduct_mark")).toBe(
      "misconduct_mark",
    );
  });

  it("rejects an unknown command type", () => {
    expect(() => AttemptCommandTypeSchema.parse("terminate")).toThrow();
  });
});

describe("AttemptCommandOutcomeSchema (persistent)", () => {
  it("accepts only applied / no_change (idempotent_replay is never stored)", () => {
    expect(AttemptCommandOutcomeSchema.parse("applied")).toBe("applied");
    expect(AttemptCommandOutcomeSchema.parse("no_change")).toBe("no_change");
    expect(() =>
      AttemptCommandOutcomeSchema.parse("idempotent_replay"),
    ).toThrow();
  });
});

describe("AttemptCommandDispositionSchema (wire)", () => {
  it("adds idempotent_replay to the persistent outcomes", () => {
    expect(AttemptCommandDispositionSchema.parse("applied")).toBe("applied");
    expect(AttemptCommandDispositionSchema.parse("no_change")).toBe(
      "no_change",
    );
    expect(AttemptCommandDispositionSchema.parse("idempotent_replay")).toBe(
      "idempotent_replay",
    );
  });
});

describe("ForceSubmitRequestPayloadSchema (canonical, durable)", () => {
  it("accepts a trimmed non-empty reason", () => {
    expect(ForceSubmitRequestPayloadSchema.parse({ reason: "x" })).toEqual({
      reason: "x",
    });
  });

  it("rejects a null reason — the durable identity never contains null", () => {
    expect(() =>
      ForceSubmitRequestPayloadSchema.parse({ reason: null }),
    ).toThrow();
    expect(() => ForceSubmitRequestPayloadSchema.parse({})).toThrow();
  });

  it("rejects a blank reason", () => {
    expect(() =>
      ForceSubmitRequestPayloadSchema.parse({ reason: "" }),
    ).toThrow();
    expect(() =>
      ForceSubmitRequestPayloadSchema.parse({ reason: "   " }),
    ).toThrow();
  });

  it("rejects a reason over 500 chars", () => {
    expect(() =>
      ForceSubmitRequestPayloadSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
    expect(
      ForceSubmitRequestPayloadSchema.parse({ reason: "x".repeat(500) }),
    ).toEqual({ reason: "x".repeat(500) });
  });

  it("rejects unknown fields (strict — never stripped into a canonical identity)", () => {
    expect(() =>
      ForceSubmitRequestPayloadSchema.parse({ reason: "x", unexpected: 1 }),
    ).toThrow();
  });
});

describe("MisconductMarkRequestPayloadSchema (canonical, durable)", () => {
  it("accepts severity + non-empty notes", () => {
    expect(
      MisconductMarkRequestPayloadSchema.parse({
        severity: "serious",
        notes: "n",
      }),
    ).toEqual({ severity: "serious", notes: "n" });
  });

  it("rejects unknown fields (strict)", () => {
    expect(() =>
      MisconductMarkRequestPayloadSchema.parse({
        severity: "warning",
        notes: "n",
        unexpected: 1,
      }),
    ).toThrow();
  });

  // ── Review J5-I1C0 PR #261 P1-2: canonical notes trim ──────────────
  // Without `.trim()`, a `notes: "  x  "` payload would persist with
  // surrounding whitespace while the wire request and the domain
  // canonicalizer both produced "x" — three representations of one
  // operation identity. The trim here makes the canonical receipt agree
  // with the other two layers.
  it("trims surrounding whitespace from notes (P1-2)", () => {
    expect(
      MisconductMarkRequestPayloadSchema.parse({
        severity: "warning",
        notes: "  x  ",
      }),
    ).toEqual({ severity: "warning", notes: "x" });
  });

  it("rejects whitespace-only notes after trim (P1-2)", () => {
    expect(() =>
      MisconductMarkRequestPayloadSchema.parse({
        severity: "warning",
        notes: "   ",
      }),
    ).toThrow();
  });
});

describe("ForceSubmitWithOperationRequestSchema", () => {
  it("requires a uuid operationId and a trimmed non-empty reason", () => {
    const parsed = ForceSubmitWithOperationRequestSchema.parse({
      operationId: OP,
      reason: "  trimmed  ",
    });
    expect(parsed).toEqual({ operationId: OP, reason: "trimmed" });
  });

  it("rejects a missing operationId", () => {
    expect(() =>
      ForceSubmitWithOperationRequestSchema.parse({ reason: "x" }),
    ).toThrow();
  });

  it("rejects a non-uuid operationId", () => {
    expect(() =>
      ForceSubmitWithOperationRequestSchema.parse({
        operationId: "not-a-uuid",
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects a whitespace-only reason (trim → empty)", () => {
    expect(() =>
      ForceSubmitWithOperationRequestSchema.parse({
        operationId: OP,
        reason: "   ",
      }),
    ).toThrow();
  });

  it("rejects a missing reason — the wire request requires it (J5-R0 §8.1)", () => {
    expect(() =>
      ForceSubmitWithOperationRequestSchema.parse({ operationId: OP }),
    ).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() =>
      ForceSubmitWithOperationRequestSchema.parse({
        operationId: OP,
        reason: "x",
        unexpected: 1,
      }),
    ).toThrow();
  });
});

describe("MisconductMarkWithOperationRequestSchema", () => {
  it("requires operationId + severity + trimmed non-empty notes", () => {
    const parsed = MisconductMarkWithOperationRequestSchema.parse({
      operationId: OP,
      severity: "warning",
      notes: "  notes  ",
    });
    expect(parsed).toEqual({
      operationId: OP,
      severity: "warning",
      notes: "notes",
    });
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      MisconductMarkWithOperationRequestSchema.parse({
        operationId: OP,
        severity: "critical",
        notes: "x",
      }),
    ).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() =>
      MisconductMarkWithOperationRequestSchema.parse({
        operationId: OP,
        severity: "warning",
        notes: "x",
        unexpected: 1,
      }),
    ).toThrow();
  });
});

describe("AttemptCommandReceiptResultPayloadSchema (frozen per-command facts)", () => {
  it("accepts the full force_submit committed fact (audit §4.2)", () => {
    expect(
      AttemptCommandReceiptResultPayloadSchema.parse(forceSubmitResultPayload),
    ).toEqual(forceSubmitResultPayload);
  });

  it("accepts the full misconduct_mark committed fact (audit §4.4)", () => {
    expect(
      AttemptCommandReceiptResultPayloadSchema.parse(misconductResultPayload),
    ).toEqual(misconductResultPayload);
  });

  it("accepts null attempt timestamps (no_change has no submittedAt/gradedAt)", () => {
    expect(
      AttemptCommandReceiptResultPayloadSchema.parse({
        ...forceSubmitResultPayload,
        submittedAt: null,
        gradedAt: null,
        afterStatus: "submitted" as const,
      }),
    ).toBeDefined();
  });

  it("rejects the previous envelope-only shape — the committed fact must be complete", () => {
    expect(() =>
      AttemptCommandReceiptResultPayloadSchema.parse({
        commandType: "force_submit",
        appliedAt: TS,
      }),
    ).toThrow();
    expect(() =>
      AttemptCommandReceiptResultPayloadSchema.parse({
        commandType: "misconduct_mark",
        appliedAt: TS,
      }),
    ).toThrow();
  });

  it("rejects unknown fields inside a result payload (strict)", () => {
    expect(() =>
      AttemptCommandReceiptResultPayloadSchema.parse({
        ...forceSubmitResultPayload,
        unexpected: 1,
      }),
    ).toThrow();
  });
});

describe("AttemptCommandReceiptRecordSchema", () => {
  const validRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    organizationId: "org-1",
    attemptId: "att-1",
    operationId: "44444444-4444-4444-8444-444444444444",
    commandType: "force_submit" as const,
    requestPayload: { reason: "x" },
    resultPayload: forceSubmitResultPayload,
    outcome: "applied" as const,
    actorId: "user-1",
    createdAt: TS,
  };

  it("accepts a valid receipt record", () => {
    expect(AttemptCommandReceiptRecordSchema.parse(validRecord)).toEqual(
      validRecord,
    );
  });

  it("rejects a record with an idempotent_replay outcome (never stored)", () => {
    expect(() =>
      AttemptCommandReceiptRecordSchema.parse({
        ...validRecord,
        outcome: "idempotent_replay",
      }),
    ).toThrow();
  });

  it("rejects a record whose requestPayload does not match the commandType", () => {
    expect(() =>
      AttemptCommandReceiptRecordSchema.parse({
        ...validRecord,
        commandType: "misconduct_mark",
        requestPayload: { reason: "x" },
      }),
    ).toThrow();
  });

  it("rejects a record with a null reason in the request payload", () => {
    expect(() =>
      AttemptCommandReceiptRecordSchema.parse({
        ...validRecord,
        requestPayload: { reason: null },
      }),
    ).toThrow();
  });

  it("rejects unknown record fields (strict)", () => {
    expect(() =>
      AttemptCommandReceiptRecordSchema.parse({ ...validRecord, extra: 1 }),
    ).toThrow();
  });
});

describe("AttemptCommandReceiptResponseSchema (wire)", () => {
  const base = {
    operationId: "55555555-5555-4555-8555-555555555555",
    commandType: "force_submit" as const,
    resultPayload: forceSubmitResultPayload,
    createdAt: TS,
  };

  it("accepts first-execution applied (disposition == outcome)", () => {
    const res = AttemptCommandReceiptResponseSchema.parse({
      ...base,
      disposition: "applied",
      outcome: "applied",
    });
    expect(res.disposition).toBe("applied");
  });

  it("accepts first-execution no_change (disposition == outcome)", () => {
    const res = AttemptCommandReceiptResponseSchema.parse({
      ...base,
      disposition: "no_change",
      outcome: "no_change",
    });
    expect(res.disposition).toBe("no_change");
  });

  it("accepts an idempotent_replay disposition with the original stored outcome", () => {
    const res = AttemptCommandReceiptResponseSchema.parse({
      ...base,
      disposition: "idempotent_replay",
      outcome: "applied",
    });
    expect(res.disposition).toBe("idempotent_replay");
    expect(res.outcome).toBe("applied");
  });

  it("rejects disposition=applied with outcome=no_change (inconsistent)", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        disposition: "applied",
        outcome: "no_change",
      }),
    ).toThrow();
  });

  it("rejects disposition=no_change with outcome=applied (inconsistent)", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        disposition: "no_change",
        outcome: "applied",
      }),
    ).toThrow();
  });

  it("rejects disposition=idempotent_replay with a non-persistent outcome", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        disposition: "idempotent_replay",
        outcome: "idempotent_replay",
      }),
    ).toThrow();
  });

  it("rejects unknown response fields (strict)", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        disposition: "applied",
        outcome: "applied",
        extra: 1,
      }),
    ).toThrow();
  });

  // ── outer/inner commandType consistency (P1-2) ────────────────────
  // The discriminator-by-disposition branches accept commandType and
  // resultPayload independently; the superRefine wrapper rejects a response
  // whose outer commandType and inner resultPayload.commandType disagree.

  it("rejects outer force_submit with an inner misconduct result payload", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        commandType: "force_submit" as const,
        disposition: "applied",
        outcome: "applied",
        resultPayload: misconductResultPayload,
      }),
    ).toThrow(/resultPayload\.commandType misconduct_mark does not match/);
  });

  it("rejects outer misconduct_mark with an inner force_submit result payload", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        commandType: "misconduct_mark" as const,
        resultPayload: forceSubmitResultPayload,
        disposition: "applied",
        outcome: "applied",
      }),
    ).toThrow(/resultPayload\.commandType force_submit does not match/);
  });

  it("rejects a command mismatch on the idempotent_replay branch too", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        commandType: "force_submit" as const,
        disposition: "idempotent_replay",
        outcome: "applied",
        resultPayload: misconductResultPayload,
      }),
    ).toThrow(/resultPayload\.commandType misconduct_mark does not match/);
  });

  it("rejects a command mismatch on the no_change branch too", () => {
    expect(() =>
      AttemptCommandReceiptResponseSchema.parse({
        ...base,
        commandType: "misconduct_mark" as const,
        resultPayload: forceSubmitResultPayload,
        disposition: "no_change",
        outcome: "no_change",
      }),
    ).toThrow(/resultPayload\.commandType force_submit does not match/);
  });
});
