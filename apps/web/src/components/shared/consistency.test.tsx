import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { PageHeader } from "./PageHeader";

describe("UI consistency rules", () => {
  describe("EmptyState", () => {
    it("has aria-hidden on icon wrapper", () => {
      const { container } = render(
        <EmptyState
          icon={<span data-testid="icon">📚</span>}
          title="空"
          description="无数据"
        />,
      );
      const iconWrapper = container.querySelector(".text-muted-foreground");
      expect(iconWrapper).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("ErrorState", () => {
    it("has role=alert", () => {
      render(<ErrorState message="出错了" />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  describe("LoadingState", () => {
    it("has role=status and aria-busy", () => {
      render(<LoadingState />);
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("PageHeader", () => {
    it("uses the semantic page-title recipe (not raw font-bold/semibold)", () => {
      const { container } = render(<PageHeader title="测试" />);
      const h1 = container.querySelector("h1");
      // Page title typography is owned by the type-page-title semantic recipe
      // (UI-RECIPE-1A), not by primitive font-weight utilities.
      expect(h1?.className).toContain("type-page-title");
      expect(h1?.className).not.toContain("font-bold");
      expect(h1?.className).not.toContain("font-semibold");
    });

    it("renders the description through the page-description recipe", () => {
      const { container } = render(
        <PageHeader title="测试" description="说明文字" />,
      );
      const p = container.querySelector("p");
      expect(p?.className).toContain("type-page-description");
    });
  });
});
