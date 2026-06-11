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

  it("can render without the status icon", () => {
    const { container } = render(
      <StatusBadge status="open" showIcon={false} />,
    );
    expect(screen.getByText("开放中")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
