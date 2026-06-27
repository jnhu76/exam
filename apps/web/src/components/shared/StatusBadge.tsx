import { getStatusMeta, toneTagClass } from "@/lib/statusMeta";
import { cn } from "@/lib/utils";

/**
 * Inline badge that displays a status label with a Wegent-style
 * rounded-md background and optional icon.
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
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium",
        toneTagClass[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
