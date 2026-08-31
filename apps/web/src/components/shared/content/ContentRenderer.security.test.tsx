import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import type { ContentBlock, ContentDocumentV1 } from "@exam/domain";
import { describe, expect, it } from "vitest";
import { ContentRenderer } from "./ContentRenderer";
import { MathRenderer } from "./MathRenderer";

/**
 * Adversarial security tests for the static content READ path.
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

describe("ContentRenderer — hostile HTML-looking strings stay inert text", () => {
  const PAYLOADS = [
    '<img src=x onerror="window.__pwned=1">',
    "<script>alert(1)</script>",
    "javascript:alert(document.cookie)",
    "<svg onload=alert(1)></svg><body onload=alert(1)>",
  ];

  it("plain content renders every hostile string as escaped text, never as elements", () => {
    for (const payload of PAYLOADS) {
      const { container, unmount } = render(
        <ContentRenderer content={payload} />,
      );
      expect(container.textContent).toBe(payload);
      assertInert(container);
      unmount();
    }
  });

  it("rich text runs render hostile strings as escaped text, including inside marks", () => {
    const hostileDoc = doc([
      para('<iframe src="javascript:alert(1)"></iframe>'),
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "<img src=x onerror=alert(1)>",
            marks: ["bold", "italic", "underline", "inlineCode"],
          },
        ],
      },
    ]);
    const { container } = render(
      <ContentRenderer content="" document={hostileDoc} />,
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    assertInert(container);
  });

  it("hostile strings pass through lists and tables inertly", () => {
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
    expect(container.textContent).toContain("<svg onload=alert(1)></svg>");
    assertInert(container);
  });

  it("codeBlock text is escaped verbatim, never parsed as markup", () => {
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
    expect(container.querySelector("pre")?.textContent).toBe(
      '<iframe src="javascript:alert(1)"></iframe>',
    );
    assertInert(container);
  });
});

describe("ContentRenderer — corrupt-data fail-safes", () => {
  const UNSUPPORTED = "此内容包含当前版本不支持的元素";

  it("replaces an unknown block node with the controlled placeholder", () => {
    const hostile = doc([
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      para("after"),
    ] as unknown as ContentBlock[]);
    const { container } = render(
      <ContentRenderer content="" document={hostile} />,
    );
    expect(container.textContent).toContain(UNSUPPORTED);
    expect(container.textContent).toContain("after");
    assertInert(container);
  });

  it("drops an unknown inline node and ignores an unknown mark while keeping sibling content", () => {
    const { container } = render(
      <ContentRenderer
        content=""
        document={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before" },
              { type: "customEmbed", html: '<img src=x onerror="alert(1)">' },
              { type: "text", text: "after" },
            ],
          },
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
        ] as unknown as ContentBlock[])}
      />,
    );
    assertInert(container);
    expect(container.textContent).toBe("beforeafterstyled");
    expect(container.querySelector("strong")?.textContent).toBe("styled");
  });

  it("survives corrupt oversize input (deep tree, huge text run) without crashing", () => {
    let block: ContentBlock = para("leaf");
    for (let i = 0; i < 60; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block as never] }],
      };
    }
    const { container, unmount } = render(
      <ContentRenderer content="" document={doc([block])} />,
    );
    expect(container.textContent).toContain("leaf");
    assertInert(container);
    unmount();

    const huge = "<script>".repeat(20000);
    const hugeRender = render(
      <ContentRenderer content="" document={doc([para(huge)])} />,
    );
    assertInert(hugeRender.container);
    hugeRender.unmount();
  });
});

describe("MathRenderer — hostile LaTeX (trust: false)", () => {
  const HOSTILE_LATEX = [
    "{\\href{javascript:alert(1)}{click}}",
    "\\includegraphics[width=\\linewidth]{http://evil.example/x.png}",
    "\\htmlClass{x}{content}\\htmlData{trick=1}{d}",
    "\\htmlId{payload}{x}",
    "\\htmlStyle{background:url(javascript:alert(1))}{x}",
    "\\frac{\\oops",
  ];

  it("renders hostile and invalid LaTeX as inert source, never executable markup", () => {
    for (const latex of HOSTILE_LATEX) {
      const { container, unmount } = render(
        <MathRenderer latex={latex} displayMode={false} />,
      );
      expect(container.textContent).not.toBe("");
      assertInert(container);
      unmount();
    }
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
