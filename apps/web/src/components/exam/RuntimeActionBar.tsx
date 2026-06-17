import { FlagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Props for the RuntimeActionBar component. */
type RuntimeActionBarProps = {
  onPrevious: () => void;
  onNext: () => void;
  onToggleFlag: () => void;
  onSubmit: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  submitDisabled?: boolean;
  flagged?: boolean;
  className?: string;
};

/**
 * Bottom action bar for the exam runtime, providing previous/next navigation,
 * flag-toggle, and submit buttons.
 */
export function RuntimeActionBar({
  onPrevious,
  onNext,
  onToggleFlag,
  onSubmit,
  previousDisabled = false,
  nextDisabled = false,
  submitDisabled = false,
  flagged = false,
  className,
}: RuntimeActionBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={previousDisabled}
        >
          上一题
        </Button>
        <Button variant="outline" onClick={onNext} disabled={nextDisabled}>
          下一题
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onToggleFlag}>
          <FlagIcon data-icon="inline-start" aria-hidden="true" />
          {flagged ? "取消标记" : "标记本题"}
        </Button>
        <Button onClick={onSubmit} disabled={submitDisabled}>
          交卷
        </Button>
      </div>
    </div>
  );
}
