import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StatsCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: number | string;
  trend?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
        {trend && <p className="text-xs text-muted-foreground">{trend}</p>}
      </CardContent>
    </Card>
  );
}
