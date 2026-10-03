/**
 * Phase-E Campaign M — static render trust (React seam, E-RE01/02/03).
 * Attacks `ContentRenderer` — the unified READ entry — with rendered-string
 * output (react-dom/server, no browser needed for the trust structure; the
 * D5 network/browser evidence remains the L5 leg for inertness-at-scale):
 *
 * E-RE01: only rich_valid / rich_noncanonical reach the document renderer;
 *   the plain `content` string is never rendered on a Rich slot.
 *
 * E-RE02: corrupt / unsupported_version fail closed to the controlled
 *   integrity notice (`data-testid="content-integrity-notice"`) — no
 *   document markup, no plain fallback, no render-time throw.
 *
 * E-RE03: rendering is inert — hostile text/code content surfaces ESCAPED
 *   (React text escaping); no script/img-event markup may appear as live
 *   HTML from document content.
 */
import { describe, expect, it, afterAll } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ContentDocumentV1 } from "@exam/domain";
import { ContentRenderer } from "@exam/web/src/components/shared/content/ContentRenderer.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("M-render-trust", [0x669e0004]);

const PLAIN_FALLBACK = "PLAIN-CONTENT-FALLBACK-MUST-NOT-RENDER";

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function render(document: ContentDocumentV1 | null): string {
  return renderToString(
    createElement(ContentRenderer, {
      content: PLAIN_FALLBACK,
      document,
      className: "",
    }),
  );
}

describe("Campaign M — static render trust (E-RE01/02/03)", () => {
  it("E-RE01: rich_valid renders the document structure, never the plain fallback", () => {
    const doc: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "M visible paragraph" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "M item" }],
                },
              ],
            },
          ],
        },
        { type: "blockMath", latex: "x^2" },
      ],
    };
    const html = render(doc);
    expect(html).toContain("M visible paragraph");
    expect(html).toContain("M item");
    // Rich slot: the server-derived plain projection must not blend in.
    expect(html).not.toContain(PLAIN_FALLBACK);
    // Document markup present (list) and math chunk markup present.
    expect(html).toContain("<ul");
    recorder.record({ probe: "rich-valid", outcome: "document-rendered" });
  });

  it("E-RE01 display-granted: rich_noncanonical still renders (read-only display, no repair)", () => {
    const noncanonical: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "M noncanonical", marks: ["italic", "bold"] },
          ],
        },
      ],
    };
    const html = render(noncanonical);
    expect(html).toContain("M noncanonical");
    expect(html).not.toContain("content-integrity-notice");
    expect(html).not.toContain(PLAIN_FALLBACK);
    recorder.record({ probe: "rich-noncanonical", outcome: "display-granted" });
  });

  it("E-RE02: corrupt and unsupported fail closed to the integrity notice", () => {
    for (const [name, bad] of [
      ["corrupt", { docVersion: 1, type: "not-doc", content: [] }],
      ["unsupported_version", { docVersion: 2, type: "doc", content: [] }],
    ] as Array<[string, unknown]>) {
      let html: string;
      try {
        html = render(bad as ContentDocumentV1);
      } catch (e) {
        throw new Error(
          `${name}: render threw (E-RE02 forbids render-time failure): ${String(e)}`,
        );
      }
      expect(
        html.includes("content-integrity-notice"),
        `${name}: no controlled integrity notice`,
      ).toBe(true);
      // No plain-content fallback, no document markup.
      expect(html).not.toContain(PLAIN_FALLBACK);
      expect(html).not.toContain("<ul");
      recorder.record({ probe: `closed-${name}`, outcome: "integrity-notice" });
    }
  });

  it("E-RE03: hostile text and code content render inert (escaped, never live markup)", () => {
    const hostile: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "<script>alert(1)</script><img src=x onerror=alert(1)>",
            },
          ],
        },
        {
          type: "codeBlock",
          language: null,
          text: "</script><iframe src=//evil.example>",
        },
      ],
    };
    const html = render(hostile);
    // The payload must not exist as LIVE markup anywhere in the output.
    expect(html.includes("<script>alert(1)")).toBe(false);
    expect(html.includes("<img src=x")).toBe(false);
    expect(html.includes("<iframe")).toBe(false);
    // And the source must remain recoverable (escaped text nodes).
    expect(html).toContain("&lt;script&gt;");
    recorder.record({ probe: "inertness", outcome: "escaped" });
  });

  afterAll(() => {
    recorder.flush();
  });
});
