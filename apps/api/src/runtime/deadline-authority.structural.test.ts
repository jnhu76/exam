import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Effective-deadline authority structural guardrail.
//
// BACKGROUND: the platform previously had TWO divergent "is this attempt
// expired?" authorities — a canonical `computeEffectiveDeadline` seam used by
// inline reconciliation, and a scanner discovery path that re-derived
// `deadlineAt <= now` (ignoring exam.closeAt) both in a DB query and an
// in-memory `selectExpiredAttempts`. The result: attempts whose exam window
// had closed but whose per-attempt deadline was still future were frozen by
// the inline path yet NEVER auto-submitted by the scanner.
//
// This guard locks the consolidated architecture in place so the divergence
// cannot silently regress:
//
//   computeEffectiveDeadline / isAttemptDeadlineExpired  (CANONICAL AUTHORITY)
//        |  defined in packages/exam-engine/src/timer.ts (the timing leaf) and
//        |  re-exported by deadlineReconciliation.ts for deep-import stability;
//        |  the structural test below pins the SINGLE definition site.
//        |
//        +-- inline reconciliation (ensureAttemptDeadlineReconciled)
//        |       AUTHORITATIVE
//        |
//        +-- scanner
//                |-- listDeadlineCandidates (DB)  DERIVED DISCOVERY PREDICATE
//                |       exact over the full scanner-eligible domain: the
//                |       reachable non-NULL deadlineAt domain PLUS the
//                |       defensive NULL domain (NULL => exam.closeAt, P0-C1
//                |       defensive recovery, NOT a Phase-1 timing mode);
//                |       OR-with-closeAt arm allowed ONLY here
//                +-- autoSubmitAndGrade (tx)
//                        Attempt FOR UPDATE -> Exam FOR UPDATE ->
//                        canonical isAttemptDeadlineExpired recheck ->
//                        submitAttempt iff expired
//
// REACHABILITY BOUNDARY (P0-C1): two separate invariants are guarded —
//   1. ordinary active-Attempt creation paths establish a non-null
//      deadlineAt (reachable-state safety invariant ACTIVE-DEADLINE-001);
//   2. the canonical deadline helper and scanner discovery AGREE on
//      defensive NULL fallback handling (robustness, not protocol semantics).
// These are NOT collapsed into "NULL is a valid protocol timing state".
//
// It scans SOURCE TEXT (not tests) and fails when:
//  (a) more than one `computeEffectiveDeadline` definition exists,
//  (b) the removed `selectExpiredAttempts` resurfaces,
//  (c) `autoSubmitAndGrade` no longer references the canonical recheck,
//  (d) the `deadlineAt <= now || closeAt <= now` style OR predicate appears
//      OUTSIDE the allowlisted discovery query (it is DERIVED, not authority).

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** Files whose source is scanned for deadline-authority invariants. */
const SCAN_DIRS = [
  "packages/exam-engine/src",
  "packages/db/src/repository",
  "apps/api/src",
];

function listTsFiles(dirRel: string): string[] {
  const dir = join(REPO_ROOT, dirRel);
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

describe("effective-deadline authority structural guard", () => {
  const allFiles = SCAN_DIRS.flatMap(listTsFiles);

  it("has exactly ONE `computeEffectiveDeadline` definition repo-wide", () => {
    const defs = allFiles.filter((f) =>
      /\bfunction\s+computeEffectiveDeadline\s*\(/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(defs).toHaveLength(1);
    // The canonical kernel lives in the timing leaf (timer.ts) so every
    // engine module — including attemptCommands, which must not import
    // deadlineReconciliation (cycle) — consumes the SAME definition.
    // deadlineReconciliation re-exports it; there is still one definition.
    expect(defs[0]).toBe(join(REPO_ROOT, "packages/exam-engine/src/timer.ts"));
  });

  it("defines `isAttemptDeadlineExpired` (the canonical expiry seam)", () => {
    const defs = allFiles.filter((f) =>
      /\bfunction\s+isAttemptDeadlineExpired\s*\(/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(defs).toHaveLength(1);
    expect(defs[0]).toBe(join(REPO_ROOT, "packages/exam-engine/src/timer.ts"));
  });

  it("does NOT reintroduce the removed in-memory `selectExpiredAttempts`", () => {
    // Removed: it was a third, competing semantic representation of "expired".
    // The DB query is discovery; the canonical seam is authority. No shim.
    const refs = allFiles.filter((f) =>
      /\bselectExpiredAttempts\b/.test(readFileSync(f, "utf8")),
    );
    expect(refs).toEqual([]);
  });

  it("does NOT reintroduce a `listExpirableByDeadline` method call or definition", () => {
    // The old name was retired in favor of listDeadlineCandidates (candidate-
    // discovery semantics, not authority). Historical mentions in doc comments
    // are fine; a real `.listExpirableByDeadline(` call or
    // `async listExpirableByDeadline(` definition is a regression.
    const refs = allFiles.filter((f) =>
      /(?:\.|async\s+)listExpirableByDeadline\s*\(/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(refs).toEqual([]);
  });

  it("autoSubmitAndGrade references the canonical `isAttemptDeadlineExpired` recheck", () => {
    const scanner = readSource("apps/api/src/plugins/deadlineScanner.ts");
    expect(scanner).toMatch(/\bautoSubmitAndGrade\b/);
    expect(scanner).toMatch(/\bisAttemptDeadlineExpired\b/);
    // And it locks the exam row before the recheck (serialization point).
    expect(scanner).toMatch(/findByIdForUpdate/);
  });

  it("the scanner must NOT make an authoritative expiry decision via a `closeAt <= now` comparison", () => {
    // The discovery OR-predicate (`deadlineAt <= now OR closeAt <= now`) lives
    // ONLY in the DB query (attemptRepo.listDeadlineCandidates). The scanner's
    // authoritative decision MUST go through isAttemptDeadlineExpired — it must
    // not re-derive `closeAt <= now` (or `closeAt < now`) as a decision.
    //
    // Scope: the scanner module's CODE only (comments stripped), because the
    // module legitimately documents the forbidden pattern. computeEffectiveDeadline
    // compares deadlineAt < closeAt (arithmetic), intentionally out of scope.
    const raw = readSource("apps/api/src/plugins/deadlineScanner.ts");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
      .replace(/^\s*\/\/.*$/gm, ""); // line comments
    const closeAtNowDecision =
      /closeAt\b[\s\S]{0,40}(?:<=|<)\s*[\s\S]{0,20}now|(?:<=|<)\s*[\s\S]{0,20}closeAt\b/.test(
        codeOnly,
      );
    expect(closeAtNowDecision).toBe(false);
  });
});
