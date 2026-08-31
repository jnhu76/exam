import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionRenderer } from "./QuestionRenderer";
import { isContentDocumentV1 } from "@exam/domain";

/**
 * P3-MOD-P0-2 — text_response rendering.
 *
 * QuestionRenderer must dispatch a `text_response` question to a textarea
 * (TextResponseInput). Newlines must be preserved on change.
 */

const baseQuestion = {
  originalQuestionId: "q-text",
  content: "请阐述你的观点",
  contentDocument: null,
  answerMode: "plain" as const,
  attachments: [],
  options: [],
  score: 20,
  gradingRule: {
    multiSelectScoring: "all_correct_full" as const,
    fillBlankMatchMode: "exact" as const,
  },
  order: 0,
};

describe("QuestionRenderer — text_response", () => {
  it("renders a textarea for a text_response question", () => {
    render(
      <QuestionRenderer
        question={{ ...baseQuestion, type: "text_response" }}
        answer={undefined}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("preserves newlines in the rendered value and reports changes verbatim", async () => {
    const onChange = vi.fn();
    render(
      <QuestionRenderer
        question={{ ...baseQuestion, type: "text_response" }}
        answer={"line one\nline two\nline three"}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Restore: newlines present in the value prop are preserved verbatim —
    // no normalization, no trimming, no collapse.
    expect(textarea.value).toBe("line one\nline two\nline three");

    // Save: typing a normal character appends to the existing multiline
    // value and reports the full string through onChange.
    const user = userEvent.setup();
    await user.type(textarea, "x");
    expect(onChange).toHaveBeenLastCalledWith(
      "line one\nline two\nline threex",
    );
  });

  it("renders the textarea read-only when disabled (post-submit lock)", () => {
    render(
      <QuestionRenderer
        question={{ ...baseQuestion, type: "text_response" }}
        answer={"submitted answer"}
        onChange={() => {}}
        disabled
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute("readonly");
    // The submitted value is rendered verbatim — no transformation.
    expect(textarea.value).toBe("submitted answer");
  });

  it("does not use dangerouslySetInnerHTML (XSS-safe pure text content)", () => {
    const { container } = render(
      <QuestionRenderer
        question={{ ...baseQuestion, type: "text_response" }}
        answer={"<script>alert(1)</script>"}
        onChange={() => {}}
      />,
    );

    // No script element is injected.
    expect(container.querySelector("script")).toBeNull();
    // The literal string is rendered as text, not HTML.
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});

describe("QuestionRenderer — rich text_response (issue 301)", () => {
  it("mounts the lazy rich editor when answerMode is rich and emits a canonical document", async () => {
    const onChange = vi.fn();
    render(
      <QuestionRenderer
        question={{
          ...baseQuestion,
          type: "text_response",
          answerMode: "rich",
        }}
        answer={undefined}
        onChange={onChange}
      />,
    );
    // Lazy chunk resolves and Tiptap mounts its editable surface.
    const editor = await screen.findByRole("textbox", {}, { timeout: 5000 });
    console.log("DEBUG-HTML:", editor.outerHTML.slice(0, 400));

    // Any transaction (here: the mount/focus transaction jsdom produces)
    // must surface a canonical ContentDocumentV1 — never raw Tiptap JSON.
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    for (const [emitted] of onChange.mock.calls) {
      expect(isContentDocumentV1(emitted)).toBe(true);
    }
  }, 15000);

  it("upgrades a legacy plain-string draft into the editor instead of dropping it", async () => {
    render(
      <QuestionRenderer
        question={{
          ...baseQuestion,
          type: "text_response",
          answerMode: "rich",
        }}
        answer={"旧草稿"}
        onChange={() => {}}
      />,
    );
    const editor = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("ProseMirror surface not mounted yet");
      return el;
    });
    expect(editor.textContent).toContain("旧草稿");
  }, 15000);

  it("keeps the plain textarea when answerMode is plain", () => {
    render(
      <QuestionRenderer
        question={{
          ...baseQuestion,
          type: "text_response",
          answerMode: "plain",
        }}
        answer={undefined}
        onChange={() => {}}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.getAttribute("contenteditable")).toBeNull();
  });
});

describe("QuestionRenderer — mount isolation (issue 301)", () => {
  it("never mounts an editor surface for objective questions, even with rich options", () => {
    render(
      <QuestionRenderer
        question={
          {
            ...baseQuestion,
            type: "single_choice",
            options: [
              { id: "a", content: "A", contentDocument: null },
              { id: "b", content: "B", contentDocument: null },
            ],
          } as never
        }
        answer={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(document.querySelector(".ProseMirror")).toBeNull();
  });

  it("never mounts an editor for a rich PROMPT (READ path renders statically)", async () => {
    const { ContentDocumentRenderer } =
      await import("@/components/shared/content/ContentDocumentRenderer");
    expect(ContentDocumentRenderer).toBeDefined();
    render(
      <QuestionRenderer
        question={
          {
            ...baseQuestion,
            type: "text_response",
            contentDocument: {
              docVersion: 1,
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "rich prompt" }],
                },
              ],
            },
          } as never
        }
        answer={undefined}
        onChange={() => {}}
      />,
    );
    // The prompt itself is not rendered by QuestionRenderer (owned by the
    // page), so no editor may appear for prompt display either.
    expect(document.querySelector(".ProseMirror")).toBeNull();
  });
});
