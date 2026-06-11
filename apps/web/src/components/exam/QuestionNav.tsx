type QuestionState = "unanswered" | "answered" | "flagged";

interface QuestionNavItem {
  id: string;
}

export function QuestionNav({
  questions,
  states,
  currentIndex,
  onSelect,
}: {
  questions: QuestionNavItem[];
  states: QuestionState[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const isTwoColumn = questions.length >= 50;

  return (
    <div
      className={`grid gap-1 ${isTwoColumn ? "grid-cols-2" : "grid-cols-1"}`}
    >
      {questions.map((q, i) => {
        const state = states[i] ?? "unanswered";
        const isCurrent = i === currentIndex;

        let bgColor =
          "border border-border bg-background text-muted-foreground hover:bg-muted";
        let stateLabel = "未作答";
        if (state === "answered") {
          bgColor =
            "border border-success bg-success text-success-foreground hover:bg-success/90";
          stateLabel = "已作答";
        }
        if (state === "flagged") {
          bgColor =
            "border border-warning bg-warning/10 text-warning hover:bg-warning/20";
          stateLabel = "已标记";
        }
        if (isCurrent) {
          bgColor +=
            " ring-2 ring-primary ring-offset-2 ring-offset-background font-semibold";
        }
        const symbol =
          state === "answered" ? "●" : state === "flagged" ? "◉" : "○";
        const ariaLabel = isCurrent
          ? `第 ${i + 1} 题，${stateLabel}，当前题`
          : `第 ${i + 1} 题，${stateLabel}`;

        return (
          <button
            key={q.id}
            type="button"
            className={`flex h-9 w-9 items-center justify-center rounded text-sm transition-colors ${bgColor}`}
            onClick={() => onSelect(i)}
            aria-label={ariaLabel}
            aria-current={isCurrent ? "true" : undefined}
          >
            <span className="sr-only">{symbol}</span>
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
