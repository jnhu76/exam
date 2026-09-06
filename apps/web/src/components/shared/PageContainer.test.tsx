import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer, type PageContainerRole } from "./PageContainer";

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
    ["candidate", "max-w-4xl"],
    ["exam-runtime", "max-w-7xl"],
  ] as const)("maps %s to its governed width", (role, widthClass) => {
    render(<PageContainer role={role}>{role}</PageContainer>);

    expect(screen.getByText(role)).toHaveClass("mx-auto", "w-full", widthClass);
  });

  it("keeps the role vocabulary closed at six roles (no admin-sparse)", () => {
    // `as string` on purpose: a removed role must not typecheck back in, and
    // the runtime table must not accept it either.
    const removedRole = "admin-sparse" as unknown as PageContainerRole;

    render(<PageContainer role={removedRole}>sparse</PageContainer>);

    // roleClasses[removedRole] is undefined → no width class is applied, so a
    // resurrected role degrades visibly instead of silently working.
    expect(screen.getByText("sparse")).not.toHaveClass("max-w-5xl");
    expect(screen.getByText("sparse").className).not.toContain("max-w-");
  });
});
