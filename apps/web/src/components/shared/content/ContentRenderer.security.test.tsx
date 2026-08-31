import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import type { ContentBlock, ContentDocumentV1 } from "@exam/domain";
import { describe, expect, it } from "vitest";
import { ContentRenderer } from "./ContentRenderer";
import { MathRenderer } from "./MathRenderer";

/**
 * Adversarial security tests for the static content READ path (issue 301 §45).
 *
 * Threat model: a malicious or corrupt persisted document (written by a
 * compromised admin client, an old build, or a future migration bug) reaches
 * the renderer. The renderer must stay a fail-safe pure-React projection:
 * every string is escaped text, unknown nodes degrade to the controlled
 * placeholder, and the ONLY raw-HTML seam is the encapsulated KaTeX span
 * (trust: false).
 *
 * These assertions are structural (DOM shape), not behavioral: jsdom never
 * executes injected handlers anyway, so "no on* attribute / no script element"
 * is the actual invariant we can prove here.
 */

function doc(blocks: ContentBlock[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content: blocks };
}

function para(text: string): ContentBlock {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

/** Elements that must never appear in rendered rich content. */
const FORBIDDEN_TAGS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "link",
  "meta",
  "style",
  "img",
  "video",
  "audio",
  "source",
  "form",
  "input",
  "button",
  "a",
] as const;

/**
 * Full DOM audit: no forbidden elements, no event-handler attributes, no
 * javascript: URLs in any attribute value. Scans the KaTeX output too — it
 * is part of the rendered surface.
 */
function assertInert(container: HTMLElement): void {
  for (const tag of FORBIDDEN_TAGS) {
    expect(
      container.querySelector(tag),
      `unexpected <${tag}> in rendered content`,
    ).toBeNull();
  }
  for (const el of Array.from(container.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(
        /^on/i.test(attr.name),
        `event-handler attribute ${attr.name} on <${el.tagName.toLowerCase()}>`,
      ).toBe(false);
      expect(
        /javascript:/i.test(attr.value),
        `javascript: URL in ${attr.name}="${attr.value.slice(0, 80)}"`,
      ).toBe(false);
    }
  }
}

describe("ContentRenderer plain path (document absent)", () => {
  it("renders HTML-looking plain text as inert text, never as elements", () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const { container } = render(<ContentRenderer content={payload} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(payload);
    assertInert(container);
  });

  it("renders a script tag payload as text", () => {
    const payload = "<script>alert(1)</script>";
    const { container } = render(<ContentRenderer content={payload} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe(payload);
  });
});

describe("ContentRenderer rich path — hostile payloads through every string field", () => {
  it("keeps a script payload in a text run inert and escaped", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([para("<script>alert(1)</script>")])}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    assertInert(container);
  });

  it("keeps an img onerror payload in a text run inert", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([para('<img src=x onerror="alert(1)">')])}
      />,
    );
    assertInert(container);
    expect(container.textContent).toContain("onerror");
  });

  it("keeps a javascript: URL payload inert (no anchor is ever emitted)", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([para("javascript:alert(document.cookie)")])}
      />,
    );
    assertInert(container);
  });

  it("composes marks without introducing handlers", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "boom<img src=x onerror=alert(1)>",
                marks: ["bold", "italic", "underline", "inlineCode"],
              },
            ],
          },
        ])}
      />,
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("em")).not.toBeNull();
    expect(container.querySelector("u")).not.toBeNull();
    expect(container.querySelector("code")).not.toBeNull();
    assertInert(container);
  });

  it("keeps an iframe payload in a codeBlock inert", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([
          {
            type: "codeBlock",
            language: null,
            text: '<iframe src="javascript:alert(1)"></iframe>',
          },
        ])}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe(
      '<iframe src="javascript:alert(1)"></iframe>',
    );
    assertInert(container);
  });

  it("renders raw-html-paste payloads through lists and tables inertly", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "<svg onload=alert(1)></svg>" },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: "<body onload=alert(1)>" },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ])}
      />,
    );
    assertInert(container);
    expect(container.textContent).toContain("<svg onload=alert(1)></svg>");
  });
});

describe("ContentRenderer rich path — corrupt-data fail-safes", () => {
  const UNSUPPORTED = "此内容包含当前版本不支持的元素";

  it("replaces an unknown (out-of-grammar) block with the controlled placeholder", () => {
    const hostile = doc([
      {
        type: "script",
        content: [{ type: "text", text: "alert(1)" }],
      },
      para("after"),
    ] as unknown as ContentBlock[]);
    const { container } = render(
      <ContentRenderer content="" document={hostile} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(UNSUPPORTED);
    expect(container.textContent).toContain("after");
    assertInert(container);
  });

  it("drops an unknown inline node while keeping sibling text", () => {
    const hostile = doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before" },
          {
            type: "customEmbed",
            html: '<img src=x onerror="alert(1)">',
          },
          { type: "text", text: "after" },
        ],
      },
    ] as unknown as ContentBlock[]);
    const { container } = render(
      <ContentRenderer content="" document={hostile} />,
    );
    assertInert(container);
    expect(container.textContent).toBe("beforeafter");
  });

  it("ignores an unknown mark on a text run", () => {
    const hostile = doc([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "styled",
            marks: ["bold", "unknownMark" as never],
          },
        ],
      },
    ]);
    const { container } = render(
      <ContentRenderer content="" document={hostile} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("styled");
    assertInert(container);
  });

  it("survives a deep tree far beyond the kernel depth limit without crashing", () => {
    // Build 60 nested bulletLists (kernel limit is 8) — corrupt data past the
    // write boundary must degrade, never crash the read path.
    let block: ContentBlock = para("leaf");
    for (let i = 0; i < 60; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block as never] }],
      };
    }
    const { container } = render(
      <ContentRenderer content="" document={doc([block])} />,
    );
    expect(container.textContent).toContain("leaf");
    assertInert(container);
  });

  it("renders a huge text run (beyond kernel textRun limit) as inert text", () => {
    const huge = "<script>".repeat(20000);
    const { container } = render(
      <ContentRenderer content="" document={doc([para(huge)])} />,
    );
    assertInert(container);
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("MathRenderer — hostile LaTeX", () => {
  it("does not emit anchors for \\href with a javascript: target (trust: false)", () => {
    const { container } = render(
      <MathRenderer
        latex="{\\href{javascript:alert(1)}{click}}"
        displayMode={false}
      />,
    );
    assertInert(container);
  });

  it("does not emit img elements for \\includegraphics (trust: false)", () => {
    const { container } = render(
      <MathRenderer
        latex="\\includegraphics[width=\\linewidth]{http://evil.example/x.png}"
        displayMode={false}
      />,
    );
    assertInert(container);
  });

  it("does not emit raw HTML for \\htmlClass/\\htmlData/\\htmlStyle (trust: false)", () => {
    for (const latex of [
      "\\htmlClass{x}{content}\\htmlData{trick=1}{d}",
      "\\htmlId{payload}{x}",
      "\\htmlStyle{background:url(javascript:alert(1))}{x}",
    ]) {
      const { container } = render(
        <MathRenderer latex={latex} displayMode={true} />,
      );
      assertInert(container);
    }
  });

  it("renders invalid LaTeX as inert source instead of throwing", () => {
    const { container } = render(
      <MathRenderer latex="\\frac{\\oops" displayMode={true} />,
    );
    // throwOnError:false → KaTeX renders its own error text; either way the
    // output is inert and the LaTeX source remains visible.
    expect(container.textContent).not.toBe("");
    assertInert(container);
  });

  it("renders oversized latex as escaped text without invoking KaTeX output", () => {
    const huge = "x".repeat(5001);
    const { container } = render(
      <MathRenderer latex={huge} displayMode={false} />,
    );
    expect(container.textContent).toBe(huge);
    assertInert(container);
  });
});

describe("dangerouslySetInnerHTML stays confined to the KaTeX seam", () => {
  it("appears in exactly one content component file", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)));
    const files = [
      "ContentRenderer.tsx",
      "ContentDocumentRenderer.tsx",
      "MathRenderer.tsx",
      "katexRender.ts",
      "KatexHtmlRenderer.tsx",
    ].map((f) => join(dir, f));
    const offenders = files
      // Match actual JSX usage, not doc-comment mentions of the seam.
      .filter((f) =>
        readFileSync(f, "utf8").includes("dangerouslySetInnerHTML={{"),
      )
      .map((f) => f.split("/").pop());
    expect(offenders).toEqual(["KatexHtmlRenderer.tsx"]);
  });
});
