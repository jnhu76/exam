import { useTranslation } from "react-i18next";
import { AppIcon } from "@/components/shared/AppIcon";
import { getStatusMeta } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { cn } from "@/lib/utils";

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
      data-slot="status-badge"
      data-status-tone={meta.tone}
      data-status-geometry="compact"
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {shouldShowIcon && <AppIcon icon={meta.icon} size="badge" />}
      {t(statusLabelKey(meta.labelKey))}
    </span>
  );
}
