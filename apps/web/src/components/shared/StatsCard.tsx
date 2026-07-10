import type { ReactNode } from "react";

/**
 * Dashboard statistics card displaying a label, numeric value,
 * optional icon, and optional trend line.
 *
 * Metric presentation authority (UI-COMP-1). Selects surface.content +
 * density.comfortable + the type-metric / type-secondary / type-metadata
 * recipes. Does NOT own elevation (forward elevation rule): the Card primitive
 * carries a default shadow-sm, so this renders a surface-content div instead
 * to stay deliberately flat. A metric and a shadow are orthogonal concerns.
 */
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
    <div className="surface-content">
      <div className="flex items-center gap-4 p-6">
        {icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="type-secondary truncate">{label}</p>
          <p className="type-metric text-3xl">{value}</p>
          {trend && <p className="type-metadata">{trend}</p>}
        </div>
      </div>
    </div>
  );
}
