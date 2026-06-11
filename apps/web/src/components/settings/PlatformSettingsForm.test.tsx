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

  it("fills form with initialValues", () => {
    render(
      <PlatformSettingsForm
        initialValues={{
          productName: "My Platform",
          productSubtitle: "My Subtitle",
          footerText: "My Footer",
          organizationDisplayName: "My Org",
        }}
        onSave={() => {}}
      />,
    );

    expect(screen.getByLabelText("产品标题")).toHaveValue("My Platform");
    expect(screen.getByLabelText("产品副标题")).toHaveValue("My Subtitle");
    expect(screen.getByLabelText("页脚说明")).toHaveValue("My Footer");
    expect(screen.getByLabelText("机构显示名")).toHaveValue("My Org");
  });

  it("updates form when initialValues change", () => {
    const { rerender } = render(
      <PlatformSettingsForm
        initialValues={{ productName: "V1" }}
        onSave={() => {}}
      />,
    );

    expect(screen.getByLabelText("产品标题")).toHaveValue("V1");

    rerender(
      <PlatformSettingsForm
        initialValues={{ productName: "V2" }}
        onSave={() => {}}
      />,
    );

    expect(screen.getByLabelText("产品标题")).toHaveValue("V2");
  });
});
