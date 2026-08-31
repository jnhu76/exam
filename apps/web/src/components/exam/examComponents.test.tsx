import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerPanel } from "./AnswerPanel";
import { ExamTimer } from "./ExamTimer";
import { ExamTopbar } from "./ExamTopbar";
import { QuestionHeader } from "./QuestionHeader";
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
            contentDocument: null,
            answerMode: "plain",
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
          contentDocument: null,
          answerMode: "plain",
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

  // Characterization (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §14): the timer renders a
  // compact remaining-time label and a zero-padded MM:SS numeric value. The
  // label uses the type-metadata recipe; the value uses a mono tabular-numeric
  // stack. These tests pin the durable content/structure/role invariants, not
  // the old arbitrary text-[11px] class (retired in W4A) nor the dead
  // leading-none companion (removed in RECON-1 — type-metadata owns line-height
  // under cascade policy A, so leading-none was ineffective and contradictory).
  it("renders the remaining-time label alongside the MM:SS value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    render(
      <ExamTimer deadlineAt="2026-06-01T00:30:00Z" onTimeout={() => {}} />,
    );

    // The label ("剩余时间") is present as a distinct element.
    expect(screen.getByText("剩余时间")).toBeInTheDocument();
    // The numeric value is zero-padded to 30:00 (30 min exactly).
    expect(screen.getByText("30:00")).toBeInTheDocument();
  });

  it("keeps the timer value zero-padded to two digits per field", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    render(
      <ExamTimer deadlineAt="2026-06-01T00:05:03Z" onTimeout={() => {}} />,
    );

    expect(screen.getByText("05:03")).toBeInTheDocument();
  });

  it("keeps the label visually distinct from the numeric value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    render(
      <ExamTimer deadlineAt="2026-06-01T00:30:00Z" onTimeout={() => {}} />,
    );

    const label = screen.getByText("剩余时间");
    const value = screen.getByText("30:00");
    // The label and value are separate elements, preserving numeric/label
    // hierarchy: the label is the compact secondary text, the value is the
    // prominent numeric.
    expect(label.tagName).toBe("DIV");
    expect(value.tagName).toBe("SPAN");
    // The numeric value owns the tabular-nums numeric role via the type-numeric
    // recipe (its defining property); the label does not. This is the durable
    // role distinction that survives the label's typography-recipe migration.
    expect(value.className).toContain("type-numeric");
    expect(label.className).not.toContain("type-numeric");
  });

  it("activates the low-time state at the 300s threshold", () => {
    vi.useFakeTimers();
    // 300s remaining = exactly at the low-time boundary (remaining <= 300).
    vi.setSystemTime(new Date("2026-06-01T00:25:00Z"));
    const { container } = render(
      <ExamTimer deadlineAt="2026-06-01T00:30:00Z" onTimeout={() => {}} />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    // Low-time state paints the wrapper with the destructive surface utilities.
    expect(wrapper!.className).toContain("destructive");
  });

  it("does not activate the low-time state above the threshold", () => {
    vi.useFakeTimers();
    // 301s remaining > 300s threshold → not low.
    vi.setSystemTime(new Date("2026-06-01T00:24:59Z"));
    const { container } = render(
      <ExamTimer deadlineAt="2026-06-01T00:30:00Z" onTimeout={() => {}} />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).not.toContain("destructive");
  });

  it("updates the remaining-time value each second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    render(
      <ExamTimer deadlineAt="2026-06-01T00:00:10Z" onTimeout={() => {}} />,
    );

    expect(screen.getByText("00:10")).toBeInTheDocument();
    await act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("00:07")).toBeInTheDocument();
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

  it("renders legend with color swatches for each state", () => {
    render(
      <QuestionNavigator
        currentId="q1"
        onSelect={() => {}}
        items={[{ id: "q1", number: 1, state: "unanswered" }]}
      />,
    );

    expect(screen.getByText("未作答")).toBeInTheDocument();
    expect(screen.getByText("已作答")).toBeInTheDocument();
    expect(screen.getByText("已标记")).toBeInTheDocument();

    const legend = screen.getByText("未作答").closest("div")!.parentElement!;
    const swatches = legend.querySelectorAll("span.inline-block");
    expect(swatches.length).toBe(3);
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

  // Characterization (UI-MIGRATE-N-W3): the question content surface is a
  // governed content region wrapping the question prompt. After the
  // surface-content migration it must remain a distinct bordered region
  // containing the prompt text. Asserts the durable role, not the raw
  // surface utility classes.
  it("keeps the question content surface as a distinct region holding the prompt", () => {
    const { container } = render(
      <QuestionWorkspace
        question={<p data-testid="prompt">题干内容</p>}
        answer={<AnswerPanel>答案内容</AnswerPanel>}
      />,
    );
    const prompt = screen.getByTestId("prompt");
    // The prompt lives inside a bordered surface element (the question
    // content region). The surface carries padding that distinguishes it
    // from the surrounding workspace.
    const surface = prompt.parentElement;
    expect(surface).not.toBeNull();
    // The workspace section is the outermost shell; the surface is a child
    // distinct from the answer area.
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section).toContainElement(prompt);
    expect(section).toContainElement(screen.getByText("答案内容"));
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

  it("uses unique accessibility ids for multiple instances", () => {
    render(
      <>
        <SubjectiveAnswerInput
          value=""
          onChange={() => {}}
          label="第一题答案"
          error="第一题不能为空"
        />
        <SubjectiveAnswerInput
          value=""
          onChange={() => {}}
          label="第二题答案"
          error="第二题不能为空"
        />
      </>,
    );

    const firstInput = screen.getByLabelText("第一题答案");
    const secondInput = screen.getByLabelText("第二题答案");

    expect(firstInput.id).not.toBe(secondInput.id);
    expect(firstInput).toHaveAttribute(
      "aria-describedby",
      `${firstInput.id}-help`,
    );
    expect(secondInput).toHaveAttribute(
      "aria-describedby",
      `${secondInput.id}-help`,
    );
  });

  it("omits aria-describedby and renders no error node when there is no error", () => {
    const { container } = render(
      <SubjectiveAnswerInput value="" onChange={() => {}} />,
    );

    const textarea = screen.getByLabelText("主观题答案");
    // No error → no programmatic association, and no orphan error node.
    expect(textarea).not.toHaveAttribute("aria-describedby");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("preserves the aria-describedby → error node id association in the error state", () => {
    const { container } = render(
      <SubjectiveAnswerInput
        value=""
        onChange={() => {}}
        error="答案不能为空"
      />,
    );

    const textarea = screen.getByLabelText("主观题答案");
    const describedById = textarea.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    // The referenced id must resolve to the concrete error node.
    expect(container.querySelector(`#${describedById}`)).toBeInTheDocument();
    expect(container.querySelector(`#${describedById}`)).toHaveTextContent(
      "答案不能为空",
    );
    expect(textarea).toHaveAttribute("aria-invalid", "true");
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
