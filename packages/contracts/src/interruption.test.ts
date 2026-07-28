import { describe, expect, it } from "vitest";
import {
  AttemptTimingPolicySnapshotSchema,
  InterruptionDetectionSourceSchema,
  InterruptionEventTypeSchema,
  InterruptionTimePolicySchema,
  TimeAdjustmentSourceSchema,
  normalizeInterruptionPolicyConfiguration,
} from "./interruption.js";

describe("interruption policy contracts", () => {
  it("accepts exactly the three frozen policies", () => {
    expect(InterruptionTimePolicySchema.options).toEqual([
      "strict",
      "bounded_grace",
      "operator_incident",
    ]);
  });

  it("normalizes omitted configuration to strict with null caps", () => {
    expect(normalizeInterruptionPolicyConfiguration({})).toEqual({
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it.each(["strict", "operator_incident"] as const)(
    "requires null caps for %s",
    (policy) => {
      expect(
        normalizeInterruptionPolicyConfiguration({
          policy,
          perIncidentCapSeconds: null,
          perAttemptAggregateCapSeconds: null,
        }),
      ).toEqual({
        policy,
        perIncidentCapSeconds: null,
        perAttemptAggregateCapSeconds: null,
      });
      expect(() =>
        normalizeInterruptionPolicyConfiguration({
          policy,
          perIncidentCapSeconds: 1,
          perAttemptAggregateCapSeconds: null,
        }),
      ).toThrow();
    },
  );

  it("requires positive bounded caps ordered per incident then aggregate", () => {
    expect(
      normalizeInterruptionPolicyConfiguration({
        policy: "bounded_grace",
        perIncidentCapSeconds: 60,
        perAttemptAggregateCapSeconds: 180,
      }),
    ).toEqual({
      policy: "bounded_grace",
      perIncidentCapSeconds: 60,
      perAttemptAggregateCapSeconds: 180,
    });

    for (const input of [
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: null,
        perAttemptAggregateCapSeconds: 180,
      },
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: 0,
        perAttemptAggregateCapSeconds: 180,
      },
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: -1,
        perAttemptAggregateCapSeconds: 180,
      },
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: 60.5,
        perAttemptAggregateCapSeconds: 180,
      },
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: 181,
        perAttemptAggregateCapSeconds: 180,
      },
      {
        policy: "bounded_grace" as const,
        perIncidentCapSeconds: 60,
        perAttemptAggregateCapSeconds: 2_147_483_648,
      },
    ]) {
      expect(() => normalizeInterruptionPolicyConfiguration(input)).toThrow();
    }
  });

  it("accepts only snapshot schema version 1", () => {
    const valid = {
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    };
    expect(AttemptTimingPolicySnapshotSchema.parse(valid)).toEqual(valid);
    expect(
      AttemptTimingPolicySnapshotSchema.safeParse({
        ...valid,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("exports the frozen event and source vocabularies", () => {
    expect(InterruptionEventTypeSchema.options).toEqual([
      "detected",
      "restored",
      "terminalized",
    ]);
    expect(InterruptionDetectionSourceSchema.options).toEqual([
      "heartbeat_timeout",
      "migration_backfill",
    ]);
    expect(TimeAdjustmentSourceSchema.options).toEqual([
      "bounded_grace",
      "operator",
      "system_incident",
      "administrative_correction",
    ]);
  });
});
