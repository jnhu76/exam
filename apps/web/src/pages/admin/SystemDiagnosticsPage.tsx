import { useState, useEffect, useCallback, useRef } from "react";
import type {
  SystemHealthResponse,
  DiagnosticsResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration } from "@/lib/utils";
import { getStatusMeta, getToneTextColor } from "@/lib/statusMeta";
import {
  Activity,
  CircleAlert,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";

type HealthStatus = SystemHealthResponse["status"];

const HEALTH_REFRESH_MS = 10_000;
const DIAG_REFRESH_MS = 30_000;

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

export function SystemDiagnosticsPage() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleWarnings, setStaleWarnings] = useState<{
    health?: string;
    diagnostics?: string;
  }>({});
  const clearStaleWarning = useCallback((key: "health" | "diagnostics") => {
    setStaleWarnings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const setStaleWarning = useCallback(
    (key: "health" | "diagnostics", message: string) => {
      setStaleWarnings((prev) => ({ ...prev, [key]: message }));
    },
    [],
  );
  const healthTimer = useRef<ReturnType<typeof setInterval>>(null);
  const diagTimer = useRef<ReturnType<typeof setInterval>>(null);
  const uptimeTimer = useRef<ReturnType<typeof setInterval>>(null);
  const initialLoadDone = useRef(false);

  const uptimeBaseRef = useRef<{ serverUptime: number; fetchedAt: number }>({
    serverUptime: 0,
    fetchedAt: 0,
  });
  const [liveUptime, setLiveUptime] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.get<SystemHealthResponse>("/api/system/health"));
      clearStaleWarning("health");
      setLastRefreshedAt(Date.now());
      logger.info("system_diagnostics.refreshed", { source: "health" });
    } catch (err) {
      if (!initialLoadDone.current) {
        setError("加载系统健康数据失败");
      } else {
        setStaleWarning("health", "系统状态刷新失败，当前显示上次成功数据");
        logger.warn("system_diagnostics.poll_failed", {
          source: "health",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [clearStaleWarning, setStaleWarning]);

  const loadDiag = useCallback(async () => {
    try {
      const result = await api.get<DiagnosticsResponse>(
        "/api/system/diagnostics",
      );
      setDiag(result);
      uptimeBaseRef.current = {
        serverUptime: result.uptime,
        fetchedAt: Date.now(),
      };
      clearStaleWarning("diagnostics");
      setLastRefreshedAt(Date.now());
      logger.info("system_diagnostics.refreshed", { source: "diagnostics" });
    } catch (err) {
      if (!initialLoadDone.current) {
        setError("加载诊断数据失败");
      } else {
        setStaleWarning(
          "diagnostics",
          "诊断数据刷新失败，当前显示上次成功数据",
        );
        logger.warn("system_diagnostics.poll_failed", {
          source: "diagnostics",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [clearStaleWarning, setStaleWarning]);

  useEffect(() => {
    Promise.all([loadHealth(), loadDiag()]).finally(() => {
      initialLoadDone.current = true;
      setIsLoading(false);
    });
    healthTimer.current = setInterval(loadHealth, HEALTH_REFRESH_MS);
    diagTimer.current = setInterval(loadDiag, DIAG_REFRESH_MS);
    uptimeTimer.current = setInterval(() => {
      const { serverUptime, fetchedAt } = uptimeBaseRef.current;
      if (fetchedAt > 0) {
        const elapsed = (Date.now() - fetchedAt) / 1000;
        setLiveUptime(serverUptime + elapsed);
      }
    }, 1000);
    return () => {
      if (healthTimer.current) clearInterval(healthTimer.current);
      if (diagTimer.current) clearInterval(diagTimer.current);
      if (uptimeTimer.current) clearInterval(uptimeTimer.current);
    };
  }, [loadHealth, loadDiag]);

  const handleRefresh = () => {
    setIsLoading(true);
    Promise.all([loadHealth(), loadDiag()]).finally(() => setIsLoading(false));
  };

  if (isLoading && !health && !diag) {
    return <CombinedSkeleton />;
  }

  if (error && !health && !diag) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="系统监控" />
        <ErrorState message={error} onRetry={handleRefresh} />
      </div>
    );
  }

  const overallStatus: HealthStatus = health?.status ?? "ok";
  const statusView = getStatusMeta(overallStatus);
  const StatusIcon = statusView.icon;

  return (
    <div className="flex flex-col gap-6">
      {Object.values(staleWarnings).map((message) => (
        <Alert key={message} variant="default">
          <CircleAlert />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
      <div className="flex items-center justify-between">
        <PageHeader title="系统监控" />
        <div className="flex items-center gap-3">
          {lastRefreshedAt !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              上次刷新：{new Date(lastRefreshedAt).toLocaleTimeString()}
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-medium",
              getToneTextColor(statusView.tone),
            )}
          >
            <StatusIcon className="size-3.5" aria-hidden="true" />
            {statusView.label}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="刷新系统数据"
            onClick={handleRefresh}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          title="CPU 使用率"
          value={health?.cpu ?? 0}
          unit="%"
          status={getStatusLevel(health?.cpu ?? 0)}
          icon={<Activity className="size-5" />}
        />
        <MetricCard
          title="内存使用率"
          value={health?.memory ?? 0}
          unit="%"
          status={getStatusLevel(health?.memory ?? 0)}
          icon={<HardDrive className="size-5" />}
        />
        <MetricCard
          title="数据库响应时间"
          value={health?.dbResponseMs ?? 0}
          unit="ms"
          status={getDbStatusLevel(health?.dbResponseMs ?? 0)}
          icon={<Database className="size-5" />}
        />
      </div>

      {diag && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Server className="size-4" aria-hidden="true" />
                  服务器信息
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="版本" value={diag.version} />
                <InfoRow
                  label="运行时间"
                  value={formatDuration(liveUptime * 1000)}
                />
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
                <InfoRow label="延迟" value={`${diag.dbLatency}ms`} />
                <InfoRow
                  label="Redis"
                  value={
                    diag.redisStatus.connected
                      ? `已连接 (${diag.redisStatus.latencyMs}ms)`
                      : "未连接"
                  }
                />
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
                  value={formatDuration(diag.config.heartbeatInterval)}
                />
                <InfoRow
                  label="心跳超时"
                  value={formatDuration(diag.config.heartbeatTimeout)}
                />
                <InfoRow
                  label="截止扫描间隔"
                  value={formatDuration(diag.config.deadlineScanInterval)}
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
                  value={formatDuration(diag.heartbeatStatus.interval)}
                />
                <InfoRow
                  label="超时"
                  value={formatDuration(diag.heartbeatStatus.timeout)}
                />
                <InfoRow
                  label="上次扫描"
                  value={formatLastScan(diag.heartbeatStatus.lastScanAt)}
                />
                <InfoRow
                  label="已中断"
                  value={`${diag.heartbeatStatus.disruptedCount}`}
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
                  value={formatDuration(diag.deadlineScannerStatus.interval)}
                />
                <InfoRow
                  label="上次扫描"
                  value={formatLastScan(diag.deadlineScannerStatus.lastScanAt)}
                />
                <InfoRow
                  label="自动提交"
                  value={`${diag.deadlineScannerStatus.autoSubmitCount}`}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
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
  const meta = getStatusMeta(status);
  const MetricIcon = meta.icon;
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
            getToneTextColor(meta.tone),
          )}
        >
          <MetricIcon className="size-3" aria-hidden="true" />
          {meta.label}
        </p>
      </CardContent>
    </Card>
  );
}

function CombinedSkeleton() {
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
