import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer } from "./PageContainer";

describe("PageContainer", () => {
  it("exposes deterministic role ownership", () => {
    render(<PageContainer role="admin-wide">内容</PageContainer>);

    expect(screen.getByText("内容")).toHaveAttribute("data-role", "admin-wide");
  });

  it.each([
    ["admin-standard", "max-w-7xl"],
    ["admin-wide", "max-w-screen-2xl"],
    ["form", "max-w-4xl"],
    ["auth", "max-w-md"],
    ["exam-runtime", "max-w-7xl"],
  ] as const)("maps %s to its governed width", (role, widthClass) => {
    render(<PageContainer role={role}>{role}</PageContainer>);

    expect(screen.getByText(role)).toHaveClass("mx-auto", "w-full", widthClass);
  });
});
