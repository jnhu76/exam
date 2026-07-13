import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  SystemHealthResponse,
  DiagnosticsResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration } from "@/lib/utils";
import {
  getStatusMeta,
  getToneTextColor,
  infraStatusKey,
} from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Activity,
  CircleAlert,
  Database,
  HeartPulse,
  MemoryStick,
  Mail,
  RefreshCw,
  Send,
  Server,
  SlidersHorizontal,
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

function formatLastScan(lastScanAt: string | null, fallback: string): string {
  return lastScanAt ? new Date(lastScanAt).toLocaleString() : fallback;
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
  const { t } = useTranslation();
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
      // Routine successful refreshes are debug-level (S3): health polls every
      // 10s and diag every 30s, so info would flood the client_events table.
      logger.debug("system_diagnostics.refreshed", { source: "health" });
    } catch (err) {
      if (!initialLoadDone.current) {
        setError(t("diagnostics.errors.healthLoadFailed"));
      } else {
        setStaleWarning("health", t("diagnostics.staleWarnings.health"));
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
      // See loadHealth: routine refresh is debug, not info (S3).
      logger.debug("system_diagnostics.refreshed", { source: "diagnostics" });
    } catch (err) {
      if (!initialLoadDone.current) {
        setError(t("diagnostics.errors.diagnosticsLoadFailed"));
      } else {
        setStaleWarning(
          "diagnostics",
          t("diagnostics.staleWarnings.diagnostics"),
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
        <PageHeader title={t("diagnostics.title")} />
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
          <AppIcon icon={CircleAlert} size="inline" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
      <div className="flex items-center justify-between">
        <PageHeader title={t("diagnostics.title")} />
        <div className="flex items-center gap-3">
          {lastRefreshedAt !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("diagnostics.header.lastRefreshed", {
                time: new Date(lastRefreshedAt).toLocaleTimeString(),
              })}
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-medium",
              getToneTextColor(statusView.tone),
            )}
          >
            <AppIcon icon={StatusIcon} size="badge" />
            {t(statusLabelKey(statusView.labelKey))}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("diagnostics.actions.refresh")}
            onClick={handleRefresh}
          >
            <AppIcon icon={RefreshCw} size="inline" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          title={t("diagnostics.metrics.cpuUsage")}
          value={health?.cpu ?? 0}
          unit="%"
          status={getStatusLevel(health?.cpu ?? 0)}
          icon={<AppIcon icon={Activity} size="metric" />}
        />
        <MetricCard
          title={t("diagnostics.metrics.memoryUsage")}
          value={health?.memory ?? 0}
          unit="%"
          status={getStatusLevel(health?.memory ?? 0)}
          icon={<AppIcon icon={MemoryStick} size="metric" />}
        />
        <MetricCard
          title={t("diagnostics.metrics.dbResponseTime")}
          value={health?.dbResponseMs ?? 0}
          unit="ms"
          status={getDbStatusLevel(health?.dbResponseMs ?? 0)}
          icon={<AppIcon icon={Database} size="metric" />}
        />
      </div>

      {diag && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={Server} size="inline" />
                  {t("diagnostics.cards.serverInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.version")}
                  value={diag.version}
                />
                <InfoRow
                  label={t("diagnostics.labels.uptime")}
                  value={formatDuration(liveUptime * 1000)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={Database} size="inline" />
                  {t("diagnostics.cards.databaseStatus")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.latency")}
                  value={`${diag.dbLatency}ms`}
                />
                <InfoRow
                  label={t("diagnostics.labels.redis")}
                  value={
                    diag.redisStatus.connected
                      ? t("diagnostics.labels.redisConnected", {
                          latencyMs: diag.redisStatus.latencyMs ?? 0,
                        })
                      : t("diagnostics.labels.redisDisconnected")
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={SlidersHorizontal} size="inline" />
                  {t("diagnostics.cards.runtimeConfig")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.heartbeatInterval")}
                  value={formatDuration(diag.config.heartbeatInterval)}
                />
                <InfoRow
                  label={t("diagnostics.labels.heartbeatTimeout")}
                  value={formatDuration(diag.config.heartbeatTimeout)}
                />
                <InfoRow
                  label={t("diagnostics.labels.deadlineScanInterval")}
                  value={formatDuration(diag.config.deadlineScanInterval)}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={HeartPulse} size="inline" />
                  {t("diagnostics.cards.heartbeatScanner")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.scanInterval")}
                  value={formatDuration(diag.heartbeatStatus.interval)}
                />
                <InfoRow
                  label={t("diagnostics.labels.timeout")}
                  value={formatDuration(diag.heartbeatStatus.timeout)}
                />
                <InfoRow
                  label={t("diagnostics.labels.lastScan")}
                  value={formatLastScan(
                    diag.heartbeatStatus.lastScanAt,
                    t("diagnostics.labels.lastScanNever"),
                  )}
                />
                <InfoRow
                  label={t("diagnostics.labels.disruptedCount")}
                  value={`${diag.heartbeatStatus.disruptedCount}`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={Timer} size="inline" />
                  {t("diagnostics.cards.deadlineScanner")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.scanInterval")}
                  value={formatDuration(diag.deadlineScannerStatus.interval)}
                />
                <InfoRow
                  label={t("diagnostics.labels.lastScan")}
                  value={formatLastScan(
                    diag.deadlineScannerStatus.lastScanAt,
                    t("diagnostics.labels.lastScanNever"),
                  )}
                />
                <InfoRow
                  label={t("diagnostics.labels.autoSubmitCount")}
                  value={`${diag.deadlineScannerStatus.autoSubmitCount}`}
                />
              </CardContent>
            </Card>
          </div>

          {/* P3-M5B: email infrastructure + outbox status. Renders only the
              stable status/worker/outbox counts from the contract — never
              SMTP host/user/password, recipient addresses, or email body. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={Mail} size="inline" />
                  {t("diagnostics.cards.emailInfrastructure")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-sm text-muted-foreground">
                    {t("diagnostics.labels.emailStatus")}
                  </span>
                  <StatusBadge
                    status={infraStatusKey(diag.emailStatus.status)}
                  />
                </div>
                <InfoRow
                  label={t("diagnostics.labels.emailEnabled")}
                  value={
                    diag.emailStatus.enabled
                      ? t("diagnostics.labels.emailEnabled")
                      : t("diagnostics.labels.emailDisabled")
                  }
                />
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-sm text-muted-foreground">
                    {t("diagnostics.labels.emailWorker")}
                  </span>
                  <StatusBadge
                    status={infraStatusKey(diag.emailStatus.worker.status)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <AppIcon icon={Send} size="inline" />
                  {t("diagnostics.cards.emailOutbox")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label={t("diagnostics.labels.outboxPending")}
                  value={`${diag.emailStatus.outbox.pending}`}
                />
                <InfoRow
                  label={t("diagnostics.labels.outboxSent")}
                  value={`${diag.emailStatus.outbox.sent}`}
                />
                {/* Failed count is visually emphasized when > 0 (warning tone),
                    but no new design system is introduced — reuse tone text
                    color helpers already used elsewhere on this page. */}
                <div className="flex items-baseline justify-between gap-2 py-1.5">
                  <span className="text-sm text-muted-foreground">
                    {t("diagnostics.labels.outboxFailed")}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      diag.emailStatus.outbox.failed > 0 &&
                        getToneTextColor("warning"),
                    )}
                  >
                    {diag.emailStatus.outbox.failed}
                  </span>
                </div>
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
  const { t } = useTranslation();
  const meta = getStatusMeta(status);
  const MetricIcon = meta.icon;
  return (
    <Card>
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
          <AppIcon icon={MetricIcon} size="badge" />
          {t(statusLabelKey(meta.labelKey))}
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
