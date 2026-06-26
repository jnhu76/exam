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

interface AdminStatusTagProps {
  status: string;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "md";
}

export function AdminStatusTag({
  status,
  className,
  showIcon = true,
  size = "sm",
}: AdminStatusTagProps) {
  const meta = getStatusMeta(status);
  const Icon = meta.icon;

  return (
    <span
      data-status-tone={meta.tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-medium leading-none",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        toneClasses[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
