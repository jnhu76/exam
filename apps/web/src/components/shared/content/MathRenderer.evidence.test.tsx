import { render, waitFor } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { tiptapToContentDocument } from "@/components/shared/content/contentAdapter";
import type { ContentBlock, ContentDocumentV1 } from "@exam/domain";
import { resolvePersistedQuestionDocument } from "@exam/contracts";
import { describe, expect, it } from "vitest";
import { ContentRenderer } from "./ContentRenderer";
import { katexRenderToHtml } from "./katexRender";
import { MathRenderer } from "./MathRenderer";

/**
 * Permanent executable evidence for the math rendering authority (#669
 * Phase D5-B; rich-content-semantic-contract.md §15; ADR-019 decision 6).
 *
 * Characterization is EMPIRICAL against the pinned KaTeX (0.18.4) with the
 * exact production options (`throwOnError: false, trust: false,
 * strict: "ignore", output: "html", maxSize: 50, maxExpand: 1000`) — no
 * remembered defaults. The authority-level invariants under proof:
 *
 *   inert      — user latex can never create an active/remote content path
 *   bounded    — expansion and dimensions fail/cap within explicit bounds
 *   preserved  — malformed source stays recoverable/visible; the persisted
 *                latex source is the semantic value, KaTeX output is only a
 *                projection (render errors never replace stored source)
 *
 * PC-F08 (Phase-C fidelity observation) is reproduced here and classified:
 * EXPECTED_KATEX_POLICY — a syntactically valid but trust-disallowed command
 * degrades the visual projection (command token stays as inert text,
 * arguments are not faithfully represented). Source evidence remains, no
 * active content is possible, and the frozen authority (§3.1) does not
 * promise exact rendered fidelity — so this is not a semantic defect.
 *
 * Layer note: browser-level "no network fetch" cannot be proven in jsdom —
 * that property carries browser evidence in apps/e2e (rich-content.spec.ts,
 * D5B adversarial-math test).
 */

/** Elements that must never exist in KaTeX output for any user latex. */
const ACTIVE_SELECTORS =
  "script, iframe, frame, frameset, object, embed, applet, base, link, meta, form, img, video, audio, source, a";

/** Parses an HTML string and asserts no active/remote content capability. */
function assertInertHtml(html: string): void {
  const dom = new DOMParser().parseFromString(html, "text/html");
  expect(
    dom.querySelectorAll(ACTIVE_SELECTORS),
    "KaTeX output must not contain active/remote elements",
  ).toHaveLength(0);
  for (const el of Array.from(dom.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(
        /^on/i.test(attr.name),
        `event-handler attribute ${attr.name}`,
      ).toBe(false);
      expect(
        /javascript:/i.test(attr.value),
        `javascript: URL in ${attr.name}`,
      ).toBe(false);
    }
  }
}

describe("katexRenderToHtml (production options, pinned KaTeX 0.18.4)", () => {
  // M1 — ordinary valid math renders structured output.
  it("D5B M1: normal inline and block math render structured KaTeX output", () => {
    for (const latex of ["x^2 + y^2", "\\frac{a}{b}", "\\sum_{i=1}^{n} i"]) {
      const html = katexRenderToHtml(latex, false);
      expect(html).toContain("katex");
      const dom = new DOMParser().parseFromString(html, "text/html");
      expect(dom.querySelector(".katex")).not.toBeNull();
      assertInertHtml(html);
    }
  });

  // M2 — malformed syntax: no crash, source evidence preserved, never empty.
  it("D5B M2/R3: parse-level malformed math preserves the source verbatim in the error projection", () => {
    for (const latex of ["\\frac{1}{2", "{", "\\frac{\\oops"]) {
      const html = katexRenderToHtml(latex, false);
      expect(html).not.toBe("");
      expect(html).toContain("katex-error");
      const dom = new DOMParser().parseFromString(html, "text/html");
      expect(dom.body.textContent).toContain(latex);
      assertInertHtml(html);
    }
  });

  it("D5B M2: unknown commands render their tokens and arguments as visible text — no silent disappearance", () => {
    const html = katexRenderToHtml("\\oops{x}", false);
    const dom = new DOMParser().parseFromString(html, "text/html");
    const text = dom.body.textContent ?? "";
    expect(text).toContain("\\oops");
    expect(text).toContain("x");
    assertInertHtml(html);
  });

  // M3/M5 — trust-sensitive commands: no active or remote content path.
  it("D5B M3/R4: trust-disallowed commands produce no anchor/image/attribute capability", () => {
    const corpus = [
      "{\\href{javascript:alert(1)}{click}}",
      "\\href{https://evil.example}{click}",
      "\\htmlClass{x}{content}\\htmlData{trick=1}{d}",
      "\\htmlId{payload}{x}",
      "\\htmlStyle{background:url(javascript:alert(1))}{x}",
      "\\includegraphics[width=\\linewidth]{http://evil.example/x.png}",
    ];
    for (const latex of corpus) {
      const html = katexRenderToHtml(latex, false);
      assertInertHtml(html);
    }
  });

  it("D5B PC-F08: trust-disallowed includegraphics keeps the command token as inert text; the argument is not faithfully represented (EXPECTED_KATEX_POLICY, not a semantic defect)", () => {
    const latex = "\\includegraphics[height=2em]{https://evil.example/x.png}";
    const html = katexRenderToHtml(latex, false);
    const dom = new DOMParser().parseFromString(html, "text/html");
    const text = dom.body.textContent ?? "";
    // Degraded projection: the command token remains, the remote reference
    // does not — neither as an element nor as an attribute/value.
    expect(text).toContain("\\includegraphics");
    expect(dom.querySelector("img")).toBeNull();
    expect(html).not.toContain("evil.example");
    assertInertHtml(html);
  });

  // M4 — HTML-like / injection strings stay escaped text.
  it("D5B M4/R5: HTML-like and event-handler-like math source becomes escaped text only", () => {
    const corpus = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "\\text{<b onmouseover=alert(1)>h</b>}",
    ];
    for (const latex of corpus) {
      const html = katexRenderToHtml(latex, false);
      assertInertHtml(html);
      const dom = new DOMParser().parseFromString(html, "text/html");
      expect(dom.body.textContent).not.toBe("");
    }
  });

  // M6 — bounded rendering: explicit configuration, structural assertions
  // only (no timing thresholds).
  it("D5B M6/R7: expansion abuse fails bounded by maxExpand with the source preserved", () => {
    const latex = "\\def\\a{\\a\\a}\\a";
    const html = katexRenderToHtml(latex, false);
    // maxExpand: 1000 stops the self-expansion as a controlled parse error
    // that still carries the source evidence.
    expect(html).toContain("katex-error");
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.body.textContent).toContain(latex);
    // Structural bound on the output: a failed expansion never produces an
    // unbounded render.
    expect(html.length).toBeLessThan(5000);
    assertInertHtml(html);
  });

  it("D5B M6: dimension abuse is capped by maxSize", () => {
    const html = katexRenderToHtml("\\rule{99999em}{99999em}", true);
    expect(html).not.toContain("99999");
    expect(html.length).toBeLessThan(2000);
    assertInertHtml(html);
  });
});

describe("MathRenderer — real React seam", () => {
  it("D5B-R1: normal inline math renders through the lazy production seam", async () => {
    const { container } = render(
      <MathRenderer latex="E_k=\\frac{1}{2}mv^2" displayMode={false} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".katex")).not.toBeNull();
    });
  });

  it("D5B-R2: normal block math renders in display mode", async () => {
    const { container } = render(
      <MathRenderer latex="W=\\Delta E_k" displayMode={true} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".katex")).not.toBeNull();
    });
  });

  it("D5B-R3: malformed math never crashes the seam and the source stays visible", async () => {
    const { container } = render(
      <MathRenderer latex="\\frac{1}{2" displayMode={false} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".katex-error") ??
          container.querySelector("code"),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("\\frac{1}{2");
  });

  it("D5B-R5: HTML-like math input is inert in the live DOM — no elements, escaped source only", async () => {
    const { container } = render(
      <MathRenderer latex="<img src=x onerror=alert(1)>" displayMode={false} />,
    );
    await waitFor(() => {
      expect(container.textContent).not.toBe("");
    });
    expect(container.querySelector("script, img, iframe")).toBeNull();
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(/^on/i.test(attr.name)).toBe(false);
      }
    }
  });
});

describe("ContentRenderer → ContentDocumentRenderer → MathRenderer composition", () => {
  function doc(blocks: ContentBlock[]): ContentDocumentV1 {
    return { docVersion: 1, type: "doc", content: blocks };
  }

  it("D5B-R8: a real supported document with text, inline math, and block math composes into inert static output", async () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "质点动能 " },
              { type: "inlineMath", latex: "E_k=\\frac{1}{2}mv^2" },
            ],
          },
          { type: "blockMath", latex: "W=\\Delta E_k" },
        ])}
      />,
    );
    expect(container.textContent).toContain("质点动能");
    await waitFor(() => {
      expect(container.querySelectorAll(".katex").length).toBe(2);
    });
    // Inert output sweep over the composed DOM.
    expect(
      container.querySelectorAll(
        "script, iframe, img, video, audio, object, embed, link, a",
      ),
    ).toHaveLength(0);
  });

  it("D5B-R9: the real editor math path — Tiptap JSON → canonical document → static read seam → rendered math — preserves source semantics", async () => {
    // Editor-side Tiptap JSON (toolbar inline math + block math), the same
    // shape the editor emits on every update (canonical by construction —
    // contentAdapter normalizes).
    const editorJson: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "动能定理：" },
            { type: "inlineMath", attrs: { latex: "E=mc^2" } },
          ],
        },
        { type: "blockMath", attrs: { latex: "\\frac{1}{2" } },
      ],
    };
    const canonical = tiptapToContentDocument(editorJson);
    // The editor document passes the D5-A static read trust boundary.
    const trusted = resolvePersistedQuestionDocument(canonical);
    expect(trusted).not.toBeNull();
    const { container } = render(
      <ContentRenderer content="" document={canonical} />,
    );
    // The valid math renders its projection; the malformed block renders the
    // controlled katex-error projection carrying the source.
    await waitFor(() => {
      expect(container.querySelector(".katex")).not.toBeNull();
      expect(container.querySelector(".katex-error")).not.toBeNull();
    });
    // The rendered valid math is a projection, not the raw source text…
    expect(container.textContent).not.toContain("E=mc^2");
    // …while the malformed block's source evidence stays visible.
    expect(container.textContent).toContain("\\frac{1}{2");
  });
});
