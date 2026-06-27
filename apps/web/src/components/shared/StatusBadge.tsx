import { getStatusMeta, toneTagClass } from "@/lib/statusMeta";
import { cn } from "@/lib/utils";

/**
 * Inline badge that displays a status label with a color-coded background
 * and optional icon, resolved from the status metadata lookup.
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
  const meta = getStatusMeta(status);
  const Icon = meta.icon;

  return (
    <span
      data-status-tone={meta.tone}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-xs font-medium",
        toneTagClass[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
