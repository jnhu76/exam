import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefinitionList } from "./DefinitionList";

describe("DefinitionList", () => {
  it("renders real definition semantics: dl > div > dt + dd", () => {
    const { container } = render(
      <DefinitionList items={[{ label: "考试名称", value: "期中考试" }]} />,
    );
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    const row = dl?.firstElementChild;
    expect(row?.tagName).toBe("DIV");
    expect(row?.querySelector("dt")?.tagName).toBe("DT");
    expect(row?.querySelector("dd")?.tagName).toBe("DD");
    expect(screen.getByText("考试名称").tagName).toBe("DT");
    expect(screen.getByText("期中考试").tagName).toBe("DD");
  });

  it("renders one row per item, preserving declaration order", () => {
    const { container } = render(
      <DefinitionList
        items={[
          { label: "开始时间", value: "2026-09-11 08:00" },
          { label: "时长", value: "60 分钟" },
          { label: "状态", value: "已发布" },
        ]}
      />,
    );
    const rows = container.querySelector("dl")?.children ?? [];
    expect(rows).toHaveLength(3);
    const labels = Array.from(rows).map(
      (row) => row.querySelector("dt")?.textContent,
    );
    expect(labels).toEqual(["开始时间", "时长", "状态"]);
  });

  it("renders ReactNode values without flattening them", () => {
    render(
      <DefinitionList
        items={[
          {
            label: "状态",
            value: <span data-testid="item-status">进行中</span>,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("item-status").tagName).toBe("SPAN");
    expect(screen.getByTestId("item-status")).toHaveTextContent("进行中");
  });

  it("keeps the label/value typography contract owned by the component", () => {
    const { container } = render(
      <DefinitionList items={[{ label: "标签", value: "值" }]} />,
    );
    expect(container.querySelector("dt")).toHaveClass("type-metadata");
    expect(container.querySelector("dd")).toHaveClass("type-body");
  });

  it("contains long unbroken values without silent truncation", () => {
    const longToken = "a".repeat(120);
    const { container } = render(
      <DefinitionList
        items={[{ label: "ID", value: `3f2504e0-4f89-11d3-9a0c-${longToken}` }]}
      />,
    );
    const dd = container.querySelector("dd");
    // Containment contract: the value box may wrap tokens, never truncate.
    expect(dd).toHaveClass("break-words");
    expect(dd).not.toHaveClass("truncate");
    expect(dd).toHaveTextContent(`3f2504e0-4f89-11d3-9a0c-${longToken}`);
  });

  it("keeps rows shrinkable so containment works inside grids", () => {
    const { container } = render(
      <DefinitionList items={[{ label: "标签", value: "值" }]} />,
    );
    expect(container.querySelector("dl")?.firstElementChild).toHaveClass(
      "min-w-0",
    );
  });

  it("lets the page own list layout via className without losing semantics", () => {
    const { container } = render(
      <DefinitionList
        className="grid gap-x-6 gap-y-2 sm:grid-cols-2"
        items={[{ label: "标签", value: "值" }]}
      />,
    );
    const dl = container.querySelector("dl");
    // Layout is page-owned structure: the class string forwards verbatim and
    // the definition semantics are untouched.
    expect(dl).toHaveClass("grid", "sm:grid-cols-2");
    expect(dl?.querySelector("dt")).not.toBeNull();
    expect(dl?.querySelector("dd")).not.toBeNull();
  });

  it("imposes no layout opinion when the page passes none", () => {
    const { container } = render(
      <DefinitionList items={[{ label: "标签", value: "值" }]} />,
    );
    expect(container.querySelector("dl")?.className).toBe("");
  });

  it("forwards page-owned structural classes to the row", () => {
    const { container } = render(
      <DefinitionList
        items={[{ label: "标签", value: "值", className: "sm:col-span-2" }]}
      />,
    );
    expect(container.querySelector("dl")?.firstElementChild).toHaveClass(
      "sm:col-span-2",
    );
  });
});
