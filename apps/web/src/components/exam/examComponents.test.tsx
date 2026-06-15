import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerPanel } from "./AnswerPanel";
import { ExamTimer } from "./ExamTimer";
import { ExamTopbar } from "./ExamTopbar";
import { QuestionHeader } from "./QuestionHeader";
import { QuestionNav } from "./QuestionNav";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionRenderer } from "./QuestionRenderer";
import { QuestionWorkspace } from "./QuestionWorkspace";
import { RuntimeActionBar } from "./RuntimeActionBar";
import { SubjectiveAnswerInput } from "./SubjectiveAnswerInput";
import { SubmitConfirmDialog } from "./SubmitConfirmDialog";
import { TrueFalseInput } from "./TrueFalseInput";

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

describe("ExamTopbar", () => {
  it("renders exam title and runtime status slots", () => {
    render(
      <ExamTopbar
        title="安全培训考试"
        remainingTime="00:29:59"
        saveStatus={<span>已保存</span>}
        networkStatus={<span>网络正常</span>}
      />,
    );

    expect(screen.getByText("安全培训考试")).toBeInTheDocument();
    expect(screen.getByText("00:29:59")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("网络正常")).toBeInTheDocument();
  });
});

describe("QuestionNavigator", () => {
  it("renders states and selects by question id", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionNavigator
        currentId="q1"
        onSelect={onSelect}
        items={[
          { id: "q1", number: 1, state: "unanswered" },
          { id: "q2", number: 2, state: "answered" },
          { id: "q3", number: 3, state: "flagged" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "第 1 题，未作答，当前题" }),
    ).toHaveAttribute("aria-current", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "第 2 题，已作答" }),
    );
    expect(onSelect).toHaveBeenCalledWith("q2");
    expect(
      screen.getByRole("button", { name: "第 3 题，已标记" }),
    ).toBeInTheDocument();
  });
});

describe("QuestionWorkspace", () => {
  it("renders header, question, answer, and footer slots", () => {
    render(
      <QuestionWorkspace
        header={<QuestionHeader number={1} typeLabel="单选题" score={5} />}
        question={<p>题干内容</p>}
        answer={<AnswerPanel>答案内容</AnswerPanel>}
        footer={<div>底部操作</div>}
      />,
    );

    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("单选题")).toBeInTheDocument();
    expect(screen.getByText("5 分")).toBeInTheDocument();
    expect(screen.getByText("题干内容")).toBeInTheDocument();
    expect(screen.getByText("答案内容")).toBeInTheDocument();
    expect(screen.getByText("底部操作")).toBeInTheDocument();
  });
});

describe("SubjectiveAnswerInput", () => {
  it("renders textarea, counter, and emits text changes", async () => {
    const onChange = vi.fn();
    render(
      <SubjectiveAnswerInput
        value="已有答案"
        onChange={onChange}
        maxLength={100}
      />,
    );

    expect(screen.getByLabelText("主观题答案")).toHaveValue("已有答案");
    expect(screen.getByText("4 / 100")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("主观题答案"), "补充");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders readonly and error states", () => {
    render(
      <SubjectiveAnswerInput
        value=""
        onChange={() => {}}
        readOnly
        error="答案不能为空"
      />,
    );

    expect(screen.getByLabelText("主观题答案")).toHaveAttribute("readonly");
    expect(screen.getByText("答案不能为空")).toBeInTheDocument();
  });

  it("treats nullish values as an empty controlled textarea", () => {
    render(<SubjectiveAnswerInput value={null} onChange={() => {}} />);

    expect(screen.getByLabelText("主观题答案")).toHaveValue("");
    expect(screen.getByText("0 字")).toBeInTheDocument();
  });
});

describe("RuntimeActionBar", () => {
  it("renders runtime actions and calls callbacks", async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onToggleFlag = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RuntimeActionBar
        onPrevious={onPrevious}
        onNext={onNext}
        onToggleFlag={onToggleFlag}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "上一题" }));
    await userEvent.click(screen.getByRole("button", { name: "下一题" }));
    await userEvent.click(screen.getByRole("button", { name: "标记本题" }));
    await userEvent.click(screen.getByRole("button", { name: "交卷" }));
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onToggleFlag).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("renders flagged and disabled states", () => {
    render(
      <RuntimeActionBar
        flagged
        previousDisabled
        nextDisabled
        submitDisabled
        onPrevious={() => {}}
        onNext={() => {}}
        onToggleFlag={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "取消标记" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一题" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一题" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "交卷" })).toBeDisabled();
  });
});

describe("SubmitConfirmDialog", () => {
  it("renders answer summary and confirms submit", async () => {
    const onConfirm = vi.fn();
    render(
      <SubmitConfirmDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        totalCount={10}
        answeredCount={7}
        flaggedCount={2}
      />,
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "确认交卷" }),
    ).toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("已标记")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认交卷" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
