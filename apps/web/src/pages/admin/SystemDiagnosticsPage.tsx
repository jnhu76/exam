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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import {
  getStatusMeta,
  getToneTextColor,
  infraStatusKey,
} from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatsCard } from "@/components/shared/StatsCard";
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

function InfoRow({
  label,
  value,
  emphasis = "default",
}: {
  label: string;
  value: string;
  emphasis?: "default" | "timestamp" | "signal";
}) {
  return (
    <div
      data-slot="diagnostic-data-row"
      data-emphasis={emphasis}
      className="flex items-baseline justify-between gap-2 py-1.5"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * System diagnostics page showing health metrics and infrastructure cards.
 *
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Monitoring cards resemble instruments with
 * white surface, clear 1px border, 8px radius, compact layout, 20px/2px icons,
 * clear numeric hierarchy.
 */
export function SystemDiagnosticsPage() {
  const { t } = useTranslation();
  const { formatDateTime, formatDuration, formatTime } = useProductDateTime();
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
                time: formatTime(lastRefreshedAt),
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
            <DiagCard
              role="information"
              icon={<AppIcon icon={Server} size="inline" />}
              title={t("diagnostics.cards.serverInfo")}
            >
              <InfoRow
                label={t("diagnostics.labels.version")}
                value={diag.version}
              />
              <InfoRow
                label={t("diagnostics.labels.uptime")}
                value={formatDuration(liveUptime * 1000)}
              />
            </DiagCard>

            <DiagCard
              role="information"
              icon={<AppIcon icon={Database} size="inline" />}
              title={t("diagnostics.cards.databaseStatus")}
            >
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
            </DiagCard>

            <DiagCard
              role="information"
              icon={<AppIcon icon={SlidersHorizontal} size="inline" />}
              title={t("diagnostics.cards.runtimeConfig")}
            >
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
            </DiagCard>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DiagCard
              role="scanner"
              icon={<AppIcon icon={HeartPulse} size="inline" />}
              title={t("diagnostics.cards.heartbeatScanner")}
            >
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
                emphasis="timestamp"
                value={
                  diag.heartbeatStatus.lastScanAt
                    ? formatDateTime(diag.heartbeatStatus.lastScanAt)
                    : t("diagnostics.labels.lastScanNever")
                }
              />
              <InfoRow
                label={t("diagnostics.labels.disruptedCount")}
                emphasis="signal"
                value={`${diag.heartbeatStatus.disruptedCount}`}
              />
            </DiagCard>

            <DiagCard
              role="scanner"
              icon={<AppIcon icon={Timer} size="inline" />}
              title={t("diagnostics.cards.deadlineScanner")}
            >
              <InfoRow
                label={t("diagnostics.labels.scanInterval")}
                value={formatDuration(diag.deadlineScannerStatus.interval)}
              />
              <InfoRow
                label={t("diagnostics.labels.lastScan")}
                emphasis="timestamp"
                value={
                  diag.deadlineScannerStatus.lastScanAt
                    ? formatDateTime(diag.deadlineScannerStatus.lastScanAt)
                    : t("diagnostics.labels.lastScanNever")
                }
              />
              <InfoRow
                label={t("diagnostics.labels.autoSubmitCount")}
                emphasis="signal"
                value={`${diag.deadlineScannerStatus.autoSubmitCount}`}
              />
            </DiagCard>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DiagCard
              role={diag.emailStatus.enabled ? "information" : "disabled"}
              icon={<AppIcon icon={Mail} size="inline" />}
              title={t("diagnostics.cards.emailInfrastructure")}
            >
              <div className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("diagnostics.labels.emailStatus")}
                </span>
                <StatusBadge status={infraStatusKey(diag.emailStatus.status)} />
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
            </DiagCard>

            <DiagCard
              role={diag.emailStatus.enabled ? "information" : "disabled"}
              icon={<AppIcon icon={Send} size="inline" />}
              title={t("diagnostics.cards.emailOutbox")}
            >
              <InfoRow
                label={t("diagnostics.labels.outboxPending")}
                value={`${diag.emailStatus.outbox.pending}`}
              />
              <InfoRow
                label={t("diagnostics.labels.outboxSent")}
                value={`${diag.emailStatus.outbox.sent}`}
              />
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
            </DiagCard>
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
    <div data-diagnostic-role="kpi">
      <StatsCard
        label={title}
        value={value}
        suffix={unit}
        icon={icon}
        supporting={
          <p
            className={cn(
              "type-metadata flex items-center gap-1",
              getToneTextColor(meta.tone),
            )}
          >
            <AppIcon icon={MetricIcon} size="badge" />
            {t(statusLabelKey(meta.labelKey))}
          </p>
        }
      />
    </div>
  );
}

function DiagCard({
  role,
  icon,
  title,
  children,
}: {
  role: "information" | "scanner" | "disabled";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="card"
      data-diagnostic-role={role}
      className={cn(
        "surface-content overflow-hidden",
        role === "disabled" && "border-border-row bg-surface-subtle",
      )}
    >
      <div
        data-slot="diagnostic-card-header"
        className={cn(
          "border-b border-border-row px-5 py-3",
          role === "scanner" &&
            "border-border-header bg-surface-subtle text-text-secondary",
          role === "disabled" && "text-text-muted",
        )}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </div>
      </div>
      <div data-slot="diagnostic-card-body" className="px-5 py-3">
        {children}
      </div>
    </div>
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
          <div key={i} className="surface-content flex flex-col gap-2 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface-content flex flex-col gap-2 p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="surface-content flex flex-col gap-2 p-5">
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
