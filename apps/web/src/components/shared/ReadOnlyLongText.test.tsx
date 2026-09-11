import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadOnlyLongText } from "./ReadOnlyLongText";

describe("ReadOnlyLongText", () => {
  it("renders plain text in a non-editable text container", () => {
    render(<ReadOnlyLongText>{"考生答案内容"}</ReadOnlyLongText>);
    expect(screen.getByText("考生答案内容").tagName).toBe("DIV");
    // Not a form control: a read-only display must not pose as an input.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps multiline content as one text node with newlines intact", () => {
    const { container } = render(
      <ReadOnlyLongText>{"line 1\nline 2\nline 3"}</ReadOnlyLongText>,
    );
    expect(container.querySelector("div")?.textContent).toBe(
      "line 1\nline 2\nline 3",
    );
    // white-space: pre-wrap is owned by the type-long-response recipe; the
    // component pins the recipe selection so the whitespace contract cannot
    // silently regress (recipeRegistry drift-tests the CSS property itself).
    expect(container.querySelector("div")).toHaveClass("type-long-response");
  });

  it("renders script-like input as literal text, creating no script element", () => {
    const { container } = render(
      <ReadOnlyLongText>{"<script>alert(1)</script>"}</ReadOnlyLongText>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });

  it("renders HTML-looking input as literal text with no HTML interpretation", () => {
    const { container } = render(
      <ReadOnlyLongText>{"<b>hello</b>"}</ReadOnlyLongText>,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>hello</b>");
  });

  it("contains long unbroken tokens without silent truncation", () => {
    const longToken = "x".repeat(160);
    const { container } = render(
      <ReadOnlyLongText>{longToken}</ReadOnlyLongText>,
    );
    const box = container.querySelector("div");
    expect(box).toHaveClass("break-words", "min-w-0");
    expect(box).not.toHaveClass("truncate");
    expect(box).toHaveTextContent(longToken);
  });

  it("owns the read-only well surface contract", () => {
    const { container } = render(<ReadOnlyLongText>{"text"}</ReadOnlyLongText>);
    expect(container.querySelector("div")).toHaveClass("surface-subtle");
  });

  it("renders rich children (ReactNode) without flattening them", () => {
    render(
      <ReadOnlyLongText>
        <p data-testid="rich-block">rich paragraph</p>
      </ReadOnlyLongText>,
    );
    expect(screen.getByTestId("rich-block").tagName).toBe("P");
  });

  it("forwards test ids and merges page-owned layout classes", () => {
    const { container } = render(
      <ReadOnlyLongText data-testid="answer-box" className="min-h-12">
        {"text"}
      </ReadOnlyLongText>,
    );
    const box = screen.getByTestId("answer-box");
    expect(box).toBe(container.querySelector("div"));
    expect(box).toHaveClass("min-h-12");
  });
});
