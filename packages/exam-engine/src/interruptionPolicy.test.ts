import { describe, expect, it } from "vitest";
import { ValidationError } from "@exam/domain";
import {
  BOUNDED_GRACE_REASON,
  OPERATOR_INCIDENT_ZERO_GRANT_REASON,
  STRICT_ZERO_GRANT_REASON,
  evaluateInterruptionTimePolicy,
  resolveAttemptTimingPolicySnapshot,
} from "./interruptionPolicy.js";

const detectedAt = new Date("2025-01-01T10:00:00Z");
const beforeDeadline = new Date("2025-01-01T11:00:00Z");
const examCloseAt = new Date("2025-01-01T12:00:00Z");

describe("resolveAttemptTimingPolicySnapshot", () => {
  it("omitted policy + omitted caps → strict/null/null", () => {
    expect(resolveAttemptTimingPolicySnapshot({})).toEqual({
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("explicit strict with null caps → strict", () => {
    expect(
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "strict",
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("operator_incident with null caps → operator_incident", () => {
    expect(
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "operator_incident",
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "operator_incident",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("bounded_grace with valid ordered caps → carries both", () => {
    expect(
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: 300,
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "bounded_grace",
      perIncidentCapSeconds: 120,
      perAttemptAggregateCapSeconds: 300,
    });
  });

  it("unknown policy → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        // @ts-expect-error intentional unknown policy
        interruptionTimePolicy: "no_policy",
      }),
    ).toThrow(ValidationError);
  });

  it("strict with any cap present → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: 60,
      }),
    ).toThrow(ValidationError);
  });

  it("operator_incident with caps → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "operator_incident",
        interruptionGracePerAttemptSeconds: 60,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace missing caps → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 60,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace non-positive caps → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 0,
        interruptionGracePerAttemptSeconds: 60,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace non-integer caps → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 60.5,
        interruptionGracePerAttemptSeconds: 120,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace perIncident > perAttempt → fails closed", () => {
    expect(() =>
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 300,
        interruptionGracePerAttemptSeconds: 120,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace equal caps → allowed (boundary)", () => {
    expect(
      resolveAttemptTimingPolicySnapshot({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: 120,
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "bounded_grace",
      perIncidentCapSeconds: 120,
      perAttemptAggregateCapSeconds: 120,
    });
  });
});

describe("evaluateInterruptionTimePolicy", () => {
  const strictSnapshot = {
    schemaVersion: 1 as const,
    policy: "strict" as const,
    perIncidentCapSeconds: null,
    perAttemptAggregateCapSeconds: null,
  };
  const operatorSnapshot = {
    schemaVersion: 1 as const,
    policy: "operator_incident" as const,
    perIncidentCapSeconds: null,
    perAttemptAggregateCapSeconds: null,
  };
  const boundedSnapshot = (incident: number, attempt: number) => ({
    schemaVersion: 1 as const,
    policy: "bounded_grace" as const,
    perIncidentCapSeconds: incident,
    perAttemptAggregateCapSeconds: attempt,
  });

  it("strict → zero grant, deadline unchanged", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: strictSnapshot,
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.addedSeconds).toBe(0);
    expect(decision.eligibleSeconds).toBe(0);
    expect(decision.afterDeadline).toEqual(beforeDeadline);
    expect(decision.reasonCode).toBe(STRICT_ZERO_GRANT_REASON);
  });

  it("operator_incident → zero grant, deadline unchanged", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: operatorSnapshot,
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.addedSeconds).toBe(0);
    expect(decision.afterDeadline).toEqual(beforeDeadline);
    expect(decision.reasonCode).toBe(OPERATOR_INCIDENT_ZERO_GRANT_REASON);
  });

  it("strict snapshot with caps present → fails closed", () => {
    expect(() =>
      evaluateInterruptionTimePolicy({
        snapshot: {
          schemaVersion: 1,
          policy: "strict",
          perIncidentCapSeconds: 60,
          perAttemptAggregateCapSeconds: null,
        },
        detectedAt,
        decisionNow: new Date("2025-01-01T10:30:00Z"),
        beforeDeadline,
        examCloseAt,
        priorBoundedGraceAddedSeconds: 0,
      }),
    ).toThrow(ValidationError);
  });

  it("bounded_grace grants exact eligible duration when under all caps", () => {
    // 30 minutes elapsed → 1800s eligible; caps 3600/7200; close room 3600s.
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.eligibleSeconds).toBe(1800);
    expect(decision.addedSeconds).toBe(1800);
    expect(decision.afterDeadline).toEqual(new Date("2025-01-01T11:30:00Z"));
    expect(decision.reasonCode).toBe(BOUNDED_GRACE_REASON);
  });

  it("per-incident cap clamps the grant", () => {
    // 30 min eligible (1800s), per-incident cap 600s wins.
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.eligibleSeconds).toBe(1800);
    expect(decision.addedSeconds).toBe(600);
  });

  it("remaining aggregate cap clamps the grant", () => {
    // 30 min eligible (1800s), per-incident 3600, aggregate 7200, prior 6600
    // → remaining = 600s wins.
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 6600,
    });
    expect(decision.addedSeconds).toBe(600);
  });

  it("zero aggregate remaining → zero grant", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 7200,
    });
    expect(decision.eligibleSeconds).toBe(1800);
    expect(decision.addedSeconds).toBe(0);
  });

  it("close-room cap clamps the grant", () => {
    // beforeDeadline 11:00, closeAt 11:05 → close room 300s wins over 1800s.
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline,
      examCloseAt: new Date("2025-01-01T11:05:00Z"),
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.addedSeconds).toBe(300);
    expect(decision.afterDeadline).toEqual(new Date("2025-01-01T11:05:00Z"));
  });

  it("zero close room → zero grant", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline: examCloseAt,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.addedSeconds).toBe(0);
  });

  it("all four caps simultaneously — min wins", () => {
    // eligible 1800, incident 600, remaining 300, closeRoom 120 → 120 wins.
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:30:00Z"),
      beforeDeadline: new Date("2025-01-01T11:58:00Z"),
      examCloseAt: new Date("2025-01-01T12:00:00Z"),
      priorBoundedGraceAddedSeconds: 6900,
    });
    expect(decision.addedSeconds).toBe(120);
  });

  it("decisionNow before detectedAt → 0 eligible (defensive, not error)", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt: new Date("2025-01-01T10:30:00Z"),
      decisionNow: new Date("2025-01-01T10:00:00Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.eligibleSeconds).toBe(0);
    expect(decision.addedSeconds).toBe(0);
  });

  it("sub-second eligible duration floors to 0", () => {
    const decision = evaluateInterruptionTimePolicy({
      snapshot: boundedSnapshot(3600, 7200),
      detectedAt,
      decisionNow: new Date("2025-01-01T10:00:00.500Z"),
      beforeDeadline,
      examCloseAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    expect(decision.eligibleSeconds).toBe(0);
    expect(decision.addedSeconds).toBe(0);
  });

  it("null beforeDeadline for active bounded → fails closed", () => {
    expect(() =>
      evaluateInterruptionTimePolicy({
        snapshot: boundedSnapshot(3600, 7200),
        detectedAt,
        decisionNow: new Date("2025-01-01T10:30:00Z"),
        beforeDeadline: null,
        examCloseAt,
        priorBoundedGraceAddedSeconds: 0,
      }),
    ).toThrow(ValidationError);
  });

  it("invalid bounded snapshot (null caps) → fails closed", () => {
    expect(() =>
      evaluateInterruptionTimePolicy({
        snapshot: {
          schemaVersion: 1,
          policy: "bounded_grace",
          perIncidentCapSeconds: null,
          perAttemptAggregateCapSeconds: null,
        },
        detectedAt,
        decisionNow: new Date("2025-01-01T10:30:00Z"),
        beforeDeadline,
        examCloseAt,
        priorBoundedGraceAddedSeconds: 0,
      }),
    ).toThrow(ValidationError);
  });
});
