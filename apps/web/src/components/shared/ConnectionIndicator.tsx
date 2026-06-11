import { cn } from "@/lib/utils";
import { getStatusMeta, type StatusTone } from "@/lib/statusMeta";

const dotClasses: Record<StatusTone, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground",
};

type ConnectionStatus = "connected" | "degraded" | "offline";

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const view = getStatusMeta(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", dotClasses[view.tone])}
      />
      {view.label}
    </span>
  );
}
