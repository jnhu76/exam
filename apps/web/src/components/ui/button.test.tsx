import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("uses shared primary color for the default variant", () => {
    render(<Button>主要操作</Button>);

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

  it("distinguishes secondary buttons from outline buttons", () => {
    render(<Button variant="secondary">次要操作</Button>);

    expect(screen.getByRole("button", { name: "次要操作" })).toHaveClass(
      "bg-muted",
    );
    expect(screen.getByRole("button", { name: "次要操作" })).not.toHaveClass(
      "border",
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
