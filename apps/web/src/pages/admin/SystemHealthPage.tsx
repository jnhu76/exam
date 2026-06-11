import { useState, useEffect, useCallback, useRef } from "react";
import type { SystemHealthResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Activity, Database, HardDrive, RefreshCw } from "lucide-react";

type HealthStatus = SystemHealthResponse["status"];

const statusConfig: Record<HealthStatus, { label: string; className: string }> =
  {
    ok: { label: "正常", className: "text-success" },
    degraded: { label: "警告", className: "text-warning" },
    critical: { label: "严重", className: "text-destructive" },
  };

const REFRESH_INTERVAL_MS = 10_000;

function getStatusLevel(value: number): HealthStatus {
  if (value > 95) return "critical";
  if (value > 80) return "degraded";
  return "ok";
}

function getDbStatusLevel(ms: number): HealthStatus {
  if (ms > 1000) return "critical";
  if (ms > 500) return "degraded";
  return "ok";
}

export function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const loadHealth = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<SystemHealthResponse>("/api/system/health");
      setData(result);
    } catch {
      setError("加载系统健康数据失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    intervalRef.current = setInterval(loadHealth, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadHealth]);

  const overallStatus: HealthStatus = data?.status ?? "ok";
  const statusView = statusConfig[overallStatus];

  if (isLoading) {
    return <SystemHealthSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="系统健康" />
        <ErrorState message={error} onRetry={loadHealth} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="系统健康" />
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-medium",
              statusView.className,
            )}
          >
            {statusView.label}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="刷新系统健康数据"
            onClick={() => {
              setIsLoading(true);
              loadHealth();
            }}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          title="CPU 使用率"
          value={data?.cpu ?? 0}
          unit="%"
          status={getStatusLevel(data?.cpu ?? 0)}
          icon={<Activity className="size-5" />}
        />
        <MetricCard
          title="内存使用率"
          value={data?.memory ?? 0}
          unit="%"
          status={getStatusLevel(data?.memory ?? 0)}
          icon={<HardDrive className="size-5" />}
        />
        <MetricCard
          title="数据库响应时间"
          value={data?.dbResponseMs ?? 0}
          unit="ms"
          status={getDbStatusLevel(data?.dbResponseMs ?? 0)}
          icon={<Database className="size-5" />}
        />
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  unit,
  status,
  icon,
}: {
  title: string;
  value: number;
  unit: string;
  status: HealthStatus;
  icon: React.ReactNode;
}) {
  const config = statusConfig[status];
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <p className="text-3xl font-bold">{value}</p>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-xs font-medium",
            config.className,
          )}
        >
          {config.label}
        </p>
      </CardContent>
    </Card>
  );
}

function SystemHealthSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
