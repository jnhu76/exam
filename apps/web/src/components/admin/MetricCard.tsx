import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  /** Tailwind background utility for the icon tile (a pastel tint). */
  iconBg: string;
  /** Tailwind text-color utility for the icon (a saturated tone). */
  iconColor: string;
  /** Optional trend/footer line below the value (e.g. status text). */
  trend?: ReactNode;
  className?: string;
}

/**
 * koi-inspired KPI tile (mirrors koi HomeStatCards): two-column inner flex with
 * an info block (label + big number + trend) on the left and a 46x46 pastel
 * icon square (12px radius) on the right. No heavy shadow — hairline border.
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
        "rounded-[var(--admin-radius)] border border-admin-border bg-card p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted-foreground">{label}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[28px] font-bold leading-tight tracking-tight tabular-nums text-foreground">
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
