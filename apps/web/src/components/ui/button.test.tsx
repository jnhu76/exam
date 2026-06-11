import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
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
