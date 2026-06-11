import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformSettingsForm } from "./PlatformSettingsForm";

describe("PlatformSettingsForm", () => {
  it("shows timezone select with placeholder", () => {
    render(<PlatformSettingsForm onSave={() => {}} />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("选择时区")).toBeInTheDocument();
  });

  it("shows branding fields in the form", () => {
    render(<PlatformSettingsForm onSave={() => {}} />);

    expect(screen.getByLabelText("产品标题")).toBeInTheDocument();
    expect(screen.getByLabelText("产品副标题")).toBeInTheDocument();
    expect(screen.getByLabelText("页脚说明")).toBeInTheDocument();
    expect(screen.getByLabelText("机构显示名")).toBeInTheDocument();
  });
});
