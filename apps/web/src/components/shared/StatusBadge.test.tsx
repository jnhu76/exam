import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders known status labels from centralized metadata", () => {
    render(<StatusBadge status="published" />);
    expect(screen.getByText("已发布")).toBeInTheDocument();
  });

  it("renders the fallback label for unknown statuses", () => {
    render(<StatusBadge status="unexpected" />);
    expect(screen.getByText("未知")).toBeInTheDocument();
  });

  it("defaults to text-only for ordinary statuses (published has no icon)", () => {
    const { container } = render(<StatusBadge status="published" />);
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows an icon by default for allowlisted live/urgent statuses (critical)", () => {
    const { container } = render(<StatusBadge status="critical" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows an icon by default for misconduct_serious", () => {
    const { container } = render(<StatusBadge status="misconduct_serious" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("explicit showIcon={true} forces an icon on an ordinary status", () => {
    const { container } = render(<StatusBadge status="open" showIcon={true} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("explicit showIcon={false} hides an icon on an allowlisted status", () => {
    const { container } = render(
      <StatusBadge status="critical" showIcon={false} />,
    );
    expect(screen.queryByText("严重")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("preserves tone and label semantics (published stays primary tone)", () => {
    const { container } = render(<StatusBadge status="published" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.getAttribute("data-status-tone")).toBe("primary");
    expect(badge.getAttribute("data-slot")).toBe("status-badge");
  });

  it("uses the compact rectangular status geometry", () => {
    const { container } = render(<StatusBadge status="published" />);
    const badge = container.firstElementChild as HTMLElement;

    expect(badge).toHaveClass("rounded-md", "px-2");
    expect(badge).toHaveAttribute("data-status-geometry", "compact");
    expect(badge).toHaveClass("border");
    expect(badge).not.toHaveClass("rounded-full");
  });

  it("keeps the frozen 22px badge height in its recipe owner (issue 582 D5)", () => {
    // D5 is a KEEP-AS-BUILT decision: badge/recipes.css owns the governed
    // height (1.375rem = 22px) and the component must not re-declare it.
    const here = dirname(fileURLToPath(import.meta.url));
    const badgeRecipes = readFileSync(
      join(here, "..", "..", "badge", "recipes.css"),
      "utf8",
    );
    expect(badgeRecipes).toMatch(
      /\[data-slot="status-badge"\]\s*\{[^}]*height:\s*1\.375rem/,
    );
  });
});
