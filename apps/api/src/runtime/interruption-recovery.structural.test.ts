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

// REC-I4-I3A: public contract + authoring surface structural guards.
// These lock in the frozen restore response contract, the no-leak boundary,
// attempt-snapshot immutability, and the Exam authoring surface.
describe("REC-I4-I3A contract + authoring structural guards", () => {
  const engineFiles = listTsFiles(ENGINE_SRC);

  it("restore route returns RestoreAttemptResponseSchema (frozen contract)", () => {
    const src = readSource(join(API_SRC, "routes/attempts.candidate.ts"));
    expect(src).toMatch(/RestoreAttemptResponseSchema/);
    // The restore response schema is referenced as the 200 response. Extract
    // the restore route registration block (from the route path to the end of
    // the plugin function) and assert the 200 schema wiring.
    const routeIdx = src.indexOf('"/attempts/:attemptId/restore"');
    expect(routeIdx).toBeGreaterThan(-1);
    const restoreBlock = src.slice(routeIdx);
    expect(restoreBlock).toMatch(/200:\s*RestoreAttemptResponseSchema/);
  });

  it("restore route projects compensation.policy + addedSeconds only (no evidence leak)", () => {
    const src = readSource(join(API_SRC, "routes/attempts.candidate.ts"));
    const routeIdx = src.indexOf('"/attempts/:attemptId/restore"');
    expect(routeIdx).toBeGreaterThan(-1);
    const restoreBlock = src.slice(routeIdx);
    // The candidate-facing projection exposes only policy + addedSeconds.
    expect(restoreBlock).toMatch(/compensation\.policy/);
    expect(restoreBlock).toMatch(/compensation\.addedSeconds/);
    // Internal evidence must NOT be projected into the response.
    expect(restoreBlock).not.toMatch(/compensation\.interruptionId/);
    expect(restoreBlock).not.toMatch(/compensation\.adjustmentId/);
    expect(restoreBlock).not.toMatch(/compensation\.eligibleSeconds/);
  });

  it("RestoreAttemptResponseSchema omits internal interruption evidence fields", () => {
    const src = readSource("packages/contracts/src/attempt.ts");
    const restoreSchemaBlock = src.slice(
      src.indexOf("RestoreAttemptResponseSchema"),
    );
    // The compensation object is now a named RestoreCompensationSchema
    // with a superRefine. Verify the schema structure still enforces the
    // no-leak invariant by scanning the RestoreCompensationSchema definition.
    const compensationSchemaBlock = src.slice(
      src.indexOf("RestoreCompensationSchema = z"),
      src.indexOf("RestoreAttemptResponseSchema = z"),
    );
    // The schema must contain the policy + addedSeconds field definitions.
    expect(compensationSchemaBlock).toMatch(/\bpolicy:/);
    expect(compensationSchemaBlock).toMatch(/\baddedSeconds:/);
    // Internal identifiers must not appear in the schema fields.
    expect(compensationSchemaBlock).not.toMatch(/interruptionId/);
    expect(compensationSchemaBlock).not.toMatch(/adjustmentId/);
    expect(compensationSchemaBlock).not.toMatch(/eligibleSeconds/);
    expect(compensationSchemaBlock).not.toMatch(/reasonCode/);
  });

  it("attempt timing-policy snapshot is never mutated after creation", () => {
    // The snapshot is set only in startOrRestoreAttempt's create call. No
    // attemptRepo.update() payload in the engine may carry snapshot keys.
    const snapshotKeys = [
      "interruptionTimingPolicySnapshot",
      "interruptionPolicySnapshotVersion",
    ];
    const violations: string[] = [];
    for (const f of engineFiles) {
      if (!f.includes("attemptCommands") && !f.includes("restoreInterruption"))
        continue;
      const src = readFileSync(f, "utf8");
      // Find every attemptRepo.update / attempts.update call and inspect its
      // object-literal payload for snapshot keys.
      const updateCallRe =
        /(?:attemptRepo|attempts)\.update\([^;]*?\{([^}]*?)\}/gs;
      let match: RegExpExecArray | null;
      while ((match = updateCallRe.exec(src)) !== null) {
        const payload = match[1]!;
        for (const key of snapshotKeys) {
          if (payload.includes(key)) {
            violations.push(`${f}: update payload contains ${key}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Exam create/update contracts expose interruption policy authoring fields", () => {
    const src = readSource("packages/contracts/src/exam.ts");
    // Create + update base schemas carry the authoring fields.
    expect(src).toMatch(
      /interruptionTimePolicy:\s*InterruptionTimePolicySchema/,
    );
    expect(src).toMatch(
      /interruptionGracePerIncidentSeconds:\s*z\.number\(\)\.int\(\)\.positive\(\)\.nullish\(\)/,
    );
    expect(src).toMatch(
      /interruptionGracePerAttemptSeconds:\s*z\.number\(\)\.int\(\)\.positive\(\)\.nullish\(\)/,
    );
    // The ExamSchema DTO exposes the resolved policy + nullable caps.
    expect(src).toMatch(
      /interruptionGracePerIncidentSeconds:\s*z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)/,
    );
  });

  it("exam create/update routes normalize interruption policy (ADR-013 cross-field)", () => {
    const src = readSource(join(API_SRC, "routes/exam.ts"));
    expect(src).toMatch(/normalizeInterruptionPolicyConfiguration/);
    // The response serializer exposes the resolved policy fields.
    expect(src).toMatch(
      /interruptionTimePolicy:\s*exam\.interruptionTimePolicy/,
    );
  });

  it("no production code reintroduces legacy full-gap restoreAttempt", () => {
    // Broader than the I2 guard (which scans engine + api production files):
    // scans production .ts across engine, api, contracts, db, and domain, and
    // rejects any re-introduction of a bare restoreAttempt function definition
    // or disconnectedDuration compensation logic (excluding this guard file
    // itself, which legitimately names the patterns).
    const guardFile = fileURLToPath(import.meta.url);
    const dirsToScan = [
      ENGINE_SRC,
      API_SRC,
      "packages/contracts/src",
      "packages/db/src",
      "packages/domain/src",
    ];
    const violations: string[] = [];
    for (const dir of dirsToScan) {
      for (const f of listTsFiles(dir)) {
        if (f === guardFile) continue;
        const src = readFileSync(f, "utf8");
        // A function DEFINITION of the legacy coupled restore (not the new
        // restoreAttemptState / restoreInterruptedAttempt).
        if (/\bfunction\s+restoreAttempt\b/.test(src)) {
          violations.push(`${f}: defines legacy restoreAttempt`);
        }
        if (/disconnectedDuration/.test(src)) {
          violations.push(`${f}: uses disconnectedDuration`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
