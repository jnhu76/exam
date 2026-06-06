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
    it("uses font-semibold not font-bold", () => {
      const { container } = render(<PageHeader title="测试" />);
      const h1 = container.querySelector("h1");
      expect(h1?.className).toContain("font-semibold");
      expect(h1?.className).not.toContain("font-bold");
    });
  });
});
