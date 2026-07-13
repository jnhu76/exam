import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "./DataTableContract";

describe("DataTableContract", () => {
  it("emits semantic column roles and wrap policies", () => {
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
      "data-column-wrap",
      "flexible",
    );
    expect(screen.getByText("90分钟")).toHaveAttribute(
      "data-column-wrap",
      "atomic",
    );
    expect(screen.getByText("查看")).toHaveAttribute(
      "data-column-wrap",
      "atomic",
    );
    expect(
      document.querySelector('col[data-column-role="duration"]'),
    ).toHaveAttribute("data-column-width", "duration");
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
      "data-column-wrap",
      "flexible",
    );
    expect(screen.getByText("CERT-2026-001")).toHaveAttribute(
      "data-column-wrap",
      "atomic",
    );
  });
});
