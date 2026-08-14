import { describe, expect, it } from "vitest";
import {
  decideEvidenceDbAccess,
  validateRetentionSuccessInvariant,
  validateAutomatedDrillDurationInvariant,
} from "./backup-evidence.js";

const base = {
  appMode: "development",
  urlDatabaseName: "exam",
  allowUnsafeTestDb: false,
};

describe("decideEvidenceDbAccess (connected-DB identity guard)", () => {
  it("allows a production-named database without flagging a bypass", () => {
    expect(decideEvidenceDbAccess({ ...base, connectedDb: "exam" })).toEqual({
      allowed: true,
      bypassed: false,
    });
  });

  it("fails closed on a test-like name (e2e) without the opt-in", () => {
    const d = decideEvidenceDbAccess({ ...base, connectedDb: "exam_e2e" });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toContain("exam_e2e");
      expect(d.reason).toContain("ALLOW_UNSAFE_EVIDENCE_TEST_DB");
    }
  });

  it("fails closed on every test-like substring (test / e2e / ci)", () => {
    for (const db of ["exam_test", "exam_e2e", "exam_ci", "ci_run"]) {
      const d = decideEvidenceDbAccess({ ...base, connectedDb: db });
      expect(d.allowed, `db=${db}`).toBe(false);
    }
  });

  it("allows a test-like database WITH the opt-in, flagged as bypassed", () => {
    expect(
      decideEvidenceDbAccess({
        ...base,
        connectedDb: "exam_e2e",
        allowUnsafeTestDb: true,
      }),
    ).toEqual({ allowed: true, bypassed: true });
  });

  it("does NOT bypass when the connected identity is unreadable, even with the opt-in", () => {
    const d = decideEvidenceDbAccess({
      ...base,
      connectedDb: undefined,
      allowUnsafeTestDb: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toContain("could not determine");
  });

  it("the opt-in never upgrades a production-named database to bypassed", () => {
    expect(
      decideEvidenceDbAccess({
        ...base,
        connectedDb: "exam",
        allowUnsafeTestDb: true,
      }),
    ).toEqual({ allowed: true, bypassed: false });
  });
});

describe("validateRetentionSuccessInvariant (success ↔ verified)", () => {
  it("accepts succeeded + verified", () => {
    expect(
      validateRetentionSuccessInvariant({
        result: "succeeded",
        verificationStatus: "verified",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects succeeded with NO verification flag (the gap that used to record a fake success)", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: null,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("--verification-status verified");
  });

  it("rejects succeeded + failed verification (the contradictory shape)", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: "failed",
    });
    expect(d.ok).toBe(false);
  });

  it("rejects succeeded + pending verification", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: "pending",
    });
    expect(d.ok).toBe(false);
  });

  it("accepts failed with any/no verification (failed needs no verified evidence)", () => {
    for (const verificationStatus of ["failed", "pending", null] as const) {
      expect(
        validateRetentionSuccessInvariant({
          result: "failed",
          verificationStatus,
        }),
      ).toEqual({ ok: true });
    }
  });
});

describe("validateAutomatedDrillDurationInvariant (automated success → duration)", () => {
  it("rejects an automated succeeded drill with no duration (RTO would be unmeasurable)", () => {
    const d = validateAutomatedDrillDurationInvariant({
      source: "automated",
      result: "succeeded",
      durationMs: undefined,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("--duration-ms");
  });

  it("accepts an automated succeeded drill WITH a duration", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "automated",
        result: "succeeded",
        durationMs: 42_000,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts an automated FAILED drill with no duration (failures carry no restore duration)", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "automated",
        result: "failed",
        durationMs: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts an operator-declared success with no duration (declared success is not RTO proof)", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "operator_declared",
        result: "succeeded",
        durationMs: undefined,
      }),
    ).toEqual({ ok: true });
  });
});
