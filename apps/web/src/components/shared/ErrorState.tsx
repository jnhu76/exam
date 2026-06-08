import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  message,
  onRetry,
  extraAction,
}: {
  message: string;
  onRetry?: () => void;
  extraAction?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/30 p-8 text-center"
    >
      <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        )}
        {extraAction}
      </div>
    </div>
  );
}
