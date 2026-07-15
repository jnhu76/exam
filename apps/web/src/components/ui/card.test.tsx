import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";

describe("Card", () => {
  it("owns a clean bordered surface without business elevation", () => {
    render(<Card>内容</Card>);

    const card = screen.getByText("内容");
    expect(card).toHaveClass("border", "bg-card", "rounded-lg");
    expect(card.className).not.toMatch(/(?:^|\s)shadow-/);
  });
});
