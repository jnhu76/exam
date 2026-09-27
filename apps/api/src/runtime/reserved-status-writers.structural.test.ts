import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// EXSEM-019 / ADR-021 `RESERVED_VOCABULARY_POLICY =
// READ_COMPATIBILITY_ALLOWED; NO_IMPLICIT_WRITER_OR_ACTIVATION` — narrow
// structural conformance guard.
//
// The attempt statuses `not_started` / `queued` / `voided` and the enrollment
// status `blocked` are reserved vocabulary: schema-representable and
// read-tolerated, but NO production writer may emit them (there is no
// `voidAttempt` command and no writer flips an attempt or enrollment into a
// reserved state). Runtime tests pin read-side tolerance; only a structural
// scan can pin the absence of a writer.
//
// Style mirrors apps/api/src/runtime/answer-protocol-ownership.structural.test.ts.
// It stays deliberately narrow: two leakage shapes —
//   1. a `voidAttempt` command identifier anywhere in production code;
//   2. an object-literal/update-payload `status:` write of a reserved value.
// Test infrastructure (fixtures, cleanup, worker databases) is out of scope.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const SCAN_ROOTS = [
  resolve(REPO_ROOT, "apps/api/src"),
  resolve(REPO_ROOT, "packages/exam-engine/src"),
  resolve(REPO_ROOT, "packages/db/src"),
];

/** Test-only modules that legitimately fabricate/clean reserved states. */
const TEST_INFRA = [
  /\.test\.ts$/,
  /\.test-support\.ts$/,
  /\/testCleanup\.ts$/,
  /\/testDb\.ts$/,
  /\/testIsolation\.ts$/,
  /\/testInfraLock\.ts$/,
  /\/testWorkerDatabase\.ts$/,
  /\/e2eReset\.ts$/,
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") && !TEST_INFRA.some((r) => r.test(full))) {
      files.push(full);
    }
  }
  return files;
}

/** Strips comments so only executable code is scanned. */
function stripComments(line: string): string {
  const jsdocEndOrOpen = new RegExp("^\\s*\\*\\/|^\\s*\\/\\*");
  const jsdocCloseOnly = new RegExp("^\\s*\\*\\/$");
  if (jsdocEndOrOpen.test(line) || jsdocCloseOnly.test(line)) {
    return "";
  }
  if (new RegExp("^\\s*\\*\\s").test(line)) {
    return "";
  }
  const inline = line.match(/^([^"'/]*)\/\/.*$/);
  if (inline) {
    return inline[1] ?? "";
  }
  return line;
}

const RESERVED_STATUS_WRITE =
  /status\s*:\s*["'](voided|queued|not_started|blocked)["']/;

describe("EXSEM-019 — reserved statuses have no production writer", () => {
  const productionFiles = SCAN_ROOTS.flatMap((root) => {
    try {
      return collectSourceFiles(root);
    } catch {
      return [];
    }
  });

  it("scans a non-empty production surface", () => {
    expect(productionFiles.length).toBeGreaterThan(100);
  });

  it("no voidAttempt command exists in production code", () => {
    const hits: string[] = [];
    for (const file of productionFiles) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (/\bvoidAttempt\b/.test(stripComments(line))) {
          hits.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("no production write assigns a reserved attempt/enrollment status", () => {
    const hits: string[] = [];
    for (const file of productionFiles) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (RESERVED_STATUS_WRITE.test(stripComments(line))) {
          hits.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("read-side tolerance remains: the domain enum still carries the reserved statuses", () => {
    // Positive counter-lock: reserved vocabulary stays READ-compatible. If the
    // enum were pruned instead of merely unwritten, this fails.
    const enums = readFileSync(
      resolve(REPO_ROOT, "packages/domain/src/enums.ts"),
      "utf8",
    );
    expect(enums).toMatch(/Voided: "voided"/);
    expect(enums).toMatch(/Queued: "queued"/);
    expect(enums).toMatch(/NotStarted: "not_started"/);
  });
});
