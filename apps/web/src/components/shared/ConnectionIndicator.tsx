import { cn } from "@/lib/utils";
import { CONNECTION_STATUS_LABELS } from "@/lib/constants";

const statusView = {
  connected: {
    label: CONNECTION_STATUS_LABELS.connected,
    className: "bg-success",
  },
  degraded: {
    label: CONNECTION_STATUS_LABELS.degraded,
    className: "bg-warning",
  },
  offline: {
    label: CONNECTION_STATUS_LABELS.offline,
    className: "bg-destructive",
  },
} as const;

export function ConnectionIndicator({
  status,
}: {
  status: keyof typeof statusView;
}) {
  const view = statusView[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", view.className)}
      />
      {view.label}
    </span>
  );
}
