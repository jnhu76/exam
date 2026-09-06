import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
  DataTableOverflowText,
} from "./DataTableContract";

describe("DataTableContract", () => {
  it("emits semantic column roles and derived overflow/priority", () => {
    render(
      <table>
        <DataTableColumns
          columns={[
            { role: "primary-text" },
            { role: "duration" },
            { role: "actions" },
          ]}
        />
        <thead>
          <tr>
            <DataTableHead role="primary-text">考试名称</DataTableHead>
            <DataTableHead role="duration">时长</DataTableHead>
            <DataTableHead role="actions">操作</DataTableHead>
          </tr>
        </thead>
        <tbody>
          <tr>
            <DataTableCell role="primary-text">安全培训考试</DataTableCell>
            <DataTableCell role="duration">90分钟</DataTableCell>
            <DataTableCell role="actions">查看</DataTableCell>
          </tr>
        </tbody>
      </table>,
    );

    expect(screen.getByText("安全培训考试")).toHaveAttribute(
      "data-column-overflow",
      "wrap",
    );
    expect(screen.getByText("90分钟")).toHaveAttribute(
      "data-column-overflow",
      "nowrap",
    );
    expect(screen.getByText("查看")).toHaveAttribute(
      "data-column-overflow",
      "nowrap",
    );
    expect(
      document.querySelector('col[data-column-role="duration"]'),
    ).toHaveAttribute("data-column-width", "duration");
    expect(screen.getByText("安全培训考试")).toHaveAttribute(
      "data-column-priority",
      "high",
    );
  });

  it("lets a single declaration override overflow/priority", () => {
    render(
      <table>
        <DataTableColumns
          columns={[
            { role: "description", overflow: "line-clamp-2", priority: "low" },
          ]}
        />
        <tbody>
          <tr>
            <DataTableCell
              role="description"
              overflow="line-clamp-2"
              priority="low"
            >
              简介
            </DataTableCell>
          </tr>
        </tbody>
      </table>,
    );

    const cell = screen.getByText("简介");
    expect(cell).toHaveAttribute("data-column-overflow", "line-clamp-2");
    expect(cell).toHaveAttribute("data-column-priority", "low");
    expect(
      document.querySelector('col[data-column-role="description"]'),
    ).toHaveAttribute("data-column-overflow", "line-clamp-2");
  });

  it("keeps tag lists flexible while short identifiers stay atomic", () => {
    render(
      <table>
        <tbody>
          <tr>
            <DataTableCell role="tag-list">safety equipment</DataTableCell>
            <DataTableCell role="short-id">CERT-2026-001</DataTableCell>
          </tr>
        </tbody>
      </table>,
    );

    expect(screen.getByText("safety equipment")).toHaveAttribute(
      "data-column-overflow",
      "wrap",
    );
    expect(screen.getByText("CERT-2026-001")).toHaveAttribute(
      "data-column-overflow",
      "truncate-middle",
    );
  });

  it("presents truncated values with the full value accessible", () => {
    const long = "550e8400-e29b-41d4-a716-446655440000";
    render(<DataTableOverflowText mode="truncate-middle" value={long} />);

    const el = screen.getByText(/550e84…0000/);
    expect(el).toHaveAttribute("aria-label", long);
    expect(el).toHaveAttribute("title", long);
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el).toHaveAttribute("data-overflow-policy", "truncate-middle");
  });
});
