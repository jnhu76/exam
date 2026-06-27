import { getStatusMeta, toneTagClass } from "@/lib/statusMeta";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-1 rounded-[4px] font-medium leading-none",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        toneTagClass[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
