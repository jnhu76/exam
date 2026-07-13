import type { ReactNode } from "react";

/** Dashboard statistic presentation authority. */
export function StatsCard({
  label,
  value,
  icon,
  trend,
  supporting,
  suffix,
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  trend?: string;
  supporting?: ReactNode;
  suffix?: ReactNode;
}) {
  return (
    <div
      data-slot="stats-card"
      data-depth="micro"
      className="surface-raised p-4"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div
            data-slot="stats-card-icon"
            data-anchor-tone="primary-soft"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary-soft-strong bg-primary-soft text-primary"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="type-secondary truncate">{label}</p>
          <div className="flex items-baseline gap-1">
            <p data-slot="stats-card-value" className="type-metric">
              {value}
            </p>
            {suffix && <span className="type-secondary">{suffix}</span>}
          </div>
          {trend && <p className="type-metadata mt-1">{trend}</p>}
          {supporting && <div className="mt-1">{supporting}</div>}
        </div>
      </div>
    </div>
  );
}
