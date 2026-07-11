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

  // UI-MIGRATE-N-W4A: the ExamTimer text-[11px] baseline entry was removed after
  // the node migrated to the type-metadata recipe. This probe proves the removal
  // is EARNED — a reintroduced arbitrary typography value in ExamTimer is now a
  // real, unshielded error (nothing in the baseline grandfather list protects
  // it anymore).
  it("reports a reintroduced arbitrary-typography value in ExamTimer (W4A)", async () => {
    __resetBaselineCacheForTests();
    const { readFileSync, writeFileSync } = await import("node:fs");
    const timerPath = join(WEB_ROOT, "src/components/exam/ExamTimer.tsx");
    const original = readFileSync(timerPath, "utf8");
    try {
      // Reintroduce the exact retired arbitrary value.
      writeFileSync(
        timerPath,
        original.replace(
          "type-metadata leading-none",
          "text-[11px] font-medium leading-none",
        ),
      );
      const results = await eslint.lintFiles([timerPath]);
      const typErrors = results
        .flatMap((r) => r.messages)
        .filter((m) => m.ruleId === "exam-ui/no-arbitrary-typography");
      expect(typErrors.length).toBeGreaterThan(0);
    } finally {
      writeFileSync(timerPath, original);
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
