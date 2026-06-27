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
        "inline-flex min-w-fit items-center gap-1 whitespace-nowrap rounded-md border font-medium leading-none",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        toneTagClass[meta.tone],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
