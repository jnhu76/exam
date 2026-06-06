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

        let bgColor = "bg-muted text-muted-foreground";
        if (state === "answered") bgColor = "bg-green-100 text-green-800";
        if (state === "flagged") bgColor = "bg-yellow-100 text-yellow-800";
        const symbol =
          state === "answered" ? "●" : state === "flagged" ? "◉" : "○";

        return (
          <button
            key={q.id}
            className={`flex h-9 w-9 items-center justify-center rounded text-sm ${bgColor} ${isCurrent ? "ring-2 ring-primary" : ""}`}
            onClick={() => onSelect(i)}
            aria-label={`第 ${i + 1} 题`}
          >
            <span className="sr-only">{symbol}</span>
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
