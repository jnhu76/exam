import { useState } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContentDocumentV1 } from "@exam/domain";
import { ContentRenderer } from "./ContentRenderer";
import { ContentDocumentRenderer } from "./ContentDocumentRenderer";
import { contentDocumentsEqual } from "./contentAdapter";

/**
 * Synthetic workload evidence for the issue 301 READ path (measured
 * numbers are recorded in the PR report; this file asserts only the loose
 * regression bounds) (issue 301 §52).
 *
 * These are MEASURED evidence runs, not flake-tight gates: they assert only
 * loose sanity bounds (catastrophic regressions) and log the measured
 * durations for the PR report. jsdom timings are indicative, not
 * production-representative; bundle evidence lives in the PR description.
 */

function paraDoc(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function mixedRichDoc(i: number): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: `题干 ${i}：`, marks: ["bold"] },
          { type: "text", text: "下列说法正确的是" },
          { type: "inlineMath", latex: `x^2+${i}x+1=0` },
        ],
      },
      {
        type: "orderedList",
        content: [1, 2, 3, 4].map((n) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `选项内容 ${n}` }],
            },
          ],
        })),
      },
      { type: "blockMath", latex: "\\int_0^1 x\\,dx=\\frac{1}{2}" },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [1, 2].map((n) => ({
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: `c${n}` }],
                },
              ],
            })),
          },
        ],
      },
      {
        type: "codeBlock",
        language: "py",
        text: `print(${i})\n`,
      },
    ],
  };
}

/** Renders N plain choice prompts (workload A). */
function renderPlainList(n: number): number {
  const docs = Array.from({ length: n }, (_, i) => `plain 题干 ${i}`);
  const t0 = performance.now();
  const { unmount } = render(
    <div>
      {docs.map((d, i) => (
        <ContentRenderer key={i} content={d} document={null} />
      ))}
    </div>,
  );
  const ms = performance.now() - t0;
  unmount();
  return ms;
}

/** Renders N rich mixed documents (workload B). */
function renderRichList(n: number): number {
  const docs = Array.from({ length: n }, (_, i) => mixedRichDoc(i));
  const t0 = performance.now();
  const { unmount } = render(
    <div>
      {docs.map((d, i) => (
        <ContentRenderer key={i} content={`题干 ${i}`} document={d} />
      ))}
    </div>,
  );
  const ms = performance.now() - t0;
  unmount();
  return ms;
}

describe("content READ path — synthetic workloads", () => {
  it("workload A: 100 plain choice prompts render fast (no editor/math cost)", () => {
    const ms = renderPlainList(100);
    expect(ms).toBeLessThan(5000);
  });

  it("workload B: 100 rich mixed documents render fast via the static renderer", () => {
    const ms = renderRichList(100);
    expect(ms).toBeLessThan(30000);
  });

  it("workload C: grading-style list (50 questions, 10 rich answers)", () => {
    const t0 = performance.now();
    const { unmount } = render(
      <div>
        {Array.from({ length: 50 }, (_, i) => (
          <div key={i}>
            <ContentRenderer
              content={`题干 ${i}`}
              document={i < 10 ? mixedRichDoc(i) : null}
            />
            {i < 10 && (
              <ContentDocumentRenderer document={mixedRichDoc(i + 100)} />
            )}
          </div>
        ))}
      </div>,
    );
    const ms = performance.now() - t0;
    unmount();
    expect(ms).toBeLessThan(30000);
  });

  it("memo boundary: identical-prop re-renders are far cheaper than unmemoized ones", () => {
    const doc = mixedRichDoc(1);
    const UPDATES = 5;

    function MemoHarness() {
      const [, force] = useState(0);
      return (
        <>
          <button type="button" onClick={() => force((n) => n + 1)} />
          {Array.from({ length: 100 }, (_, i) => (
            <ContentRenderer key={i} content="static" document={doc} />
          ))}
        </>
      );
    }
    const m = render(<MemoHarness />);
    const mBtn = m.container.querySelector("button")!;
    let m0 = performance.now();
    for (let i = 0; i < UPDATES; i++) {
      act(() => mBtn.click());
    }
    const memoMs = performance.now() - m0;
    m.unmount();

    // Control: same tree, but fresh document identity forces the memo
    // comparison to fail every time (child render functions re-execute).
    function ChurnHarness() {
      const [, force] = useState(0);
      return (
        <>
          <button type="button" onClick={() => force((n) => n + 1)} />
          {Array.from({ length: 100 }, (_, i) => (
            <ContentRenderer
              key={i}
              content="static"
              document={mixedRichDoc(i)}
            />
          ))}
        </>
      );
    }
    const c = render(<ChurnHarness />);
    const cBtn = c.container.querySelector("button")!;
    let c0 = performance.now();
    for (let i = 0; i < UPDATES; i++) {
      act(() => cBtn.click());
    }
    const churnMs = performance.now() - c0;
    c.unmount();
    // Memoized identical-prop updates stay an order cheaper than full child
    // re-renders — loose bound so jsdom noise cannot flake the gate.
    expect(memoMs).toBeLessThan(churnMs);
  });

  it("editor sync: the structural-equality classification stays cheap on a representative answer (typing path)", () => {
    // Every keystroke routes the parent-echoed document through one
    // contentDocumentsEqual walk (RichContentEditor sync effect). The walk is
    // O(answer size); a representative rich answer with marks, math, a list
    // and a table must classify far under a frame budget.
    const doc: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "结论：", marks: ["bold"] },
            { type: "inlineMath", latex: "a^2+b^2=c^2" },
            { type: "text", text: "成立" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "第一步" }],
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
                      content: [{ type: "text", text: "单元" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const mutated = structuredClone(doc);
    (
      mutated.content[0] as { content: Array<{ text?: string }> }
    ).content[2]!.text = "不成立";

    const EQUAL_WALKS = 200;
    const t0 = performance.now();
    for (let i = 0; i < EQUAL_WALKS; i++) {
      expect(contentDocumentsEqual(doc, doc)).toBe(true);
    }
    const equalMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < EQUAL_WALKS; i++) {
      expect(contentDocumentsEqual(doc, mutated)).toBe(false);
    }
    const diffMs = performance.now() - t1;

    // Loose catastrophic-regression bounds for jsdom; the measured numbers
    // feed the PR report.
    expect(equalMs).toBeLessThan(1000);
    expect(diffMs).toBeLessThan(1000);
  });
});
