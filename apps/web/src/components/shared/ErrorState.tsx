import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error placeholder. Appearance is OUTLINE feedback (issue 577 review-fix-1):
 * the destructive tone owns only the dashed border color; the surface stays
 * transparent and text stays component-owned (secondary message, destructive
 * icon) — matching its pre-corrective unfilled placeholder shape.
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel,
  extraAction,
  className,
}: {
  message: string;
  onRetry?: () => void;
  /** Overrides the default retry button label. */
  retryLabel?: string;
  extraAction?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-feedback-tone="destructive"
      data-feedback-appearance="outline"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center",
        className,
      )}
    >
      <AppIcon icon={CircleAlert} size="state" className="text-destructive" />
      <p className="type-secondary">{message}</p>
      <div className="flex gap-2">
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {retryLabel ?? t("common.retry")}
          </Button>
        )}
        {extraAction}
      </div>
    </div>
  );
}
