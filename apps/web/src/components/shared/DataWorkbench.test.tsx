import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DataWorkbench,
  DataWorkbenchToolbar,
  DataWorkbenchFooter,
} from "./DataWorkbench";

function setScrollMetrics(
  element: HTMLElement,
  metrics: { clientWidth: number; scrollWidth: number; scrollLeft: number },
) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, get: () => metrics.clientWidth },
    scrollWidth: { configurable: true, get: () => metrics.scrollWidth },
    scrollLeft: {
      configurable: true,
      get: () => metrics.scrollLeft,
      set: (value: number) => {
        metrics.scrollLeft = value;
      },
    },
  });
}

describe("DataWorkbench", () => {
  it("renders one continuous shell with toolbar, table, and footer as regions", () => {
    render(
      <DataWorkbench
        toolbar={
          <DataWorkbenchToolbar>
            <button type="button">搜索</button>
          </DataWorkbenchToolbar>
        }
        desktopTable={<table aria-label="题目表" />}
        footer={
          <DataWorkbenchFooter>
            <span>共 0 条</span>
          </DataWorkbenchFooter>
        }
      />,
    );

    const shell = screen
      .getByRole("button", { name: "搜索" })
      .closest('[data-slot="data-workbench"]');
    expect(shell).toHaveClass("surface-content", "overflow-hidden");
    // toolbar + footer are both direct-ish regions inside the single shell.
    expect(shell!.contains(screen.getByRole("button", { name: "搜索" }))).toBe(
      true,
    );
    expect(shell!.contains(screen.getByText("共 0 条"))).toBe(true);
    expect(shell!.contains(screen.getByRole("table", { name: "题目表" }))).toBe(
      true,
    );
  });

  it("owns local overflow on the admin-table-shell scroll region", () => {
    render(<DataWorkbench desktopTable={<table aria-label="题目表" />} />);
    const region = screen
      .getByRole("table", { name: "题目表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    expect(region).toHaveAttribute("data-overflow-owner", "local");
    expect(region).toHaveAttribute("data-overflowing", "false");
  });

  it("passes actions-density and min-table-width through to the table region", () => {
    render(
      <DataWorkbench
        actionsDensity="wide"
        minTableWidth="compact"
        desktopTable={<table aria-label="题目表" />}
      />,
    );
    const region = screen
      .getByRole("table", { name: "题目表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    expect(region).toHaveAttribute("data-actions-density", "wide");
    expect(region).toHaveAttribute("data-table-min-width", "compact");
  });

  it("keeps the mobile list OUTSIDE the admin-table-shell region", () => {
    render(
      <DataWorkbench
        desktopTable={<table aria-label="桌面表" />}
        mobileList={<div>移动卡片内容</div>}
      />,
    );
    const region = screen
      .getByRole("table", { name: "桌面表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    // mobile content lives in the workbench shell but NOT inside the desktop
    // table scroll region, so a query scoped to admin-table-shell matches only
    // desktop content.
    expect(region.contains(screen.getByText("移动卡片内容"))).toBe(false);
    const workbench = screen
      .getByRole("table", { name: "桌面表" })
      .closest('[data-slot="data-workbench"]');
    expect(workbench!.contains(screen.getByText("移动卡片内容"))).toBe(true);
  });

  it("surfaces scroll affordances when the table overflows", () => {
    render(<DataWorkbench desktopTable={<table aria-label="可滚动表" />} />);
    const region = screen
      .getByRole("table", { name: "可滚动表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    const metrics = { clientWidth: 500, scrollWidth: 900, scrollLeft: 0 };
    setScrollMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));

    expect(region).toHaveAttribute("data-overflowing", "true");
    expect(region).toHaveAttribute("data-scroll-start", "true");
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).toBeInTheDocument();

    metrics.scrollLeft = 400;
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-end", "true");
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).not.toBeInTheDocument();
  });
});
