import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/shared/AppIcon";
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
  const { t } = useTranslation();
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
          {t("candidateRuntime.actions.previous")}
        </Button>
        <Button variant="outline" onClick={onNext} disabled={nextDisabled}>
          {t("candidateRuntime.actions.next")}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onToggleFlag}>
          <AppIcon icon={Flag} size="inline" />
          {flagged
            ? t("candidateRuntime.actions.unflag")
            : t("candidateRuntime.actions.flag")}
        </Button>
        <Button onClick={onSubmit} disabled={submitDisabled}>
          {t("candidateRuntime.actions.submit")}
        </Button>
      </div>
    </div>
  );
}
