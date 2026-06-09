import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultipleChoiceInput } from "./MultipleChoiceInput";

const options = [
  { id: "A", content: "Option A" },
  { id: "B", content: "Option B" },
  { id: "C", content: "Option C" },
];

describe("MultipleChoiceInput", () => {
  it("renders all options", () => {
    render(
      <MultipleChoiceInput options={options} value={[]} onChange={() => {}} />,
    );
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(screen.getByText("Option C")).toBeInTheDocument();
  });

  it("selects an option and calls onChange with sorted array", async () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceInput options={options} value={[]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Option C" }));
    expect(onChange).toHaveBeenCalledWith(["C"]);
  });

  it("toggles an option off", async () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceInput
        options={options}
        value={["A", "B"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Option A" }));
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });

  it("highlights selected options", () => {
    const { container } = render(
      <MultipleChoiceInput
        options={options}
        value={["B"]}
        onChange={() => {}}
      />,
    );
    const labels = container.querySelectorAll("label");
    expect(labels[0]!.className).not.toContain("border-primary");
    expect(labels[1]!.className).toContain("border-primary");
  });
});
