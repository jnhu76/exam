import { FlagIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuestionNavigatorState = "unanswered" | "answered" | "flagged";

export type QuestionNavigatorItem = {
  id: string;
  number: number;
  state: QuestionNavigatorState;
};

type QuestionNavigatorProps = {
  items: QuestionNavigatorItem[];
  currentId: string;
  onSelect: (id: string) => void;
  className?: string;
};

const stateMeta = {
  unanswered: {
    label: "未作答",
    className:
      "border-border bg-background text-muted-foreground hover:bg-muted",
  },
  answered: {
    label: "已作答",
    className:
      "border-success bg-success text-success-foreground hover:bg-success/90",
  },
  flagged: {
    label: "已标记",
    className: "border-warning bg-warning/10 text-warning hover:bg-warning/20",
  },
} satisfies Record<
  QuestionNavigatorState,
  { label: string; className: string }
>;

export function QuestionNavigator({
  items,
  currentId,
  onSelect,
  className,
}: QuestionNavigatorProps) {
  return (
    <nav aria-label="题目导航" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const meta = stateMeta[item.state];
          const isCurrent = item.id === currentId;
          const label = isCurrent
            ? `第 ${item.number} 题，${meta.label}，当前题`
            : `第 ${item.number} 题，${meta.label}`;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={label}
              aria-current={isCurrent ? "true" : undefined}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                meta.className,
                isCurrent &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              onClick={() => onSelect(item.id)}
            >
              {item.number}
              {item.state === "flagged" && (
                <FlagIcon
                  data-icon="inline-end"
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 size-3"
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-border bg-background" />
          未作答
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-success bg-success" />
          已作答
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-warning bg-warning/10" />
          已标记
        </span>
      </div>
    </nav>
  );
}
