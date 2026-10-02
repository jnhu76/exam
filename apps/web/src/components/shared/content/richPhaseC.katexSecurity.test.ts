/**
 * Phase-C Campaign L (#669) — real rendering security evidence (C9 evidence
 * gap). Exercises the REAL production static math seam
 * (`katexRenderToHtml` — the same renderToString seam ContentDocumentRenderer
 * uses through MathRenderer/KatexHtmlRenderer) with an adversarial corpus.
 *
 * Frozen obligations (contract §15): inert and bounded — no active HTML,
 * source preserved on malformed input, bounded expansion/resource usage.
 * Phase C produces counterexamples or "no counterexample within the bounded
 * campaign"; Phase E owns final proof.
 */

import { describe, expect, it } from "vitest";
import { katexRenderToHtml } from "./katexRender";
import { CONTENT_LIMITS } from "@exam/domain";

const ACTIVE_CONTENT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "script tag", pattern: /<script/i },
  { name: "iframe tag", pattern: /<iframe/i },
  { name: "object/embed tag", pattern: /<(object|embed)\b/i },
  { name: "img tag", pattern: /<img\b/i },
  { name: "anchor tag", pattern: /<a\b/i },
  { name: "javascript: URL", pattern: /javascript:/i },
  { name: "inline event handler", pattern: /\son[a-z]+\s*=/i },
  // KaTeX emits its own sizing style="" attributes (inert by construction);
  // flag only attacker-influenced style content.
  {
    name: "active style content",
    pattern:
      /style\s*=\s*"[^"]*(url\(|expression\(|javascript:|position\s*:\s*fixed)/i,
  },
  { name: "form/input tag", pattern: /<(form|input|button)\b/i },
  { name: "meta/link tag", pattern: /<(meta|link)\b/i },
];

interface CaseResult {
  name: string;
  ranKatex: boolean;
  elapsedMs: number;
  outputLength: number;
  sourceVisible: boolean | null;
  activePatterns: string[];
}

/**
 * sourceExpectation:
 *   "error-render"  — malformed input: KaTeX's red error rendering must keep
 *                     the complete escaped source visible (§15 fail-safe).
 *   "command-token" — trust-gated or undefined command: KaTeX's error rendering
 *                     shows the failing command token; observed Phase-C
 *                     behavior is that PARSED ARGUMENTS ARE DROPPED from the
 *                     visible output (recorded as a fidelity finding, not
 *                     asserted as required behavior).
 *   "rendered"      — valid input: commands are consumed by design; only
 *                     inertness and boundedness are asserted.
 */
type SourceExpectation = "error-render" | "command-token" | "rendered";

const CORPUS: Array<{
  name: string;
  latex: string;
  displayMode: boolean;
  source: SourceExpectation;
  token?: string;
}> = [
  {
    name: "valid control",
    latex: "\\frac{1}{2}",
    displayMode: false,
    source: "rendered",
  },
  {
    name: "valid display control",
    latex: "\\sum_{i=1}^{n} i",
    displayMode: true,
    source: "rendered",
  },
  {
    name: "malformed brace",
    latex: "\\frac{1}{",
    displayMode: false,
    source: "error-render",
  },
  {
    name: "malformed command",
    latex: "\\notacommand{\\maybe}",
    displayMode: false,
    source: "command-token",
    token: "\\notacommand",
  },
  {
    name: "truncated superscript",
    latex: "x^",
    displayMode: false,
    source: "error-render",
  },
  {
    name: "href (trust-gated)",
    latex: "\\href{javascript:alert(1)}{click}",
    displayMode: false,
    source: "command-token",
    token: "\\href",
  },
  {
    name: "includegraphics (trust-gated)",
    latex: "\\includegraphics{http://evil.example/x.png}",
    displayMode: false,
    source: "command-token",
    token: "\\includegraphics",
  },
  {
    name: "url-like text",
    latex: "\\text{http://example.com/?a=1&b=2}",
    displayMode: false,
    source: "rendered",
  },
  {
    name: "html-like command (trust-gated)",
    latex: "\\htmlClass{cls}{x}",
    displayMode: false,
    source: "command-token",
    token: "\\htmlClass",
  },
  {
    name: "htmlId command (trust-gated)",
    latex: "\\htmlId{a}{b}",
    displayMode: false,
    source: "command-token",
    token: "\\htmlId",
  },
  {
    name: "style-ish command (trust-gated)",
    latex: "\\htmlStyle{color:red}{x}",
    displayMode: false,
    source: "command-token",
    token: "\\htmlStyle",
  },
  {
    name: "data attribute command (trust-gated)",
    latex: "\\htmlData{a=1}{x}",
    displayMode: false,
    source: "command-token",
    token: "\\htmlData",
  },
  {
    name: "input-like command",
    latex: "\\input{file}",
    displayMode: false,
    source: "command-token",
    token: "\\input",
  },
  {
    name: "write-like command",
    latex: "\\write18{rm -rf}",
    displayMode: false,
    source: "command-token",
    token: "\\write",
  },
  {
    name: "unicode CJK",
    latex: "中文公式x^2",
    displayMode: false,
    source: "rendered",
  },
  {
    name: "unicode astral",
    latex: "👍^2",
    displayMode: false,
    source: "rendered",
  },
  {
    name: "self-referential macro (bounded expansion)",
    latex: "\\def\\x{\\x}\\x",
    displayMode: false,
    source: "error-render",
  },
  {
    name: "expansion-heavy nested macro",
    latex: "\\def\\a{\\a\\a}\\a",
    displayMode: false,
    source: "error-render",
  },
  {
    name: "deep fraction nesting",
    latex: "\\frac{\\frac{\\frac{\\frac{1}{2}}{3}}{4}}{5}",
    displayMode: false,
    source: "rendered",
  },
  {
    name: "latex at size limit",
    latex: `x^{${"1".repeat(CONTENT_LIMITS.latex - 6)}}`,
    displayMode: true,
    source: "rendered",
  },
];

describe("Phase-C Campaign L — real KaTeX static seam security evidence", () => {
  const results: CaseResult[] = [];

  it.each(CORPUS.map((c) => [c.name, c] as const))(
    "case: %s",
    (_name, testCase) => {
      const started = performance.now();
      const html = katexRenderToHtml(testCase.latex, testCase.displayMode);
      const elapsedMs = performance.now() - started;
      const sourceVisible =
        testCase.source === "error-render"
          ? html.includes(escapeProbe(testCase.latex))
          : testCase.source === "command-token"
            ? html.includes(escapeProbe(testCase.token ?? ""))
            : null;
      const result: CaseResult = {
        name: testCase.name,
        ranKatex: html.includes("katex"),
        elapsedMs,
        outputLength: html.length,
        sourceVisible,
        activePatterns: ACTIVE_CONTENT_PATTERNS.filter(({ pattern }) =>
          pattern.test(html),
        ).map(({ name }) => name),
      };
      results.push(result);
      expect(result.ranKatex).toBe(true);
      // Inertness: no active content pattern may appear in real output.
      expect(result.activePatterns).toEqual([]);
      // Bounded per-case work (Phase-C hostile case budget: ≤ 1 s).
      expect(result.elapsedMs).toBeLessThan(1000);
      if (testCase.source !== "rendered") {
        expect(result.sourceVisible).toBe(true);
      }
    },
    1500,
  );

  it("campaign summary: corpus completed with bounded resource usage", () => {
    expect(results.length).toBe(CORPUS.length);
    const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);
    expect({ cases: results.length, totalMs }).toEqual({
      cases: CORPUS.length,
      totalMs: expect.any(Number),
    });
  });
});

/** KaTeX error output HTML-escapes the source; compare against the escaped form. */
function escapeProbe(latex: string): string {
  return latex
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
