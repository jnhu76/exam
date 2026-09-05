import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pencil, Trash2, KeyRound } from "lucide-react";
import { RowActions, type RowActionDeclaration } from "./RowActions";

type Row = { id: string };

function decl(
  overrides: Partial<RowActionDeclaration<Row>> & { id: string; label: string },
): RowActionDeclaration<Row> {
  return { icon: Pencil, onSelect: vi.fn(), ...overrides };
}

function renderActions(
  actions: RowActionDeclaration<Row>[],
  row: Row = { id: "r1" },
) {
  return render(<RowActions actions={actions} row={row} />);
}

describe("RowActions representation contract", () => {
  it("renders every action inline when N ≤ 2 (icon-only, aria-label)", () => {
    const onSelect = vi.fn();
    renderActions([
      decl({ id: "edit", label: "编辑", onSelect }),
      decl({ id: "delete", label: "删除", icon: Trash2 }),
    ]);
    const group = screen.getByRole("group");
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    // Inline vocabulary is icon-only: no button carries visible text.
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b.textContent).toBe(""));
    // No kebab menu trigger exists.
    expect(
      screen.queryByRole("button", { name: "更多操作" }),
    ).not.toBeInTheDocument();
  });

  it("renders primary inline + kebab(rest) when N > 2", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderActions([
      decl({ id: "edit", label: "编辑" }),
      decl({
        id: "reset",
        label: "重置密码",
        icon: KeyRound,
        onSelect: onReset,
      }),
      decl({
        id: "disable",
        label: "禁用",
        tone: "destructive",
        confirm: { title: "禁用用户", description: "确定禁用该用户吗？" },
      }),
    ]);

    // Primary (first declared) stays inline; the only other inline control is
    // the kebab icon button.
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    const group = screen.getByRole("group");
    expect(group.querySelectorAll("button")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      await screen.findByRole("menuitem", { name: "重置密码" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "禁用" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    expect(
      screen.queryByRole("menuitem", { name: "编辑" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "重置密码" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith({ id: "r1" }));
  });

  it("honors an explicit primary declaration", async () => {
    const user = userEvent.setup();
    renderActions([
      decl({ id: "a", label: "甲" }),
      decl({ id: "b", label: "乙", primary: true }),
      decl({ id: "c", label: "丙" }),
    ]);
    expect(screen.getByRole("button", { name: "乙" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "甲" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      await screen.findByRole("menuitem", { name: "甲" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "丙" })).toBeInTheDocument();
  });

  it("keeps capability transitions stable: [A] → [A][B] → [A▾(B,C)]", async () => {
    const user = userEvent.setup();
    const base = [
      decl({ id: "a", label: "甲" }),
      decl({ id: "b", label: "乙" }),
      decl({ id: "c", label: "丙" }),
    ];
    const { rerender } = renderActions(base.slice(0, 1));
    expect(screen.getAllByRole("button")).toHaveLength(1);

    rerender(<RowActions actions={base.slice(0, 2)} row={{ id: "r1" }} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "更多操作" }),
    ).not.toBeInTheDocument();

    rerender(<RowActions actions={base} row={{ id: "r1" }} />);
    // A stays inline in the same position; B and C move into the kebab.
    const group = screen.getByRole("group");
    const [first] = group.querySelectorAll("button");
    expect(first).toHaveAttribute("data-action-id", "a");
    expect(
      screen.getByRole("button", { name: "更多操作" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.getAttribute("data-action-id"))).toEqual([
      "b",
      "c",
    ]);
  });

  it("keeps declaration-count geometry when an action is disabled", async () => {
    // N is the declaration count: disabling must not collapse the kebab back
    // to three inline buttons (the geometry invariant the actions column
    // width is derived from).
    const user = userEvent.setup();
    renderActions([
      decl({ id: "edit", label: "编辑" }),
      decl({ id: "reset", label: "重置密码", icon: KeyRound }),
      decl({ id: "disable", label: "禁用", disabled: true }),
    ]);
    const group = screen.getByRole("group");
    expect(group.querySelectorAll("button")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    const disableItem = await screen.findByRole("menuitem", { name: "禁用" });
    expect(disableItem).toHaveAttribute("aria-disabled", "true");
    expect(disableItem).toHaveAttribute("data-action-id", "disable");
  });

  it("surfaces a disabled reason as a focusable tooltip anchor", () => {
    renderActions([
      decl({
        id: "view",
        label: "查看",
        disabled: { reason: "考试未结束，暂不可查看" },
      }),
    ]);
    const anchor = screen.getByRole("group").querySelector("span[tabindex]");
    expect(anchor).toHaveAttribute("aria-label", "查看");
    expect(anchor?.getAttribute("tabIndex")).toBe("0");
    expect(screen.getByRole("button", { name: "查看" })).toBeDisabled();
  });
});

describe("RowActions confirmation semantics", () => {
  it("routes inline confirm actions through ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderActions([
      decl({
        id: "delete",
        label: "删除",
        icon: Trash2,
        tone: "destructive",
        confirm: {
          title: "删除课程",
          description: "确定删除该课程吗？",
          destructive: true,
        },
        onSelect: onDelete,
      }),
    ]);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("删除课程")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ id: "r1" }));
  });

  it("opens ConfirmDialog from a kebab item with confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderActions([
      decl({ id: "edit", label: "编辑" }),
      decl({ id: "reset", label: "重置密码", icon: KeyRound }),
      decl({
        id: "delete",
        label: "删除",
        icon: Trash2,
        tone: "destructive",
        confirm: { title: "删除字段", description: "确定删除该字段吗？" },
        onSelect: onDelete,
      }),
    ]);
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    expect(await screen.findByText("删除字段")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ id: "r1" }));
  });
});

describe("RowActions contract violations (dev)", () => {
  it("rejects more than one explicit primary", () => {
    expect(() =>
      renderActions([
        decl({ id: "a", label: "甲", primary: true }),
        decl({ id: "b", label: "乙", primary: true }),
      ]),
    ).toThrow(/at most one primary/);
  });

  it("rejects destructive tone without confirm", () => {
    expect(() =>
      renderActions([decl({ id: "a", label: "甲", tone: "destructive" })]),
    ).toThrow(/must declare confirm/);
  });
});
