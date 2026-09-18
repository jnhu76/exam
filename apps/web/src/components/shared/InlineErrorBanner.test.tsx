import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineErrorBanner } from "./InlineErrorBanner";

describe("InlineErrorBanner", () => {
  it("renders the message as a div with role=alert", () => {
    render(<InlineErrorBanner>保存失败</InlineErrorBanner>);
    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("保存失败");
    expect(banner.tagName).toBe("DIV");
  });

  it("applies the canonical destructive banner class contract", () => {
    render(<InlineErrorBanner>失败</InlineErrorBanner>);
    const banner = screen.getByRole("alert");
    // Canonical authority-owned recipe: attention surface (radius) + border
    // geometry + the semantic feedback tone layer owning the destructive
    // color triple (feedback/recipes.css, issue 577 M4).
    expect(banner).toHaveClass("surface-attention", "border");
    expect(banner).toHaveAttribute("data-feedback-tone", "destructive");
  });

  it("owns role=alert and does not accept a caller role override", () => {
    // The authority fixes role=alert; there is no role prop on the API.
    render(<InlineErrorBanner>x</InlineErrorBanner>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("merges a caller-supplied className after the canonical recipe", () => {
    render(<InlineErrorBanner className="mt-4">x</InlineErrorBanner>);
    const banner = screen.getByRole("alert");
    // Caller className is appended (tailwind-merge semantics via cn), so the
    // canonical classes remain and the caller utility is present.
    expect(banner).toHaveClass("surface-attention", "mt-4");
    expect(banner).toHaveAttribute("data-feedback-tone", "destructive");
  });

  it("renders structured children, not just a string message", () => {
    render(
      <InlineErrorBanner>
        <span>操作失败</span>
      </InlineErrorBanner>,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toContainHTML("<span>操作失败</span>");
  });
});
