import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SingleChoiceInput } from "./SingleChoiceInput";

const options = [
  { id: "A", content: "Option A" },
  { id: "B", content: "Option B" },
  { id: "C", content: "Option C" },
];

describe("SingleChoiceInput", () => {
  it("renders all options", () => {
    render(
      <SingleChoiceInput
        options={options}
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(screen.getByText("Option C")).toBeInTheDocument();
  });

  it("calls onChange when an option is clicked", async () => {
    const onChange = vi.fn();
    render(
      <SingleChoiceInput
        options={options}
        value={undefined}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(onChange).toHaveBeenCalledWith("B");
  });

  it("highlights the selected option", () => {
    const { container } = render(
      <SingleChoiceInput options={options} value="A" onChange={() => {}} />,
    );
    const labels = container.querySelectorAll("label");
    expect(labels[0]!.className).toContain("border-primary");
    expect(labels[1]!.className).not.toContain("border-primary");
  });
});
