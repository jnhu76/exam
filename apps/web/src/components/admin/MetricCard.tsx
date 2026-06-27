import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  trend?: ReactNode;
  className?: string;
}

/**
 * Wegent-style KPI tile: two-column flex with info block (label + value + trend)
 * on the left and a 46x46 pastel icon square on the right.
 */
export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  iconBg,
  iconColor,
  trend,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-bold leading-tight tracking-tight tabular-nums text-foreground">
              {value}
            </span>
            {unit && (
              <span className="text-sm text-muted-foreground">{unit}</span>
            )}
          </div>
          {trend && <div className="mt-2.5 text-xs">{trend}</div>}
        </div>
        <div
          className={cn(
            "flex size-[46px] shrink-0 items-center justify-center rounded-xl",
            iconBg,
          )}
        >
          <Icon className={cn("size-5", iconColor)} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
