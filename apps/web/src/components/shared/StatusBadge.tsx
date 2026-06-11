import { getStatusMeta, type StatusTone } from "@/lib/statusMeta";
import { cn } from "@/lib/utils";

const toneClasses: Record<StatusTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  muted: "bg-neutral-soft text-muted-foreground",
};

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
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        toneClasses[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
