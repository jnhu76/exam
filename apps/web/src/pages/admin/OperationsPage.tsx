import { useState, useEffect, useCallback } from "react";
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
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { StatsCard } from "@/components/shared/StatsCard";
import { PageSection } from "@/components/shared/PageSection";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { PageContainer } from "@/components/shared/PageContainer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Database, HeartPulse, MemoryStick } from "lucide-react";

const HEALTH_REFRESH_MS = 15_000;

/**
 * Operations surface (Admin business-owner summary + Application Maintainer
 * detail).
 *
 * Renders the operational control-plane truth: overall health and the
 * operational diagnostics projection (DB latency, Redis, scanners, email
 * worker). The business-integrity diagnostics block renders ONLY when the
 * backend includes it — the field is absent, not zeroed, for a caller without
 * the capability (who holds it is owned by the @exam/authz presets).
 *
 * Truthfulness rule: no secrets, no host paths.
 */
export function OperationsPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([
        api.get<SystemHealthResponse>("/api/system/health"),
        api.get<DiagnosticsResponse>("/api/system/diagnostics"),
      ]);
      setHealth(h);
      setDiag(d);
      setError(null);
      setStale(false);
    } catch (err) {
      setStale(true);
      // Functional state update — the callback closure must not read a stale
      // `error` value across polls.
      setError((prev) => (prev === null ? t("ops.errors.loadFailed") : prev));
      logger.warn("operations.poll_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => void loadAll(), HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadAll]);

  if (isLoading && !health) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("ops.title")} />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !health) {
    return (
      <div>
        <PageHeader title={t("ops.title")} />
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            void loadAll();
          }}
        />
      </div>
    );
  }

  return (
    <PageContainer role="admin-standard" className="space-y-6">
      <PageHeader title={t("ops.title")} description={t("ops.subtitle")} />

      {stale && <InlineErrorBanner>{t("ops.staleWarning")}</InlineErrorBanner>}

      {/* ── Overall health ── */}
      <section aria-label={t("ops.health.section")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label={t("ops.health.status")}
            value={health ? t(`ops.health.statusValue.${health.status}`) : "—"}
            icon={<AppIcon icon={HeartPulse} size="metric" />}
            supporting={
              health ? <StatusBadge status={health.status} /> : undefined
            }
          />
          <StatsCard
            label={t("ops.health.cpu")}
            value={health ? String(health.cpu) : "—"}
            suffix="%"
            icon={<AppIcon icon={MemoryStick} size="metric" />}
          />
          <StatsCard
            label={t("ops.health.memory")}
            value={health ? String(health.memory) : "—"}
            suffix="%"
            icon={<AppIcon icon={MemoryStick} size="metric" />}
          />
          <StatsCard
            label={t("ops.health.dbLatency")}
            value={health ? String(health.dbResponseMs) : "—"}
            suffix="ms"
            icon={<AppIcon icon={Database} size="metric" />}
          />
        </div>
      </section>

      {/* ── Runtime diagnostics (operational projection) ── */}
      <PageSection
        title={t("ops.diagnostics.title")}
        contentClassName="space-y-1"
      >
        {diag === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div
              data-slot="diagnostic-data-row"
              className="flex items-baseline justify-between gap-2 py-1"
            >
              <span className="type-secondary">
                {t("ops.diagnostics.dbLatency")}
              </span>
              <span className="type-numeric text-sm">{diag.dbLatency} ms</span>
            </div>
            <div
              data-slot="diagnostic-data-row"
              className="flex items-baseline justify-between gap-2 py-1"
            >
              <span className="type-secondary">
                {t("ops.diagnostics.redis")}
              </span>
              <span className="type-numeric text-sm">
                {diag.redisStatus.state}
                {diag.redisStatus.latencyMs !== null &&
                  ` · ${diag.redisStatus.latencyMs} ms`}
              </span>
            </div>
            <div
              data-slot="diagnostic-data-row"
              className="flex items-baseline justify-between gap-2 py-1"
            >
              <span className="type-secondary">
                {t("ops.diagnostics.heartbeatScanner")}
              </span>
              <span className="type-numeric text-sm">
                {diag.heartbeatStatus.lastScanAt
                  ? formatDateTime(new Date(diag.heartbeatStatus.lastScanAt))
                  : "—"}
                {" · "}
                {diag.heartbeatStatus.disruptedCount}
              </span>
            </div>
            <div
              data-slot="diagnostic-data-row"
              className="flex items-baseline justify-between gap-2 py-1"
            >
              <span className="type-secondary">
                {t("ops.diagnostics.deadlineScanner")}
              </span>
              <span className="type-numeric text-sm">
                {diag.deadlineScannerStatus.lastScanAt
                  ? formatDateTime(
                      new Date(diag.deadlineScannerStatus.lastScanAt),
                    )
                  : "—"}
                {" · "}
                {diag.deadlineScannerStatus.autoSubmitCount}
              </span>
            </div>
            <div
              data-slot="diagnostic-data-row"
              className="flex items-baseline justify-between gap-2 py-1"
            >
              <span className="type-secondary">
                {t("ops.diagnostics.emailWorker")}
              </span>
              <span className="type-numeric text-sm">
                {diag.emailStatus.status}
                {diag.emailStatus.worker.lastPollAt &&
                  ` · ${formatDateTime(
                    new Date(diag.emailStatus.worker.lastPollAt),
                  )}`}
              </span>
            </div>
          </>
        )}
      </PageSection>
    </PageContainer>
  );
}
