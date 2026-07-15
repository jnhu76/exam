import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";
import { cn } from "@/lib/utils";

/** Visual state of a question in the navigator grid. */
export type QuestionNavigatorState = "unanswered" | "answered" | "flagged";

/** A single question entry in the navigator with its display state. */
export type QuestionNavigatorItem = {
  id: string;
  number: number;
  state: QuestionNavigatorState;
};

/** Props for the QuestionNavigator component. */
type QuestionNavigatorProps = {
  items: QuestionNavigatorItem[];
  currentId: string;
  onSelect: (id: string) => void;
  className?: string;
};

/** i18n key mapping for each navigator state label. */
const stateKeyMap: Record<QuestionNavigatorState, string> = {
  unanswered: "candidateRuntime.navigator.unanswered",
  answered: "candidateRuntime.navigator.answered",
  flagged: "candidateRuntime.navigator.flagged",
};

/** CSS class mapping for each navigator state. */
const stateClassMap: Record<QuestionNavigatorState, string> = {
  unanswered:
    "border-border bg-background text-muted-foreground hover:bg-muted",
  answered:
    "border-success bg-success text-success-foreground hover:bg-success/90",
  flagged: "border-warning bg-warning/10 text-warning hover:bg-warning/20",
};

/**
 * Grid-based question navigator showing numbered buttons with
 * color-coded states (unanswered, answered, flagged) and a legend.
 */
export function QuestionNavigator({
  items,
  currentId,
  onSelect,
  className,
}: QuestionNavigatorProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("candidateRuntime.navigator.ariaLabel")}
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const stateKey = stateKeyMap[item.state];
          const stateLabel = t(stateKey as never);
          const isCurrent = item.id === currentId;
          const ariaLabel = isCurrent
            ? t("candidateRuntime.navigator.questionLabelCurrent" as never, {
                number: item.number,
                state: stateLabel,
              })
            : t("candidateRuntime.navigator.questionLabel" as never, {
                number: item.number,
                state: stateLabel,
              });

          return (
            <button
              key={item.id}
              type="button"
              aria-label={ariaLabel}
              aria-current={isCurrent ? "true" : undefined}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                stateClassMap[item.state],
                isCurrent &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              onClick={() => onSelect(item.id)}
            >
              {item.number}
              {item.state === "flagged" && (
                <AppIcon
                  icon={Flag}
                  size="badge"
                  className="absolute -top-1 -right-1"
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-border bg-background" />
          {t("candidateRuntime.navigator.unanswered")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-success bg-success" />
          {t("candidateRuntime.navigator.answered")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-warning bg-warning/10" />
          {t("candidateRuntime.navigator.flagged")}
        </span>
      </div>
    </nav>
  );
}
