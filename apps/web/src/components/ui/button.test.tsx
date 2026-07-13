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
