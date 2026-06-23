import { useState, useEffect, useCallback } from "react";
import type { DiagnosticsResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Server, Database, Activity, Timer } from "lucide-react";

const REFRESH_INTERVAL_MS = 15_000;

function formatLastScan(lastScanAt: string | null): string {
  return lastScanAt ? new Date(lastScanAt).toLocaleString() : "无";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadDiagnostics = useCallback(async (isInitial = false) => {
    if (isInitial) setError(null);
    try {
      const result = await api.get<DiagnosticsResponse>(
        "/api/system/diagnostics",
      );
      setData(result);
      setError(null);
    } catch {
      if (isInitial) {
        setError("加载诊断数据失败");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnostics(true);
    const interval = setInterval(() => loadDiagnostics(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadDiagnostics]);

  if (isLoading) {
    return <DiagnosticsSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="系统诊断" />
        <ErrorState
          message={error ?? "加载诊断数据失败"}
          onRetry={() => loadDiagnostics(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="系统诊断" />
        <Button
          variant="outline"
          size="sm"
          aria-label="刷新诊断数据"
          onClick={() => {
            setIsLoading(true);
            loadDiagnostics();
          }}
        >
          <RefreshCw />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="size-4" aria-hidden="true" />
              服务器信息
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="版本" value={data.version} />
            <InfoRow label="运行时间" value={`${Math.floor(data.uptime)}s`} />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="size-4" aria-hidden="true" />
              数据库状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="延迟" value={`${data.dbLatency}ms`} />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="size-4" aria-hidden="true" />
              运行时配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow
              label="心跳间隔"
              value={`${data.config.heartbeatInterval}ms`}
            />
            <InfoRow
              label="心跳超时"
              value={`${data.config.heartbeatTimeout}ms`}
            />
            <InfoRow
              label="截止扫描间隔"
              value={`${data.config.deadlineScanInterval}ms`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Timer className="size-4" aria-hidden="true" />
              心跳扫描器
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow
              label="扫描间隔"
              value={`${data.heartbeatStatus.interval}ms`}
            />
            <InfoRow label="超时" value={`${data.heartbeatStatus.timeout}ms`} />
            <InfoRow
              label="上次扫描"
              value={formatLastScan(data.heartbeatStatus.lastScanAt)}
            />
            <InfoRow
              label="已中断"
              value={`${data.heartbeatStatus.disruptedCount}`}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Timer className="size-4" aria-hidden="true" />
              截止扫描器
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow
              label="扫描间隔"
              value={`${data.deadlineScannerStatus.interval}ms`}
            />
            <InfoRow
              label="上次扫描"
              value={formatLastScan(data.deadlineScannerStatus.lastScanAt)}
            />
            <InfoRow
              label="自动提交"
              value={`${data.deadlineScannerStatus.autoSubmitCount}`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DiagnosticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
