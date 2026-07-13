import type { ReactNode } from "react";

/** Dashboard statistic presentation authority. */
export function StatsCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  trend?: string;
}) {
  return (
    <div
      data-slot="stats-card"
      data-depth="micro"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div
            data-slot="stats-card-icon"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary-soft text-primary"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="type-secondary truncate">{label}</p>
          <p data-slot="stats-card-value" className="type-metric">
            {value}
          </p>
          {trend && <p className="type-metadata mt-1">{trend}</p>}
        </div>
      </div>
    </div>
  );
}
