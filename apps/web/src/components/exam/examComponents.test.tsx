import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamTimer } from "./ExamTimer";
import { QuestionNav } from "./QuestionNav";
import { TrueFalseInput } from "./TrueFalseInput";
import { QuestionRenderer } from "./QuestionRenderer";

afterEach(() => {
  vi.useRealTimers();
});

describe("QuestionRenderer", () => {
  it("renders fallback for unknown question type", () => {
    render(
      <QuestionRenderer
        question={
          {
            type: "unknown_type",
            content: "test",
            options: [],
          } as never
        }
        answer={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/不支持的题目类型/)).toBeInTheDocument();
  });

  it("renders true_false question", () => {
    render(
      <QuestionRenderer
        question={{
          type: "true_false",
          content: "Is 1+1=2?",
          options: [],
          attachments: [],
          score: 10,
          order: 0,
          originalQuestionId: "q1",
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
        }}
        answer={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("正确")).toBeInTheDocument();
    expect(screen.getByText("错误")).toBeInTheDocument();
  });
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
    await userEvent.click(
      screen.getByRole("button", { name: "第 2 题，已作答" }),
    );
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

  it("highlights selected option", () => {
    const onChange = vi.fn();
    render(<TrueFalseInput value={true} onChange={onChange} />);
    const correctRadio = screen.getByRole("radio", { name: "正确" });
    expect(correctRadio).toBeChecked();
  });

  it("highlights false option when selected", () => {
    const onChange = vi.fn();
    render(<TrueFalseInput value={false} onChange={onChange} />);
    const wrongRadio = screen.getByRole("radio", { name: "错误" });
    expect(wrongRadio).toBeChecked();
  });
});

describe("ExamTimer", () => {
  it("submits when the server deadline is reached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const onTimeout = vi.fn();
    render(
      <ExamTimer deadlineAt="2026-06-01T00:00:01Z" onTimeout={onTimeout} />,
    );

    await act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
