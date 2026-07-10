import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Dashboard statistics card displaying a label, numeric value,
 * optional icon, and optional trend line.
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
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-4 p-6">
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
      </CardContent>
    </Card>
  );
}
