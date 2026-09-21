import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("uses primary color for the primary variant", () => {
    render(<Button variant="primary">主要操作</Button>);

    expect(screen.getByRole("button", { name: "主要操作" })).toHaveClass(
      "bg-primary",
    );
  });

  it("keeps destructive actions on the danger color", () => {
    render(<Button variant="destructive">危险操作</Button>);

    expect(screen.getByRole("button", { name: "危险操作" })).toHaveClass(
      "bg-destructive",
    );
  });

  it("uses the solid primary treatment by default", () => {
    render(<Button>默认按钮</Button>);

    expect(screen.getByRole("button", { name: "默认按钮" })).toHaveClass(
      "bg-primary",
    );
    expect(screen.getByRole("button", { name: "默认按钮" })).toHaveClass(
      "text-primary-foreground",
    );
  });

  it("keeps icon actions at a 36px target and large mobile actions at 44px", () => {
    const { rerender } = render(<Button size="icon">图标操作</Button>);
    expect(screen.getByRole("button", { name: "图标操作" })).toHaveClass(
      "size-9",
    );

    rerender(<Button size="icon-lg">移动操作</Button>);
    expect(screen.getByRole("button", { name: "移动操作" })).toHaveClass(
      "size-11",
    );
  });

  it("renders the 6px primary-control radius across the whole size family (issue 582 D3)", () => {
    // rounded-md resolves to --radius-md (0.375rem = 6px) in the Tailwind
    // build. D3 froze the entire Button family — base plus every size that
    // declares its own radius — at 6px, matching Input/SelectTrigger/Textarea.
    const { rerender } = render(<Button>默认</Button>);
    expect(screen.getByRole("button", { name: "默认" })).toHaveClass(
      "rounded-md",
    );
    expect(screen.getByRole("button", { name: "默认" })).not.toHaveClass(
      "rounded-lg",
    );

    for (const size of ["xs", "sm", "lg", "icon", "icon-xs"] as const) {
      rerender(<Button size={size}>按钮</Button>);
      expect(screen.getByRole("button", { name: "按钮" })).toHaveClass(
        "rounded-md",
      );
      expect(screen.getByRole("button", { name: "按钮" })).not.toHaveClass(
        "rounded-lg",
      );
    }
  });

  it("defaults to type button to avoid accidental form submit", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button>普通操作</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "普通操作" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("preserves explicit submit buttons", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">提交</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
