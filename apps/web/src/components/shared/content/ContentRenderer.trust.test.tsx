import { render, waitFor } from "@testing-library/react";
import type { ContentBlock, ContentDocumentV1 } from "@exam/domain";
import { classifyPersistedQuestionContent } from "@exam/contracts";
import { describe, expect, it } from "vitest";
import { ContentRenderer } from "./ContentRenderer";

/**
 * D5-A read-trust boundary regressions (#669 F-06).
 *
 * Threat model: a corrupt / future-version / off-grammar `contentDocument`
 * reaches the static prompt read path (take-exam runtime, grading, result,
 * preview, choice options) from persisted JSONB or a frozen snapshot. The
 * TypeScript annotation on ContentRenderer props is not persisted trust: the
 * component must classify through the shared static read authority and fail
 * closed — no render-time TypeError, no partial render of untrusted
 * structure, and never a silent fall back to the plain `content` projection
 * (it is a derived search/display text on Rich questions, not an authority).
 *
 * Inertness (no active HTML) is covered by ContentRenderer.security.test.tsx;
 * these tests own the trust classification contract.
 */

function doc(blocks: unknown[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content: blocks } as ContentDocumentV1;
}

function para(text: string): ContentBlock {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

/** The controlled fail-closed state: never the plain fallback, never a crash. */
function expectIntegrityNotice(container: HTMLElement, plainMarker: string) {
  const notice = container.querySelector(
    "[data-testid='content-integrity-notice']",
  );
  expect(notice, "expected the controlled integrity notice").not.toBeNull();
  expect(notice?.textContent).toBe("此内容无法安全显示");
  expect(
    container.textContent?.includes(plainMarker),
    "corrupt Rich must never fall back to the plain content projection",
  ).toBe(false);
}

describe("ContentRenderer — static prompt read trust", () => {
  it("a canonical prompt renders text, inline math, and block math through the real renderer composition", async () => {
    const canonical = doc([
      para("动能定理："),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "质点动能 " },
          { type: "inlineMath", latex: "E_k=\\frac{1}{2}mv^2" },
          { type: "text", text: " 沿路径做功。" },
        ],
      },
      { type: "blockMath", latex: "W=\\Delta E_k" },
    ]);
    const { container } = render(
      <ContentRenderer
        content="plain-projection-marker"
        document={canonical}
      />,
    );
    expect(container.textContent).toContain("动能定理");
    // Real KaTeX output (composition: ContentRenderer →
    // ContentDocumentRenderer → MathRenderer), not the raw source. The math
    // chunk is lazy, so wait past the Suspense fallback.
    await waitFor(() => {
      expect(container.querySelectorAll(".katex").length).toBe(2);
    });
  });

  it("docVersion 2 fails closed to the integrity notice — never interpreted as V1, never the plain fallback", () => {
    const future = {
      docVersion: 2,
      type: "doc",
      content: [para("未来版本文档")],
    } as unknown as ContentDocumentV1;
    const { container } = render(
      <ContentRenderer content="plain-projection-marker" document={future} />,
    );
    expectIntegrityNotice(container, "plain-projection-marker");
    expect(container.textContent).not.toContain("未来版本文档");
  });

  it("renders a null document slot as the plain path (the content string is the authority)", () => {
    for (const absent of [null, undefined]) {
      const { container, unmount } = render(
        <ContentRenderer content="纯文本题干" document={absent} />,
      );
      expect(container.textContent).toBe("纯文本题干");
      expect(
        container.querySelector("[data-testid='content-integrity-notice']"),
      ).toBeNull();
      unmount();
    }
  });

  it("corrupt envelopes (missing / non-array / wrong-type content) fail closed without a render-time TypeError", () => {
    const envelopes = [
      { docVersion: 1, type: "doc" },
      { docVersion: 1, type: "doc", content: "not-an-array" },
      { docVersion: 1, type: "doc", content: { block: true } },
      { docVersion: 1, type: "doc", content: 42 },
      "a bare legacy string in the document slot",
      42,
    ];
    for (const envelope of envelopes) {
      const { container, unmount } = render(
        <ContentRenderer
          content="plain-projection-marker"
          document={envelope as unknown as ContentDocumentV1}
        />,
      );
      expectIntegrityNotice(container, "plain-projection-marker");
      unmount();
    }
  });

  it("corrupt nested structure that would crash document/block .map() fails closed without an uncaught render exception", () => {
    const nested = [
      // paragraph.content must be an inline array:
      { type: "paragraph", content: "scalar" },
      // listItem.content must be a block array:
      {
        type: "bulletList",
        content: [{ type: "listItem", content: 42 }],
      },
      // tableCell.content must be a paragraph array:
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: null }],
          },
        ],
      },
    ];
    for (const blocks of nested) {
      const { container, unmount } = render(
        <ContentRenderer
          content="plain-projection-marker"
          document={doc([blocks])}
        />,
      );
      expectIntegrityNotice(container, "plain-projection-marker");
      unmount();
    }
  });

  it("off-grammar blocks/inlines are rejected by the trust resolver BEFORE rendering — not partially rendered", () => {
    const offGrammar = [
      // Unknown block type:
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      // Known block with an unknown inline node:
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before" },
          { type: "customEmbed", html: "<img src=x onerror=alert(1)>" },
        ],
      },
      // Unknown mark on an otherwise valid run:
      {
        type: "paragraph",
        content: [
          { type: "text", text: "styled", marks: ["bold", "unknownMark"] },
        ],
      },
    ];
    const { container } = render(
      <ContentRenderer
        content="plain-projection-marker"
        document={doc(offGrammar)}
      />,
    );
    // The whole document fails closed: the resolver never hands a partially
    // interpretable document to the renderer (that mixed output is the F-06
    // "partially render inconsistently" defect class).
    expectIntegrityNotice(container, "plain-projection-marker");
    expect(container.textContent).not.toContain("before");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("historical noncanonical Rich displays read-only with an explicit noncanonical classification and zero mutation", () => {
    // Schema-valid but noncanonical: unsorted marks + split same-mark runs.
    const historical = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "题", marks: ["italic", "bold"] },
            { type: "text", text: "干", marks: ["italic", "bold"] },
          ],
        },
      ],
    } as unknown as ContentDocumentV1;
    // Explicit noncanonical classification — DISPLAY, not canonicality.
    expect(classifyPersistedQuestionContent(historical).kind).toBe(
      "rich_noncanonical",
    );
    const snapshot = structuredClone(historical);
    const { container } = render(
      <ContentRenderer content="题干" document={historical} />,
    );
    expect(container.textContent).toContain("题");
    expect(container.querySelector("strong")).not.toBeNull();
    // Read != repair: the rendered document is the persisted shape, untouched.
    expect(historical).toEqual(snapshot);
  });
});
