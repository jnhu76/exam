import { cn } from "@/lib/utils";

const statusView = {
  connected: { label: "连接正常", className: "bg-green-500" },
  degraded: { label: "连接不稳定", className: "bg-yellow-500" },
  offline: { label: "连接已断开", className: "bg-red-500" },
} as const;

export function ConnectionIndicator({
  status,
}: {
  status: keyof typeof statusView;
}) {
  const view = statusView[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", view.className)}
      />
      {view.label}
    </span>
  );
}
