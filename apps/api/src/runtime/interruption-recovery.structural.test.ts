import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

function listTsFiles(dirRel: string): string[] {
  const dir = join(REPO_ROOT, dirRel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(join(dirRel, entry.name)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

const ENGINE_SRC = "packages/exam-engine/src";
const API_SRC = "apps/api/src";
const MIGRATION = "packages/db/migrations/postgres/0022_engine_policy_seam.sql";

describe("REC-I4-I2 interruption recovery structural guards", () => {
  const engineFiles = listTsFiles(ENGINE_SRC);
  const apiFiles = listTsFiles(API_SRC);
  const allProdFiles = [...engineFiles, ...apiFiles];

  it("legacy restoreAttempt function does not exist in production code", () => {
    const violations: string[] = [];
    for (const f of allProdFiles) {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const code = stripComments(lines[i]!);
        if (
          /\brestoreAttempt\b/.test(code) &&
          !/\brestoreInterruptedAttempt\b/.test(code)
        ) {
          violations.push(`${f}:${i + 1}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("full-gap arithmetic (disconnectedDuration) does not exist", () => {
    const violations: string[] = [];
    for (const f of allProdFiles) {
      const src = readFileSync(f, "utf8");
      if (/disconnectedDuration/.test(src)) {
        violations.push(f);
      }
    }
    expect(violations).toEqual([]);
  });

  it("submitAttempt resolution parameter is NOT optional", () => {
    const src = readSource(join(ENGINE_SRC, "attemptCommands.ts"));
    expect(src).not.toMatch(/resolution\?\s*:/);
    expect(src).not.toMatch(/resolution\s*=\s*undefined/);
  });

  it("ensureAttemptDeadlineReconciled resolution parameter is NOT optional", () => {
    const src = readSource(join(ENGINE_SRC, "deadlineReconciliation.ts"));
    const fnMatch = src.match(
      /export async function ensureAttemptDeadlineReconciled\([^)]*\)/s,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/resolution\?\s*:/);
  });

  it("/start route does not have optional restore-repo bypass", () => {
    const startFiles = apiFiles.filter(
      (f) => f.includes("attempts.candidate") || f.includes("attempts/start"),
    );
    for (const f of startFiles) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/restoreRepo\?\s*:/);
      expect(src).not.toMatch(/restoreRepo\s*=\s*undefined/);
      expect(src).not.toMatch(/"restoreRepo"\s+in\s+opts/);
    }
  });

  it("deadline scanner passes interruption resolution to submitAttempt", () => {
    const src = readSource(join(API_SRC, "plugins/deadlineScanner.ts"));
    expect(src).toMatch(/resolution/);
    expect(src).toMatch(/mode:\s*"active_interruption"/);
    expect(src).toMatch(/mode:\s*"none"/);
  });

  it("restoreInterruptedAttempt calls assertCapabilityFor", () => {
    const src = readSource(join(ENGINE_SRC, "restoreInterruption.ts"));
    expect(src).toMatch(/assertCapabilityFor\(/);
  });

  it("restoreInterruptedAttempt validates parent + detected + interruptedAt identity", () => {
    const src = readSource(join(ENGINE_SRC, "restoreInterruption.ts"));
    expect(src).toMatch(/episode not found|episode.*null/i);
    expect(src).toMatch(/detected.*not match|detected.*null/i);
    expect(src).toMatch(/interruptedAt/i);
  });

  it("normal restore inserts restored outcome event", () => {
    const src = readSource(join(ENGINE_SRC, "restoreInterruption.ts"));
    expect(src).toMatch(/eventType:\s*"restored"/);
  });

  it("heartbeat scanner uses verified heartbeatTimeoutSeconds (not Math.floor(ms/1000))", () => {
    const heartbeatSrc = readSource(join(API_SRC, "plugins/heartbeat.ts"));
    expect(heartbeatSrc).toMatch(/heartbeatTimeoutSeconds/);
    const violations: string[] = [];
    for (const f of apiFiles) {
      if (f.includes("heartbeat") || f.includes("deadlineScanner")) {
        const src = readFileSync(f, "utf8");
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const code = stripComments(lines[i]!);
          if (
            /Math\.floor\(\s*heartbeatTimeoutMs\s*\/\s*1000\s*\)/.test(code)
          ) {
            violations.push(`${f}:${i + 1}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("migration 0022 duplicate-detected validation groups by interruption_id", () => {
    const src = readSource(MIGRATION);
    expect(src).toMatch(/GROUP BY\s+"interruption_id"/);
    expect(src).not.toMatch(/GROUP BY\s+"attempt_id"\s*\n\s*HAVING\s+COUNT/i);
  });

  it("migration 0022 stale pointer resolution writes outcome events (not just clears pointer)", () => {
    const src = readSource(MIGRATION);
    expect(src).toMatch(/INSERT INTO "attempt_interruption_events"/);
    expect(src).toMatch(/'restored'/);
    expect(src).toMatch(/'terminalized'/);
  });
});
