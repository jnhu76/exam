import { render, screen } from "@testing-library/react";
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
    expect(badge.className).toContain("bg-primary");
  });

  it("uses the compact rectangular status geometry", () => {
    const { container } = render(<StatusBadge status="published" />);
    const badge = container.firstElementChild as HTMLElement;

    expect(badge).toHaveClass("h-6", "rounded-md", "px-2");
    expect(badge).not.toHaveClass("rounded-full");
  });
});
