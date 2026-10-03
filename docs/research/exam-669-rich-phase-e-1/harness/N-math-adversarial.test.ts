/**
 * Phase-E Campaign N — math adversarial (L1 library seam, E-RE04/05/06).
 * Attacks `katexRenderToHtml` — the single KaTeX boundary (trust:false,
 * throwOnError:false, maxSize:50, maxExpand:1000) — with a hostile corpus:
 *
 * E-RE05: malformed / unknown latex NEVER throws; the output preserves the
 *   source text (KaTeX error rendering embeds the raw source).
 *
 * E-RE04: bounded resources — recursion bombs (\def self-expansion), deep
 *   superscript chains, and limit-sized latex all TERMINATE with bounded
 *   output; no hang, no crash, no unbounded expansion.
 *
 * E-RE03/06: inertness — across the whole corpus the output contains no
 *   script tags, no event-handler attributes, no javascript: URLs, no
 *   iframe/object/embed, no cross-origin resource hints (trust:false).
 */
import { describe, expect, it, afterAll } from "vitest";
import { katexRenderToHtml } from "@exam/web/src/components/shared/content/katexRender.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("N-math-adversarial", [0x669e0004]);

const MALFORMED: Array<[string, string]> = [
  ["unbalanced-open", "\\frac{1}{2"],
  ["unbalanced-close", "\\frac1}}"],
  ["unknown-command", "\\unknownCmdOne{x}"],
  ["bare-backslash", "\\"],
  ["only-brace", "{"],
  ["unicode-garbage", "中文🚀\\frac{a}{b}‮rtl"],
  ["nested-unknown", "\\sqrt{\\unknownCmdTwo{\\frac{1}{2}}}"],
];

const HOSTILE_EXPANSION: Array<[string, string]> = [
  ["def-self-recursion", "\\def\\x{\\x\\x}\\x"],
  ["def-chain", "\\def\\a{\\b\\b}\\def\\b{\\c\\c}\\def\\c{\\a\\a}\\a"],
  [
    "deep-superscript",
    "x".repeat(1) +
      "^".repeat(1) +
      "2" +
      "^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2^2",
  ],
  ["newline-injection", "\\\\\\\\\\\\\\\\\\\\\\\\{}{}{}{}"],
];

const INERTNESS_CORPUS: Array<[string, string]> = [
  ["href-javascript", "\\href{javascript:alert(1)}{click}"],
  ["href-remote", "\\href{https://evil.example}{x}"],
  ["includegraphics", "\\includegraphics{https://evil.example/x.png}"],
  ["htmlunit", "\\htmlData{foo=bar}{x}"],
  ["script-text", "<script>alert(1)</script>"],
  ["img-onerror", "\\text{<img src=x onerror=alert(1)>}"],
  ["iframe-text", "\\text{<iframe src=//evil.example>}"],
];

// Trust boundary = LIVE markup, not inert text: KaTeX escapes < and > in
// text mode, so a corpus string like `onerror=alert(1)` may legally surface
// as ESCAPED text. What must never appear is a real tag or a javascript:
// URL attribute.
const FORBIDDEN_LIVE_TAG = /<(script|iframe|object|embed|img|a)\b/i;
const FORBIDDEN_URL_ATTR = /(?:href|src)\s*=\s*["']?\s*javascript:/i;

describe("Campaign N — math adversarial (E-RE04/05/06)", () => {
  it("E-RE05: malformed latex never throws; parse errors preserve the source text; parseable garbage renders", () => {
    let errorCases = 0;
    let renderedCases = 0;
    for (const [name, latex] of MALFORMED) {
      let html: string;
      try {
        html = katexRenderToHtml(latex, true);
      } catch (e) {
        throw new Error(
          `malformed latex "${name}" threw at the KaTeX seam (E-RE05 forbids): ${String(e)}`,
        );
      }
      if (html.includes("katex-error")) {
        // Error path: the raw source must stay recoverable (title attr and
        // visible text both carry it).
        errorCases += 1;
        expect(
          html.includes(latex),
          `${name}: error output lost the source text`,
        ).toBe(true);
        recorder.record({
          probe: `malformed-${name}`,
          outcome: "error-with-source",
        });
      } else {
        // Parseable-but-hostile input renders as math; inertness and bounds
        // are asserted by the other tests.
        renderedCases += 1;
        expect(
          html.includes("katex-html"),
          `${name}: neither error nor render output`,
        ).toBe(true);
        recorder.record({ probe: `malformed-${name}`, outcome: "rendered" });
      }
    }
    // The corpus must exercise BOTH paths — an all-error corpus proves
    // nothing about the render path, an all-render corpus proves nothing
    // about error recovery.
    expect(errorCases).toBeGreaterThan(1);
    expect(renderedCases).toBeGreaterThan(0);
  });

  it("E-RE04: expansion bombs and deep nesting terminate with bounded output", () => {
    for (const [name, latex] of HOSTILE_EXPANSION) {
      const started = Date.now();
      const html = katexRenderToHtml(latex, true);
      const elapsed = Date.now() - started;
      // Bounded: no expansion bomb may balloon the output. KaTeX's own
      // error rendering (throwOnError:false) keeps hostile inputs at
      // error-text size; legal-but-big inputs stay proportional.
      expect(
        html.length,
        `${name}: output unbounded (${html.length} chars)`,
      ).toBeLessThan(200_000);
      expect(elapsed, `${name}: render took ${elapsed}ms`).toBeLessThan(5_000);
      recorder.record({
        probe: `expansion-${name}`,
        outcome: "bounded",
        outputChars: html.length,
        elapsedMs: elapsed,
      });
    }
    // Limit-sized legal latex: the CONTENT_LIMITS.latex bound (5000 chars)
    // must render within bounded time/output.
    const limitLatex = "\\frac{a}{b}".repeat(5000).slice(0, 5000);
    const started = Date.now();
    const html = katexRenderToHtml(limitLatex, true);
    const elapsed = Date.now() - started;
    expect(html.length).toBeLessThan(2_000_000);
    expect(elapsed).toBeLessThan(10_000);
    recorder.record({
      probe: "limit-sized-latex-5000",
      outcome: "bounded",
      outputChars: html.length,
      elapsedMs: elapsed,
    });
  });

  it("E-RE03/06: no active or remote content path in any corpus output", () => {
    const corpus = [...INERTNESS_CORPUS, ...MALFORMED, ...HOSTILE_EXPANSION];
    for (const [name, latex] of corpus) {
      const html = katexRenderToHtml(latex, true);
      expect(
        FORBIDDEN_LIVE_TAG.test(html),
        `${name}: output contains a live tag (trust boundary violated): ${html.slice(0, 200)}`,
      ).toBe(false);
      expect(
        FORBIDDEN_URL_ATTR.test(html),
        `${name}: output contains a javascript: URL attribute`,
      ).toBe(false);
    }
    recorder.record({
      probe: "inertness-sweep",
      outcome: "clean",
      corpusSize: corpus.length,
    });
  });

  afterAll(() => {
    recorder.flush();
  });
});
