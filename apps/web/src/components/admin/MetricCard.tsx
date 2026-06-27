import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Semantic icon tone. Each tone resolves to a pair of Wegent semantic
 * utilities (background + foreground) drawn exclusively from the token system
 * — never a hardcoded color. New call sites should pass `tone`; the legacy
 * `iconBg` / `iconColor` props remain for backward compatibility.
 */
export type MetricTone = "primary" | "success" | "warning" | "error" | "muted";

const TONE_CLASSES: Record<MetricTone, { bg: string; fg: string }> = {
  primary: { bg: "bg-primary/10", fg: "text-primary" },
  success: { bg: "bg-success/10", fg: "text-success" },
  warning: { bg: "bg-warning/10", fg: "text-warning" },
  error: { bg: "bg-error/10", fg: "text-error" },
  muted: { bg: "bg-muted", fg: "text-muted-foreground" },
};

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  /** Semantic icon tone. Preferred over iconBg/iconColor for new code. */
  tone?: MetricTone;
  /** @deprecated Use `tone`. Explicit icon background utility. */
  iconBg?: string;
  /** @deprecated Use `tone`. Explicit icon foreground utility. */
  iconColor?: string;
  trend?: ReactNode;
  className?: string;
}

/**
 * Wegent-style KPI tile: two-column flex with info block (label + value + trend)
 * on the left and a 46x46 pastel icon square on the right.
 *
 * Icon color resolution order: `tone` > (`iconBg`+`iconColor`) > `primary`.
 */
export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
  iconBg,
  iconColor,
  trend,
  className,
}: MetricCardProps) {
  const resolved =
    tone != null
      ? TONE_CLASSES[tone]
      : {
          bg: iconBg ?? TONE_CLASSES.primary.bg,
          fg: iconColor ?? TONE_CLASSES.primary.fg,
        };

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
            resolved.bg,
          )}
        >
          <Icon className={cn("size-5", resolved.fg)} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
