import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformSettingsForm } from "./PlatformSettingsForm";

describe("PlatformSettingsForm", () => {
  it("shows timezone as a select dropdown", () => {
    render(
      <PlatformSettingsForm
        defaultValues={{ timezone: "Asia/Shanghai" }}
        onSave={() => {}}
      />,
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    expect(screen.getAllByText("Asia/Shanghai").length).toBeGreaterThan(0);
  });

  it("shows branding fields in the form", () => {
    render(<PlatformSettingsForm defaultValues={{}} onSave={() => {}} />);

    expect(screen.getByLabelText("产品标题")).toBeInTheDocument();
    expect(screen.getByLabelText("产品副标题")).toBeInTheDocument();
    expect(screen.getByLabelText("页脚说明")).toBeInTheDocument();
    expect(screen.getByLabelText("机构显示名")).toBeInTheDocument();
  });
});
