/**
 * Attempt command receipt contract tests (J5-I1C Slice 1 / J5-I1C0 audit §7).
 *
 * Verifies the Zod schemas for the durable receipt foundation: enums, the
 * operationId-carrying request shapes (coexisting with the legacy schemas),
 * the persistent receipt record, and the wire response. These contracts are
 * NOT yet wired into any route (Slice 1 is backend-foundation only).
 */

import { describe, expect, it } from "vitest";
import {
  AttemptCommandOutcomeSchema,
  AttemptCommandReceiptRecordSchema,
  AttemptCommandReceiptResponseSchema,
  AttemptCommandDispositionSchema,
  AttemptCommandTypeSchema,
  ForceSubmitWithOperationRequestSchema,
  MisconductMarkWithOperationRequestSchema,
} from "./attempt.js";

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

describe("ForceSubmitWithOperationRequestSchema", () => {
  it("requires a uuid operationId and a trimmed non-empty reason", () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const parsed = ForceSubmitWithOperationRequestSchema.parse({
      operationId: opId,
      reason: "  trimmed  ",
    });
    expect(parsed).toEqual({ operationId: opId, reason: "trimmed" });
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
        operationId: "11111111-1111-4111-8111-111111111111",
        reason: "   ",
      }),
    ).toThrow();
  });
});

describe("MisconductMarkWithOperationRequestSchema", () => {
  it("requires operationId + severity + trimmed non-empty notes", () => {
    const opId = "22222222-2222-4222-8222-222222222222";
    const parsed = MisconductMarkWithOperationRequestSchema.parse({
      operationId: opId,
      severity: "warning",
      notes: "  notes  ",
    });
    expect(parsed).toEqual({
      operationId: opId,
      severity: "warning",
      notes: "notes",
    });
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      MisconductMarkWithOperationRequestSchema.parse({
        operationId: "22222222-2222-4222-8222-222222222222",
        severity: "critical",
        notes: "x",
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
    requestPayload: { reason: null },
    resultPayload: {
      commandType: "force_submit",
      appliedAt: "2026-01-01T00:00:00.000Z",
    },
    outcome: "applied" as const,
    actorId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
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
});

describe("AttemptCommandReceiptResponseSchema (wire)", () => {
  it("accepts an applied disposition with the persistent outcome", () => {
    const res = AttemptCommandReceiptResponseSchema.parse({
      operationId: "55555555-5555-4555-8555-555555555555",
      commandType: "force_submit",
      disposition: "applied",
      outcome: "applied",
      resultPayload: {
        commandType: "force_submit",
        appliedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(res.disposition).toBe("applied");
  });

  it("accepts an idempotent_replay disposition on the wire", () => {
    const res = AttemptCommandReceiptResponseSchema.parse({
      operationId: "55555555-5555-4555-8555-555555555555",
      commandType: "force_submit",
      disposition: "idempotent_replay",
      outcome: "applied",
      resultPayload: {
        commandType: "force_submit",
        appliedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(res.disposition).toBe("idempotent_replay");
    // outcome is still a persistent value (the original receipt's outcome).
    expect(res.outcome).toBe("applied");
  });
});
