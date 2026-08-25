/**
 * Strict destructive-rollback database-name guard tests
 * (review J5-I1C0 PR #261 P1-1).
 *
 * Freezes the exact allowlist and the counterexamples called out in the review:
 * `examproduction`, `precision_prod`, `incident_store`, `decision_db` must all
 * be REJECTED, even though the previous loose regex accepted them. Also covers
 * the canonical dev/test/e2e names, the vitest worker family, the CI family,
 * and the URL-parsing edge cases the two CLI entrypoints rely on.
 */

import { describe, expect, it } from "vitest";
import {
  isDestructiveRollbackTarget,
  isFullResetTarget,
  parseDatabaseName,
  refuseDbNameMessage,
  refuseFullResetMessage,
} from "./destructiveDbNameGuard.js";

describe("isDestructiveRollbackTarget — canonical allowlist", () => {
  it("accepts the three canonical dev/test/e2e names", () => {
    expect(isDestructiveRollbackTarget("exam")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_test")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_e2e")).toBe(true);
  });

  it("accepts the vitest worker-DB family (exam_test_w<N>, exam_e2e_w<N>)", () => {
    expect(isDestructiveRollbackTarget("exam_test_w0")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_test_w12")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_e2e_w3")).toBe(true);
  });

  it("accepts the CI family (exam_ci[_-]<suffix>)", () => {
    expect(isDestructiveRollbackTarget("exam_ci_pr261")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_ci-shard4")).toBe(true);
    expect(isDestructiveRollbackTarget("exam_ci_main")).toBe(true);
  });
});

describe("isDestructiveRollbackTarget — review counterexamples must reject", () => {
  // These names all PASSED the previous loose regex `/^(exam|.*e2e|.*test|.*ci)/i`
  // but must be REJECTED by the exact guard. Each is a real-world
  // false-accept that would have let a DROP TABLE/DROP INDEX reach a
  // non-test-shaped database.
  it("rejects examproduction (start-with-exam false positive)", () => {
    expect(isDestructiveRollbackTarget("examproduction")).toBe(false);
  });

  it("rejects precision_prod (contains-ci false positive)", () => {
    expect(isDestructiveRollbackTarget("precision_prod")).toBe(false);
  });

  it("rejects incident_store (contains-ci false positive)", () => {
    expect(isDestructiveRollbackTarget("incident_store")).toBe(false);
  });

  it("rejects decision_db (contains-ci false positive)", () => {
    expect(isDestructiveRollbackTarget("decision_db")).toBe(false);
  });

  it("rejects production_db (the existing production-shaped counterexample)", () => {
    expect(isDestructiveRollbackTarget("production_db")).toBe(false);
  });
});

describe("isDestructiveRollbackTarget — boundary / shape rejection", () => {
  it("rejects a bare exam_ci (no suffix — suffix is required)", () => {
    expect(isDestructiveRollbackTarget("exam_ci")).toBe(false);
  });

  it("rejects the worker pattern without the trailing digits", () => {
    expect(isDestructiveRollbackTarget("exam_test_w")).toBe(false);
    expect(isDestructiveRollbackTarget("exam_e2e_wXYZ")).toBe(false);
  });

  it("rejects empty / whitespace names", () => {
    expect(isDestructiveRollbackTarget("")).toBe(false);
    expect(isDestructiveRollbackTarget("   ")).toBe(false);
  });

  it("rejects names that merely start with the canonical prefix", () => {
    expect(isDestructiveRollbackTarget("exam_tests")).toBe(false);
    expect(isDestructiveRollbackTarget("exam_test_prod")).toBe(false);
  });

  it("rejects case-variant look-alikes (the allowlist is case-sensitive)", () => {
    expect(isDestructiveRollbackTarget("EXAM")).toBe(false);
    expect(isDestructiveRollbackTarget("Exam_Test")).toBe(false);
  });
});

describe("refuseDbNameMessage", () => {
  it("includes the rejected name and the allowed shapes in the guidance", () => {
    const msg = refuseDbNameMessage("examproduction");
    expect(msg).toContain('"examproduction"');
    expect(msg).toMatch(/exam_test/);
    expect(msg).toMatch(/exam_e2e/);
    expect(msg).toMatch(/exam_ci/);
  });
});

describe("isFullResetTarget — full-reset (truncate-all) allowlist", () => {
  it("accepts the canonical E2E database and its worker family", () => {
    expect(isFullResetTarget("exam_e2e")).toBe(true);
    expect(isFullResetTarget("exam_e2e_w0")).toBe(true);
    expect(isFullResetTarget("exam_e2e_w15")).toBe(true);
  });

  it("accepts the CI family", () => {
    expect(isFullResetTarget("exam_ci_pr261")).toBe(true);
    expect(isFullResetTarget("exam_ci-shard4")).toBe(true);
  });

  it("rejects the human dev database and the vitest databases", () => {
    // A full reset truncates EVERY business table; the dev DB holds the
    // human's demo data and exam_test* belongs to vitest — the E2E seed must
    // fail loudly rather than wipe either.
    expect(isFullResetTarget("exam")).toBe(false);
    expect(isFullResetTarget("exam_test")).toBe(false);
    expect(isFullResetTarget("exam_test_w0")).toBe(false);
  });

  it("rejects E2E forensic archives (_prior) — post-mortem artifacts are never execution state", () => {
    expect(isFullResetTarget("exam_e2e_w0_prior")).toBe(false);
    expect(isFullResetTarget("exam_e2e_prior")).toBe(false);
  });

  it("rejects look-alikes and empty names", () => {
    expect(isFullResetTarget("exam_e2e_evil")).toBe(false);
    expect(isFullResetTarget("exam_e2ew0")).toBe(false);
    expect(isFullResetTarget("EXAM_E2E")).toBe(false);
    expect(isFullResetTarget("")).toBe(false);
    expect(isFullResetTarget("exam_e2e_w0;DROP DATABASE x")).toBe(false);
  });

  it("is strictly narrower than the rollback allowlist", () => {
    for (const name of ["exam", "exam_test", "exam_test_w7"]) {
      expect(isDestructiveRollbackTarget(name)).toBe(true);
      expect(isFullResetTarget(name)).toBe(false);
    }
  });
});

describe("refuseFullResetMessage", () => {
  it("names the rejected database and why the narrow allowlist exists", () => {
    const msg = refuseFullResetMessage("exam");
    expect(msg).toContain('"exam"');
    expect(msg).toMatch(/exam_e2e/);
    expect(msg).toMatch(/forensic/i);
  });
});

describe("parseDatabaseName", () => {
  it("excludes query params (sslmode=require)", () => {
    expect(
      parseDatabaseName(
        "postgres://exam:exam@localhost:15432/exam_test?sslmode=require",
      ),
    ).toBe("exam_test");
  });

  it("handles a trailing slash", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_test/"),
    ).toBe("exam_test");
  });

  it("uses the final non-empty pathname segment", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/a/b/exam_test"),
    ).toBe("exam_test");
  });

  it("percent-decodes the database name", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_%74est"),
    ).toBe("exam_test");
  });

  it("returns an empty string when no path segment exists", () => {
    expect(parseDatabaseName("postgres://exam:exam@localhost:15432/")).toBe("");
  });

  it("throws on a malformed URL", () => {
    expect(() => parseDatabaseName("not a url")).toThrow();
  });

  it("throws on malformed percent-encoding (fail closed, no raw fallback)", () => {
    expect(() =>
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_%ZZ"),
    ).toThrow(/Malformed percent-encoding/);
  });
});
