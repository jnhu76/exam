import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("passes the archetype and negotiated tier through to the table region", () => {
    render(
      <DataWorkbench
        archetype="management-list"
        desktopTable={<table aria-label="题目表" />}
      />,
    );
    const region = screen
      .getByRole("table", { name: "题目表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    // Unmeasured jsdom container → deterministic minTier fallback.
    expect(region).toHaveAttribute("data-table-archetype", "management-list");
    expect(region).toHaveAttribute("data-table-tier", "compact");
  });

  it("T1/T5: mobile cards are the responsive owner's mobile branch, outside the desktop measurement branch", () => {
    render(
      <DataWorkbench
        desktopTable={<table aria-label="桌面表" />}
        mobileList={<div>移动卡片内容</div>}
      />,
    );
    // Representation ownership: the mobile content lives in the responsive
    // mobile region, the desktop table in the responsive desktop region.
    const mobileRegion = document.querySelector(
      '[data-slot="responsive-mobile-region"]',
    )!;
    const desktopRegion = document.querySelector(
      '[data-slot="responsive-desktop-region"]',
    )!;
    expect(mobileRegion.contains(screen.getByText("移动卡片内容"))).toBe(true);
    expect(
      desktopRegion.contains(screen.getByRole("table", { name: "桌面表" })),
    ).toBe(true);

    // R2 measurement boundary: admin-table-shell (the useOverflowObservation
    // scrollRef node) owns the desktop table only — mobile content must not
    // be a descendant of the measurement node.
    const shell = document.querySelector('[data-slot="admin-table-shell"]')!;
    expect(shell.contains(screen.getByRole("table", { name: "桌面表" }))).toBe(
      true,
    );
    expect(shell.contains(screen.getByText("移动卡片内容"))).toBe(false);
    expect(
      shell.querySelectorAll('[data-slot="responsive-mobile-region"]').length,
    ).toBe(0);
    // The measurement node itself is the desktop branch: when mobile is
    // enabled, admin-table-shell sits inside the responsive desktop region.
    expect(desktopRegion.contains(shell)).toBe(true);
  });

  it("T2: management-list without mobileList renders desktop-only at every viewport", () => {
    render(<DataWorkbench desktopTable={<table aria-label="桌面表" />} />);
    // No responsive owner is mounted, so the desktop region is not wrapped
    // in the lg-gated desktop region — it cannot disappear below lg (no
    // blank mobile region).
    expect(
      document.querySelector('[data-slot="responsive-desktop-region"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-slot="responsive-mobile-region"]'),
    ).toBeNull();
    expect(
      screen
        .getByRole("table", { name: "桌面表" })
        .closest('[data-slot="admin-table-shell"]'),
    ).not.toBeNull();
  });

  it("T3: fails loud when mobileList meets a non-management archetype (DEV/test)", () => {
    expect(() =>
      render(
        <DataWorkbench
          archetype="log-diagnostic"
          desktopTable={<table aria-label="桌面表" />}
          mobileList={<div>移动卡片内容</div>}
        />,
      ),
    ).toThrow(/management-list mechanism/);
  });

  it("R1 production fallback: illegal log-diagnostic + mobileList keeps the desktop representation", () => {
    vi.stubEnv("DEV", false);
    try {
      render(
        <DataWorkbench
          archetype="log-diagnostic"
          desktopTable={<table aria-label="桌面表" />}
          mobileList={<div>移动卡片内容</div>}
        />,
      );
      // No responsive owner mounts at all: the illegal mobile slot never
      // renders anywhere and the desktop table stays the representation at
      // every viewport — illegal input does not alter production semantics.
      expect(
        document.querySelector('[data-slot="responsive-mobile-region"]'),
      ).toBeNull();
      expect(
        document.querySelector('[data-slot="responsive-desktop-region"]'),
      ).toBeNull();
      expect(screen.queryByText("移动卡片内容")).toBeNull();
      expect(screen.getByRole("table", { name: "桌面表" })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
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
