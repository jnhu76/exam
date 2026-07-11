import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldError } from "./FieldError";

describe("FieldError", () => {
  it("renders nothing when children are falsy", () => {
    const { container } = render(<FieldError />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders an empty message node when children are an empty string", () => {
    // An empty string is a falsy ReactNode; FieldError treats it as "no error".
    const { container } = render(<FieldError>{""}</FieldError>);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("renders role=alert with the message when children are truthy", () => {
    render(<FieldError>答案不能为空</FieldError>);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("答案不能为空");
    expect(alert.tagName).toBe("P");
  });

  it("applies the canonical field-error class contract", () => {
    render(<FieldError>无效</FieldError>);
    const alert = screen.getByRole("alert");
    // Canonical authority-owned recipe: destructive + xs + mt-1 spacing.
    expect(alert).toHaveClass("text-destructive", "text-xs", "mt-1");
  });

  it("does not forward a caller-supplied id when children are falsy", () => {
    // When there is no error, no node renders, so no id is reserved in the DOM.
    // This protects aria-describedby consumers from a dangling id reference.
    const { container } = render(<FieldError id="score-error" />);
    expect(container.querySelector("#score-error")).not.toBeInTheDocument();
  });

  it("forwards a caller-supplied id to the root element when children are truthy", () => {
    render(<FieldError id="score-error">无效</FieldError>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("id", "score-error");
  });

  it("preserves the role=alert announcement semantic when an id is supplied", () => {
    render(<FieldError id="score-error">无效</FieldError>);
    // role=alert is authority-owned and must not be removable via the id prop.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
