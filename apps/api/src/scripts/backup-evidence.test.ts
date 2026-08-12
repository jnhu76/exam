import { describe, expect, it } from "vitest";
import { decideEvidenceDbAccess } from "./backup-evidence.js";

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
