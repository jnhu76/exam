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
      data-depth="flat"
      className="surface-content p-4"
    >
      <div className="flex items-center gap-2.5">
        {icon && (
          <div
            data-slot="stats-card-icon"
            data-anchor-tone="primary-soft"
            className="flex shrink-0 items-center text-primary"
          >
            {icon}
          </div>
        )}
        <div data-slot="stats-card-content" className="min-w-0 flex-1">
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
