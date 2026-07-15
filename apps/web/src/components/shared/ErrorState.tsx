import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Displays an error message with an icon, optional retry button, and extra action slot. */
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
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/30 p-8 text-center",
        className,
      )}
    >
      <AppIcon icon={CircleAlert} size="state" className="text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
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
