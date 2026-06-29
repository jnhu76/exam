import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getStatusMeta, type StatusTone } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";

/** CSS class mapping from StatusTone to a background-color utility. */
const dotClasses: Record<StatusTone, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground",
};

/** Supported connection status values. */
type ConnectionStatus = "connected" | "degraded" | "offline";

/** Displays a colored dot and label indicating the current network connection status. */
export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation();
  const view = getStatusMeta(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", dotClasses[view.tone])}
      />
      {t(statusLabelKey(view.labelKey))}
    </span>
  );
}
