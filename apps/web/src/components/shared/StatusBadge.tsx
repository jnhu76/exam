import { useTranslation } from "react-i18next";
import { getStatusMeta, type StatusTone } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { cn } from "@/lib/utils";

/** CSS class mapping from StatusTone to background/text color utilities. */
const toneClasses: Record<StatusTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  muted: "bg-neutral-soft text-muted-foreground",
};

/**
 * Inline badge that displays a status label with a color-coded background
 * and optional icon, resolved from the status metadata lookup. The label
 * text is i18n-resolved via `t(meta.labelKey)` (statusMeta stores no copy).
 */
export function StatusBadge({
  status,
  className,
  showIcon = true,
}: {
  status: string;
  className?: string;
  showIcon?: boolean;
}) {
  const { t } = useTranslation();
  const meta = getStatusMeta(status);
  const Icon = meta.icon;

  return (
    <span
      data-status-tone={meta.tone}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        toneClasses[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" aria-hidden="true" />}
      {t(statusLabelKey(meta.labelKey))}
    </span>
  );
}
