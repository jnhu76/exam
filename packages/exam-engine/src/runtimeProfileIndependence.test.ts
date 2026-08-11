import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P7-M2 §42 — runtime profile independence proof (structural).
//
// Profiles are AUTHORING resources only. The hard M2 rule: runtime must NEVER
// load a profile to execute a Published Exam (attempt start, answer save,
// heartbeat, deadline scanner, interruption recovery, grading, result
// publication, candidate view, submission — all live in this package).
//
// This test scans every runtime execution module (non-test source) for any
// import whose specifier mentions "profile". The profile repository lives in
// `@exam/db` (which this package does not even declare as a dependency), and
// the profile domain module is never imported here — so a profile import in
// this package would be both a dependency-boundary and an authority-model
// violation. The engine's only external dependency is `@exam/domain`.

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

describe("P7-M2 runtime profile independence (§42)", () => {
  it("no runtime execution module imports a profile module", async () => {
    const files = (await readdir(SRC_DIR)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(join(SRC_DIR, file), "utf8");
      for (const line of text.split("\n")) {
        // Import specifier containing "profile" (covers examProfile,
        // examProfileRepo, profileRepo, ...).
        if (/^import\b.*from\s+["'][^"']*profile[^"']*["']/i.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
