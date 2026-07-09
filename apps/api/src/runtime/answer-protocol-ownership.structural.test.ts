import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// EXAM-ANSWER-CLOSURE-0 — narrow structural ownership regression guard.
//
// The Save Answer protocol action is CLOSED: the candidate save route delegates
// the full action (load → reconstruct AnswerState → decide → apply → persist)
// to the canonical exam-engine `saveAnswer` composite, and no longer owns
// persisted-state reconstruction, AnswerState/clientSeqMap construction, or the
// `attempt.answers` write.
//
// This is a STRUCTURAL test scoped to the known Save Answer route file. It is
// deliberately narrow (per EXAM-ANSWER-CLOSURE-0 §15): it targets the three
// known leakage shapes that would indicate the split ownership returned —
//
//   1. a direct `processSaveAnswer(` call in the route (the pure core must be
//      reached only through `saveAnswer`),
//   2. a `buildClientSeqMap(` call in the route (clientSeq reconstruction is
//      engine-internal),
//   3. a direct repo `.update(` whose payload writes the draft `answers:` field
//      (the route must not write attempt.answers itself; disambiguated from
//      `submittedAnswers:` by word boundary).
//
// It does NOT build a general Semgrep program, a repo-wide "no answers writes
// anywhere" rule, or a mutation of check-architecture.mjs. Legitimate
// AnswerRegion writers live in the engine (answerProtocol.ts).
//
// Style mirrors apps/api/src/runtime/gradingArchitecture.structural.test.ts.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** The candidate attempt routes file — the sole Save Answer production route. */
const ROUTE_FILE = resolve(
  REPO_ROOT,
  "apps/api/src/routes/attempts.candidate.ts",
);

/**
 * Strips comments from a line so structural scans only inspect executable code.
 * Documentation references to deprecated patterns are legitimate and must not
 * register as violations. Mirrors gradingArchitecture.structural.test.ts.
 */
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

describe("EXAM-ANSWER-CLOSURE-0 — Save Answer route delegates to the canonical engine action", () => {
  const routeText = readFileSync(ROUTE_FILE, "utf8");
  const routeLines = routeText.split(/\r?\n/);

  it("the canonical saveAnswer composite is defined in exam-engine", () => {
    // The composite action must exist in answerProtocol.ts. This anchors the
    // closure: if `saveAnswer` is removed or renamed, this test fails first
    // with a clear signal.
    const engineFile = resolve(
      REPO_ROOT,
      "packages/exam-engine/src/answerProtocol.ts",
    );
    const text = readFileSync(engineFile, "utf8");
    expect(text).toMatch(/export\s+async\s+function\s+saveAnswer\s*\(/);
  });

  it("the Save Answer route imports and delegates to saveAnswer (not processSaveAnswer)", () => {
    // Positive lock: the route must import the canonical composite action.
    expect(routeText).toMatch(/\bsaveAnswer\b/);
    expect(routeText).toMatch(/saveAnswer\s*\(/);
  });

  it("the Save Answer route does NOT call processSaveAnswer directly", () => {
    // The pure decision core must be reached only through `saveAnswer`. A direct
    // `processSaveAnswer(` call in the route is the canonical leakage shape.
    const hits = routeLines
      .map((line, i) => ({ line: i + 1, code: stripComments(line) }))
      .filter((h) => /processSaveAnswer\s*\(/.test(h.code));
    expect(hits).toEqual([]);
  });

  it("the Save Answer route does NOT build the clientSeqMap (engine-internal reconstruction)", () => {
    const hits = routeLines
      .map((line, i) => ({ line: i + 1, code: stripComments(line) }))
      .filter((h) => /buildClientSeqMap\s*\(/.test(h.code));
    expect(hits).toEqual([]);
  });

  it("the Save Answer route does NOT construct AnswerState directly", () => {
    // AnswerState is the engine-internal protocol state object. The route must
    // not hand-construct it. (answerState as a variable name is permitted; the
    // leaked shape was the object literal `{ attemptStatus, answers, clientSeqMap,
    // deadlineAt, now }` passed into processSaveAnswer, already blocked above by
    // the processSaveAnswer ban. This guards the named type/field set directly.)
    const hits = routeLines
      .map((line, i) => ({ line: i + 1, code: stripComments(line) }))
      .filter((h) => /\bAnswerState\b/.test(h.code));
    expect(hits).toEqual([]);
  });

  it("the Save Answer route does NOT write the draft answers field directly", () => {
    // The route must not call `.update(` with a payload containing the draft
    // `answers:` field (word-bounded so `submittedAnswers:` is NOT matched).
    // Walk each `.update(` call forward to its depth-balanced close and inspect
    // the payload for the leaked field name.
    const violations: { line: number; snippet: string }[] = [];
    for (let i = 0; i < routeLines.length; i++) {
      const code = stripComments(routeLines[i]!);
      if (!code.trim()) continue;
      if (!/\.\bupdate\s*\(/.test(code)) continue;
      // Collect payload lines from the call until depth-balanced close.
      let depth = 0;
      let seenOpen = false;
      const payload: string[] = [];
      for (let j = i; j < routeLines.length; j++) {
        const c = stripComments(routeLines[j]!);
        for (const ch of c) {
          if (ch === "(") {
            depth++;
            seenOpen = true;
          } else if (ch === ")") depth--;
        }
        payload.push(c);
        if (seenOpen && depth <= 0) break;
      }
      const payloadText = payload.join("\n");
      // `\banswers\s*:` matches the draft field but NOT `submittedAnswers:`.
      if (/\banswers\s*:/.test(payloadText)) {
        violations.push({
          line: i + 1,
          snippet: routeLines[i]!.trim(),
        });
      }
    }
    expect(violations).toEqual([]);
  });
});
