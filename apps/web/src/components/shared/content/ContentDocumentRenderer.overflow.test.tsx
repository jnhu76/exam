import { act, render, waitFor } from "@testing-library/react";
import type { ContentBlock, ContentDocumentV1 } from "@exam/domain";
import { describe, expect, it } from "vitest";
import { ContentDocumentRenderer } from "./ContentDocumentRenderer";
import {
  ContentScrollFocusContext,
  ContentScrollViewport,
} from "./ContentScrollViewport";

/**
 * The rich-content horizontal overflow contract (#S2.4).
 *
 * Rich content is inert, untrusted input: formulas, code and tables must be
 * fully readable, must never widen their parent layout, and any horizontal
 * overflow must become ONE locally scrollable viewport whose keyboard
 * reachability is decided from measured overflow facts:
 *
 *   - no overflow → no tab stop, no role, no label (short content must not
 *     add interaction burden);
 *   - overflow → exactly one focusable group with an accurate label;
 *   - inside a collapsed disclosure → no tab stop at all (focus must never
 *     enter content the user cannot see).
 *
 * jsdom reports every box metric as zero; these tests stub the two integer
 * facts the shared `useOverflowObservation` owner reads (scrollWidth /
 * clientWidth) on the viewport element itself.
 */

function doc(blocks: ContentBlock[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content: blocks };
}

const BLOCK_MATH: ContentBlock = {
  type: "blockMath",
  latex: "T_{end} = T_{prop} + T_{trans} + T_{queue}",
};

const CODE_BLOCK: ContentBlock = {
  type: "codeBlock",
  language: null,
  text: "const veryLongIdentifier = someFunction(argumentOne, argumentTwo, argumentThree, argumentFour);",
};

const WIDE_TABLE: ContentBlock = {
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
              content: [{ type: "text", text: "表头" }],
            },
          ],
        },
        {
          type: "tableCell",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "另一列" }],
            },
          ],
        },
      ],
    },
  ],
};

let originalMetrics: {
  scrollWidth?: PropertyDescriptor;
  clientWidth?: PropertyDescriptor;
  offsetWidth?: PropertyDescriptor;
};

/**
 * Stubs the overflow facts on every rich-content viewport element. The three
 * numbers are enough for `useOverflowObservation`'s integer overflow decision;
 * `getBoundingClientRect` is intentionally untouched because the decision never
 * reads it (only the table allocator does, and there is no table shell here).
 */
function stubViewportMetrics(metrics: {
  scrollWidth: number;
  clientWidth: number;
}) {
  const proto = HTMLElement.prototype;
  originalMetrics = {
    scrollWidth: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
  };
  const isViewport = (el: HTMLElement) =>
    el.dataset.slot === "content-scroll-viewport";
  Object.defineProperty(proto, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return isViewport(this) ? metrics.scrollWidth : 0;
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return isViewport(this) ? metrics.clientWidth : 0;
    },
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return isViewport(this) ? metrics.clientWidth : 0;
    },
  });
}

function restoreViewportMetrics() {
  const proto = HTMLElement.prototype;
  for (const key of ["scrollWidth", "clientWidth", "offsetWidth"] as const) {
    const desc = originalMetrics?.[key];
    if (desc) Object.defineProperty(proto, key, desc);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
}

function viewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    '[data-slot="content-scroll-viewport"]',
  );
  if (!el) throw new Error("rich-content viewport not found");
  return el;
}

describe("ContentDocumentRenderer — horizontal overflow contract", () => {
  it("does not create a tab stop or ARIA group when the content fits", async () => {
    stubViewportMetrics({ scrollWidth: 180, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([BLOCK_MATH])} />,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "false");
      });
      expect(el).toHaveAttribute("tabindex", "-1");
      expect(el).not.toHaveAttribute("role");
      expect(el).not.toHaveAttribute("aria-label");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("exposes exactly one labelled, focusable group when the content overflows", async () => {
    stubViewportMetrics({ scrollWidth: 640, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([BLOCK_MATH])} />,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el).toHaveAttribute("tabindex", "0");
      expect(el).toHaveAttribute("role", "group");
      expect(el).toHaveAttribute("aria-label", "公式，可横向滚动");
      // Visible focus feedback is part of the contract, not an optional CSS
      // detail: the browser default outline alone is not the authorization.
      expect(el.className).toContain("focus-visible:outline-2");
      expect(el.className).toContain("focus-visible:outline-solid");
      expect(el.className).toContain("focus-visible:outline-primary");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("keeps one scroll owner per rich block (no nested horizontal scrollers)", async () => {
    stubViewportMetrics({ scrollWidth: 640, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer
          document={doc([BLOCK_MATH, CODE_BLOCK, WIDE_TABLE])}
        />,
      );
      await waitFor(() => {
        expect(
          container.querySelectorAll(
            '[data-slot="content-scroll-viewport"][data-overflowing="true"]',
          ),
        ).toHaveLength(3);
      });
      // The code block IS the viewport (a <pre>), never a second wrapper.
      const code = container.querySelector<HTMLElement>(
        'pre[data-slot="content-scroll-viewport"]',
      );
      expect(code).not.toBeNull();
      expect(code?.querySelector("[data-slot='content-scroll-viewport']")).toBe(
        null,
      );
      // The measured region is the bare <pre> (no padding — the shared
      // observation hook's box contract); the code surface/padding belongs to
      // the inner block that grows with the scrolled line.
      expect(code?.className).toContain("type-code");
      expect(code?.className).not.toContain("p-3");
      expect(code?.querySelector("code")?.className).toContain("p-3");
      // The table viewport wraps the semantic table; table semantics survive.
      const table = container.querySelector("table");
      expect(table).not.toBeNull();
      expect(table?.closest("[data-slot='content-scroll-viewport']")).not.toBe(
        null,
      );
      // Math never wraps (a wrapped formula is a different formula), and the
      // viewport owns that before KaTeX's lazy stylesheet arrives. Tables keep
      // their ordinary cell wrapping.
      const mathViewport = container.querySelector<HTMLElement>(
        '[data-slot="content-scroll-viewport"][data-kind="block"]',
      );
      expect(mathViewport?.className).toContain("whitespace-nowrap");
      const tableViewport = table?.closest<HTMLElement>(
        "[data-slot='content-scroll-viewport']",
      );
      expect(tableViewport?.className).not.toContain("whitespace-nowrap");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("constrains inline math to an inline-block span that can scroll in place", async () => {
    const inline: ContentBlock = {
      type: "paragraph",
      content: [
        { type: "text", text: "时延 " },
        { type: "inlineMath", latex: "T_{end}=T_{prop}+T_{trans}+T_{queue}" },
        { type: "text", text: " 的构成。" },
      ],
    };
    stubViewportMetrics({ scrollWidth: 640, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([inline])} />,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toContain("inline-block");
      // The baseline-preserving alignment is part of the contract, not a
      // cosmetic detail: an inline-block baseline inflates the line box.
      expect(el.className).toContain("align-middle");
      expect(el.parentElement?.tagName).toBe("P");
      // The paragraph itself must not be the overflow owner.
      expect(el.parentElement?.className).not.toContain("overflow-x-auto");
      // A genuinely overflowing inline formula is still the one labelled,
      // keyboard-reachable scroll owner.
      expect(el).toHaveAttribute("tabindex", "0");
      expect(el).toHaveAttribute("role", "group");
      expect(el).toHaveAttribute("aria-label", "行内公式，可横向滚动");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("re-measures when lazy content replaces the initial fallback", async () => {
    // MathRenderer shows the LaTeX source while the lazy KaTeX chunk loads;
    // the viewport does not re-render when that fallback is swapped. A stale
    // "fits" measurement would leave the real formula unreachable.
    const metrics = { scrollWidth: 180, clientWidth: 200 };
    stubViewportMetrics(metrics);
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([BLOCK_MATH])} />,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "false");
      });
      metrics.scrollWidth = 640;
      // Simulate the lazy boundary's child replacement (fallback → KaTeX).
      el.appendChild(document.createElement("span"));
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el).toHaveAttribute("tabindex", "0");
      expect(el).toHaveAttribute("role", "group");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("re-measures when a web font finishes after the initial layout", async () => {
    const listeners = new Map<string, () => void>();
    const descriptor = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        addEventListener: (type: string, callback: () => void) => {
          listeners.set(type, callback);
        },
        removeEventListener: (type: string) => {
          listeners.delete(type);
        },
      },
    });
    const metrics = { scrollWidth: 180, clientWidth: 200 };
    stubViewportMetrics(metrics);
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([BLOCK_MATH])} />,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "false");
      });
      metrics.scrollWidth = 205;
      act(() => {
        listeners.get("loadingdone")?.();
      });
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el).toHaveAttribute("tabindex", "0");
    } finally {
      restoreViewportMetrics();
      if (descriptor) Object.defineProperty(document, "fonts", descriptor);
      else delete (document as unknown as Record<string, unknown>).fonts;
    }
  });

  it("re-attaches the mutation observer when the viewport element kind changes", async () => {
    const metrics = { scrollWidth: 180, clientWidth: 200 };
    stubViewportMetrics(metrics);
    try {
      const { container, rerender } = render(
        <ContentScrollViewport
          kind="inline"
          labelKey="content.scrollRegion.inlineFormula"
          nowrap
        >
          <span>formula</span>
        </ContentScrollViewport>,
      );
      await waitFor(() => {
        expect(viewport(container)).toHaveAttribute(
          "data-overflowing",
          "false",
        );
      });
      rerender(
        <ContentScrollViewport
          kind="block"
          labelKey="content.scrollRegion.formula"
          nowrap
        >
          <span>formula</span>
        </ContentScrollViewport>,
      );
      const next = viewport(container);
      expect(next.tagName).toBe("DIV");
      metrics.scrollWidth = 640;
      next.appendChild(document.createElement("span"));
      await waitFor(() => {
        expect(next).toHaveAttribute("data-overflowing", "true");
      });
    } finally {
      restoreViewportMetrics();
    }
  });

  it("ignores the KaTeX inline ~2px artifact and keeps the inline scroller chrome-free", async () => {
    const inline: ContentBlock = {
      type: "paragraph",
      content: [
        { type: "text", text: "行内公式：" },
        { type: "inlineMath", latex: "T_{end}=T_{prop}+T_{trans}+T_{queue}" },
      ],
    };
    // Measured inline KaTeX boxes report two extra pixels from italic
    // correction; that is not hidden content and must not become a tab stop.
    stubViewportMetrics({ scrollWidth: 202, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([inline])} />,
      );
      const el = viewport(container);
      expect(el.tagName).toBe("SPAN");
      expect(el).toHaveAttribute("data-overflowing", "false");
      expect(el).toHaveAttribute("tabindex", "-1");
      expect(el).not.toHaveAttribute("role");
      // No native scrollbar inside a text line; keyboard/trackpad scrolling
      // remains available for a real overflow.
      expect(el.className).toContain("[scrollbar-width:none]");
      expect(el.className).toContain("overflow-y-hidden");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("treats the 4px inline artifact boundary as non-interactive and 5px as real overflow", async () => {
    const inline: ContentBlock = {
      type: "paragraph",
      content: [
        { type: "text", text: "行内公式：" },
        { type: "inlineMath", latex: "T_{end}=T_{prop}+T_{trans}+T_{queue}" },
      ],
    };
    const metrics = { scrollWidth: 204, clientWidth: 200 }; // 4px
    stubViewportMetrics(metrics);
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([inline])} />,
      );
      const el = viewport(container);
      expect(el).toHaveAttribute("data-overflowing", "false");
      expect(el).toHaveAttribute("tabindex", "-1");

      metrics.scrollWidth = 205; // 5px
      el.appendChild(document.createElement("span"));
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el).toHaveAttribute("tabindex", "0");
      expect(el).toHaveAttribute("role", "group");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("suppresses the tab stop while a collapsed disclosure hides the content", async () => {
    stubViewportMetrics({ scrollWidth: 640, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentScrollFocusContext.Provider value={false}>
          <ContentDocumentRenderer document={doc([BLOCK_MATH])} />
        </ContentScrollFocusContext.Provider>,
      );
      const el = viewport(container);
      await waitFor(() => {
        expect(el).toHaveAttribute("data-overflowing", "true");
      });
      expect(el).toHaveAttribute("tabindex", "-1");
      expect(el).not.toHaveAttribute("role");
      expect(el).not.toHaveAttribute("aria-label");
    } finally {
      restoreViewportMetrics();
    }
  });

  it("does not duplicate the KaTeX formula for assistive technology", async () => {
    stubViewportMetrics({ scrollWidth: 640, clientWidth: 200 });
    try {
      const { container } = render(
        <ContentDocumentRenderer document={doc([BLOCK_MATH])} />,
      );
      await waitFor(() => {
        expect(container.querySelector(".katex-mathml math")).not.toBeNull();
      });
      // KaTeX's visual projection is hidden from AT; the MathML is the one
      // accessible copy. The scroll viewport adds only a short group label.
      expect(
        container.querySelector(".katex-html")?.getAttribute("aria-hidden"),
      ).toBe("true");
      expect(
        container.querySelectorAll(
          '[data-slot="content-scroll-viewport"] .katex',
        ),
      ).toHaveLength(1);
    } finally {
      restoreViewportMetrics();
    }
  });
});
