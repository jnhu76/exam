import { useTranslation } from "react-i18next";
import { AppIcon } from "@/components/shared/AppIcon";
import { getStatusMeta, type StatusTone } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { cn } from "@/lib/utils";

const toneClasses: Record<StatusTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  secondary: "bg-muted text-foreground",
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
 *
 * Default icon visibility follows `statusMeta[status].iconPolicy`:
 * ordinary/dense statuses render text-only; only urgency/destructive/live
 * statuses (iconPolicy "show") render an icon by default. An explicit
 * `showIcon` prop overrides this either way (backward compatibility).
 */
export function StatusBadge({
  status,
  className,
  showIcon,
}: {
  status: string;
  className?: string;
  showIcon?: boolean;
}) {
  const { t } = useTranslation();
  const meta = getStatusMeta(status);
  const shouldShowIcon = showIcon ?? meta.iconPolicy === "show";

  return (
    <span
      data-status-tone={meta.tone}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        toneClasses[meta.tone],
        className,
      )}
    >
      {shouldShowIcon && <AppIcon icon={meta.icon} size="badge" />}
      {t(statusLabelKey(meta.labelKey))}
    </span>
  );
}
