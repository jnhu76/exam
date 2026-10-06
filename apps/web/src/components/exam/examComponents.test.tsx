import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamTimer } from "./ExamTimer";
import { QuestionHeader } from "./QuestionHeader";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionRenderer } from "./QuestionRenderer";
import { SubjectiveAnswerInput } from "./SubjectiveAnswerInput";
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

  // Characterization (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §14, re-pinned by #675):
  // the timer renders as a single-line h-9 chip — a compact remaining-time
  // type-metadata label beside a mono tabular-numeric MM:SS value — sharing
  // the Button system's control geometry with the save indicator and the
  // submit button in the topbar row. These tests pin the durable
  // content/structure/role invariants, not a specific font-size utility on
  // the value (the old arbitrary text-[11px] class retired in W4A; the dead
  // leading-none companion was removed in RECON-1 — type-metadata owns
  // line-height under cascade policy A).
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
    // Single-line layout (#675): label and value are sibling inline spans in
    // one row, preserving the numeric/label hierarchy — the label is the
    // compact secondary text, the value is the prominent numeric.
    expect(label.tagName).toBe("SPAN");
    expect(value.tagName).toBe("SPAN");
    // The numeric value owns the tabular-nums numeric role via the type-numeric
    // recipe (its defining property); the label stays on the type-metadata
    // recipe. This is the durable role distinction that survives the layout
    // change.
    expect(value.className).toContain("type-numeric");
    expect(label.className).toContain("type-metadata");
    expect(label.className).not.toContain("type-numeric");
  });

  // #675: the timer shares the Button system's h-9 control geometry with the
  // adjacent save indicator and submit button. The height is fixed on the
  // chip itself — not derived from vertical padding — so the row stays
  // height-aligned regardless of content.
  it("uses the established h-9 control geometry, not padding-derived height", () => {
    const { container } = render(
      <ExamTimer deadlineAt="2026-06-01T00:30:00Z" onTimeout={() => {}} />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("h-9");
    expect(wrapper!.className).not.toMatch(/\bpy-/);
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
