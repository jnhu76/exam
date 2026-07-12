/**
 * Baseline / grandfathering behavior tests.
 *
 * These verify the deterministic-debt contract:
 *   - an accepted existing violation (in baseline.json) is NOT reported;
 *   - a NEW equivalent violation (in a file not in the baseline, or with a
 *     different token signature) IS reported.
 *
 * We use the real ESLint API with the project flat config so the test also
 * exercises config wiring (plugin registration, file scoping).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ESLint } from "eslint";
import { join } from "node:path";
import {
  signature,
  isGrandfathered,
  __resetBaselineCacheForTests,
} from "../../baseline";

// vitest runs with cwd = the @exam/web package root (apps/web).
const WEB_ROOT = process.cwd();

describe("baseline signature + grandfather lookup", () => {
  it("signature is order-independent and dedupes tokens", () => {
    const a = signature("apps/web/src/pages/x.tsx", ["shadow-sm"]);
    const b = signature("apps/web/src/pages/x.tsx", ["shadow-sm", "shadow-sm"]);
    expect(a).toBe(b);
    expect(a).toBe("apps/web/src/pages/x.tsx::shadow-sm");
  });

  it("accepts ruleId with or without exam-ui/ prefix", () => {
    __resetBaselineCacheForTests();
    // DashboardPage shadow-sm is in the baseline for no-business-shadow.
    const sig = signature("apps/web/src/pages/admin/DashboardPage.tsx", [
      "shadow-sm",
    ]);
    expect(isGrandfathered("no-business-shadow", sig)).toBe(true);
    expect(isGrandfathered("exam-ui/no-business-shadow", sig)).toBe(true);
  });

  it("rejects a new file not in the baseline", () => {
    __resetBaselineCacheForTests();
    const sig = signature("apps/web/src/pages/admin/BrandNewPage.tsx", [
      "shadow-sm",
    ]);
    expect(isGrandfathered("no-business-shadow", sig)).toBe(false);
  });

  it("rejects a new token set in a listed file", () => {
    __resetBaselineCacheForTests();
    // DashboardPage is listed with shadow-sm; a shadow-lg there is a NEW violation.
    const sig = signature("apps/web/src/pages/admin/DashboardPage.tsx", [
      "shadow-lg",
    ]);
    expect(isGrandfathered("no-business-shadow", sig)).toBe(false);
  });
});

describe("ESLint config wiring (scope + grandfathering)", () => {
  let eslint: ESLint;

  beforeEach(async () => {
    __resetBaselineCacheForTests();
    eslint = new ESLint({
      cwd: WEB_ROOT,
      // ESLint v10 is flat-config-only; use the project eslint.config.ts.
      overrideConfigFile: "eslint.config.ts",
    });
  });

  it("grandfathers an existing shadow-sm violation (DashboardPage)", async () => {
    __resetBaselineCacheForTests();
    const results = await eslint.lintFiles([
      "src/pages/admin/DashboardPage.tsx",
    ]);
    const shadowErrors = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === "exam-ui/no-business-shadow");
    expect(shadowErrors).toHaveLength(0);
  });

  it("ExamTimer is free of arbitrary-typography violations (W4A closure)", async () => {
    // UI-MIGRATE-N-W4A migrated the ExamTimer label from text-[11px] to the
    // type-metadata recipe and removed the baseline entry. The file is now
    // clean under exam-ui/no-arbitrary-typography unconditionally — no
    // grandfathering is involved. This test pins that closure: a regression
    // that reintroduces an arbitrary typography value here would surface as a
    // real error (no baseline shields it anymore).
    __resetBaselineCacheForTests();
    const results = await eslint.lintFiles([
      "src/components/exam/ExamTimer.tsx",
    ]);
    const typErrors = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === "exam-ui/no-arbitrary-typography");
    expect(typErrors).toHaveLength(0);
  });

  it("does NOT lint components/ui (generated primitives excluded)", async () => {
    __resetBaselineCacheForTests();
    const results = await eslint.lintFiles(["src/components/ui/table.tsx"]);
    const errors = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId?.startsWith("exam-ui/"));
    expect(errors).toHaveLength(0);
  });

  it("reports a NEW shadow-sm violation in a previously-clean file", async () => {
    __resetBaselineCacheForTests();
    const { writeFileSync, rmSync } = await import("node:fs");
    // Place the probe inside the business scope glob (src/pages/**) so it is
    // actually linted, and use a filename NOT in the baseline.
    const probeClean = join(WEB_ROOT, "src/pages/__probe_shadow_clean.tsx");
    writeFileSync(
      probeClean,
      'export const X = () => <div className="shadow-sm">probe</div>;\n',
    );
    try {
      const results = await eslint.lintFiles([probeClean]);
      const shadowErrors = results
        .flatMap((r) => r.messages)
        .filter((m) => m.ruleId === "exam-ui/no-business-shadow");
      expect(shadowErrors.length).toBeGreaterThan(0);
    } finally {
      rmSync(probeClean, { force: true });
    }
  });

  // UI-TYPOGRAPHY-AUTHORITY-RECON-1 §13/§19: the no-arbitrary-typography
  // baseline is empty (the former ExamTimer text-[11px] entry was removed in
  // W4A). This proves a reintroduced arbitrary-typography value is a REAL,
  // UNSHIELDED error — using an ISOLATED fixture inside the business scope glob
  // (so it is actually linted) whose filename is NOT in the baseline. Unlike the
  // prior W4A probe this does NOT rewrite the real ExamTimer.tsx, so a future
  // legitimate className change there cannot break this test.
  it("reports a reintroduced arbitrary-typography value (isolated fixture, no baseline shield)", async () => {
    __resetBaselineCacheForTests();
    const { writeFileSync, rmSync } = await import("node:fs");
    const probe = join(WEB_ROOT, "src/pages/__probe_arbitrary_typography.tsx");
    writeFileSync(
      probe,
      'export const X = () => <div className="text-[11px] font-medium">probe</div>;\n',
    );
    try {
      const results = await eslint.lintFiles([probe]);
      const typErrors = results
        .flatMap((r) => r.messages)
        .filter((m) => m.ruleId === "exam-ui/no-arbitrary-typography");
      expect(typErrors.length).toBeGreaterThan(0);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  // UI-TYPOGRAPHY-AUTHORITY-RECON-1 §19 — baseline truth. The three typography
  // rules (no-arbitrary-typography, no-arbitrary-inline-typography,
  // no-typography-authority-conflict) all have ZERO baseline entries: every
  // current conflict was closed in C5, and no debt was concealed. The shadow
  // baseline is byte-identical (7 entries, untouched).
  it("has ZERO baseline entries for all three typography rules", async () => {
    const baseline = (await import("../../baseline.json")).default as Record<
      string,
      unknown
    >;
    expect(baseline["exam-ui/no-arbitrary-typography"] ?? []).toHaveLength(0);
    expect(
      baseline["exam-ui/no-arbitrary-inline-typography"] ?? [],
    ).toHaveLength(0);
    expect(
      baseline["exam-ui/no-typography-authority-conflict"] ?? [],
    ).toHaveLength(0);
  });

  it("keeps the no-business-shadow baseline at exactly 7 entries (byte-identical)", async () => {
    const baseline = (await import("../../baseline.json")).default as Record<
      string,
      string[]
    >;
    const shadow = baseline["exam-ui/no-business-shadow"];
    expect(shadow).toHaveLength(7);
    // The 7 grandfathered files (UI-LINT-1 debt, untouched by RECON-1).
    expect(shadow).toEqual([
      "apps/web/src/pages/admin/DashboardPage.tsx::shadow-sm",
      "apps/web/src/pages/admin/ExamDetailPage.tsx::shadow-sm",
      "apps/web/src/pages/admin/ProctorDashboardPage.tsx::shadow-sm",
      "apps/web/src/pages/admin/ScoreListPage.tsx::shadow-sm",
      "apps/web/src/pages/admin/SystemDiagnosticsPage.tsx::shadow-sm",
      "apps/web/src/pages/exam/ExamListPage.tsx::shadow-sm",
      "apps/web/src/pages/exam/TakeExamPage.tsx::shadow-sm",
    ]);
  });

  it("reports a NEW recipe-authority-conflict (no baseline shields it)", async () => {
    __resetBaselineCacheForTests();
    const { writeFileSync, rmSync } = await import("node:fs");
    const probe = join(WEB_ROOT, "src/pages/__probe_recipe_conflict.tsx");
    writeFileSync(
      probe,
      'export const X = () => <div className="type-metadata leading-none">probe</div>;\n',
    );
    try {
      const results = await eslint.lintFiles([probe]);
      const conflictErrors = results
        .flatMap((r) => r.messages)
        .filter((m) => m.ruleId === "exam-ui/no-typography-authority-conflict");
      expect(conflictErrors.length).toBeGreaterThan(0);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  // The no-raw-typography and no-raw-surface-recipe grandfathering + new-violation
  // tests were removed in UI-MIGRATE-N-W3 §14: both rules were retired (see
  // index.ts and docs/frontend/P3-UI-MIGRATE-N-W3-typography-surface-closure.md).
  // After the proven same-role migrations, every remaining hit was
  // false-semantic-overlap and no sound NARROW AST boundary existed — the same
  // unsoundness that retired prefer-field-error. The baseline arrays for those
  // rules were removed alongside the rules.
});
