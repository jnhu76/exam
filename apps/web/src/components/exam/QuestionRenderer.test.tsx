import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionRenderer } from "./QuestionRenderer";

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
