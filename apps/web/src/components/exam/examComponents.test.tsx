import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamTimer } from "./ExamTimer";
import { QuestionNav } from "./QuestionNav";
import { TrueFalseInput } from "./TrueFalseInput";

afterEach(() => {
  vi.useRealTimers();
});

describe("QuestionNav", () => {
  it("renders question states and selects a question", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionNav
        questions={[{ id: "q1" }, { id: "q2" }, { id: "q3" }]}
        states={["unanswered", "answered", "flagged"]}
        currentIndex={0}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("○")).toBeInTheDocument();
    expect(screen.getByText("●")).toBeInTheDocument();
    expect(screen.getByText("◉")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "第 2 题" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("uses two columns for long exams", () => {
    const questions = Array.from({ length: 50 }, (_, index) => ({
      id: `q${index}`,
    }));
    const { container } = render(
      <QuestionNav
        questions={questions}
        states={[]}
        currentIndex={0}
        onSelect={() => {}}
      />,
    );

    expect(container.firstChild).toHaveClass("grid-cols-2");
  });
});

describe("TrueFalseInput", () => {
  it("returns a boolean answer", async () => {
    const onChange = vi.fn();
    render(<TrueFalseInput value={undefined} onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "正确" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ExamTimer", () => {
  it("submits when the server deadline is reached", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const onTimeout = vi.fn();
    render(
      <ExamTimer deadlineAt="2026-06-01T00:00:01Z" onTimeout={onTimeout} />,
    );

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
