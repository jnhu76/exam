import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Permission } from "@exam/authz";
import type {
  SystemHealthResponse,
  DiagnosticsResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { can } from "@/lib/capabilities";
import { useAuth } from "@/hooks/useAuth";
import {
  useOperationsSource,
  type OperationsSourceView,
} from "@/hooks/useOperationsSource";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { StatsCard } from "@/components/shared/StatsCard";
import { PageSection } from "@/components/shared/PageSection";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { PageContainer } from "@/components/shared/PageContainer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AccessDeniedPage } from "@/pages/admin/AccessDeniedPage";
import { Database, HeartPulse, MemoryStick, RefreshCw } from "lucide-react";

const POLL_MS = 15_000;
/** Snapshot freshness window: two polling periods (#1032 page-local default). */
const STALE_AFTER_MS = 2 * POLL_MS;
/** Per-request deadline — follows the useSubmitFlush 10s client convention. */
const REQUEST_TIMEOUT_MS = 10_000;

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
 * The two sources are independent (#1032): each owns its snapshot, receive
 * time, polling slot, and error state, so a slow, hung, or failed source can
 * never blank or freeze the other. Diagnostics reads are gated by the
 * capability union (a primary Teacher with an active secondary Maintainer
 * assignment sees the same projection as Admin); a proven 403/401 collapses
 * the affected access instead of degrading into fabricated data.
 *
 * Truthfulness rule: no secrets, no host paths.
 */
export function OperationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Capability union (assignment-backed), never the primary role label. The
  // overview entry itself stays guarded by the admin route guard + the health
  // API guard; only the diagnostics read is client-gated here.
  const canDiagnose = user
    ? can(user, Permission.SystemDiagnosticsView)
    : false;
  // Per-source session identity: a change aborts in-flight reads, discards
  // the previous identity's snapshot, and restarts polling. The diagnostics
  // source's key includes its capability bit so a known revoke stops its
  // reads immediately.
  const sessionBase = user ? user.id : "anonymous";

  const {
    view: healthView,
    refresh: refreshHealth,
    invalidate: invalidateHealth,
  } = useOperationsSource<SystemHealthResponse>({
    read: (signal) => api.get("/api/system/health", { signal }),
    sessionKey: `health|${sessionBase}`,
    pollMs: POLL_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    logSource: "health",
  });
  const {
    view: diagView,
    refresh: refreshDiag,
    invalidate: invalidateDiag,
  } = useOperationsSource<DiagnosticsResponse>({
    read: (signal) => api.get("/api/system/diagnostics", { signal }),
    enabled: canDiagnose,
    sessionKey: `diagnostics|${sessionBase}|${canDiagnose}`,
    pollMs: POLL_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    logSource: "diagnostics",
  });

  const healthDenied = healthView.failure === "denied";
  const authLost = healthView.failure === "auth" || diagView.failure === "auth";

  // A 401 anywhere on this page means the session is gone: the API client
  // owns the login redirect; this page invalidates every snapshot and
  // in-flight read so nothing of the previous session survives. The effect
  // depends on the hook's stable callbacks, never its per-render container.
  useEffect(() => {
    if (!authLost) return;
    invalidateHealth();
    invalidateDiag();
  }, [authLost, invalidateHealth, invalidateDiag]);

  // A proven 403 on the overview ENTRY capability (health) is an
  // authorization loss for the whole protected surface: the diagnostics
  // source is invalidated too and the page collapses to the denied state.
  useEffect(() => {
    if (!healthDenied) return;
    invalidateDiag();
  }, [healthDenied, invalidateDiag]);

  if (healthDenied) {
    return <AccessDeniedPage />;
  }

  return (
    <PageContainer role="admin-standard" className="space-y-6">
      <PageHeader title={t("ops.title")} description={t("ops.subtitle")} />

      {/* ── Overall health ── */}
      <section aria-label={t("ops.health.section")} className="space-y-3">
        <SourceStatusBar
          view={healthView}
          retryLabel={t("ops.sources.health.retry")}
          onRetry={refreshHealth}
          staleText={t("ops.sources.health.stale")}
        />
        {!healthView.settled ? (
          <Skeleton className="h-24 w-full" />
        ) : healthView.snapshot === null ? (
          <p className="type-secondary px-1 py-6">
            {t("ops.sources.health.unavailable")}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label={t("ops.health.status")}
              value={t(`ops.health.statusValue.${healthView.snapshot.status}`)}
              icon={<AppIcon icon={HeartPulse} size="metric" />}
              supporting={<StatusBadge status={healthView.snapshot.status} />}
            />
            <StatsCard
              label={t("ops.health.cpu")}
              value={String(healthView.snapshot.cpu)}
              suffix="%"
              icon={<AppIcon icon={MemoryStick} size="metric" />}
            />
            <StatsCard
              label={t("ops.health.memory")}
              value={String(healthView.snapshot.memory)}
              suffix="%"
              icon={<AppIcon icon={MemoryStick} size="metric" />}
            />
            <StatsCard
              label={t("ops.health.dbLatency")}
              value={String(healthView.snapshot.dbResponseMs)}
              suffix="ms"
              icon={<AppIcon icon={Database} size="metric" />}
            />
          </div>
        )}
      </section>

      {/* ── Runtime diagnostics (operational projection) ── */}
      {canDiagnose && (
        <PageSection
          title={t("ops.diagnostics.title")}
          contentClassName="space-y-1"
          actions={
            <SourceStatusBar
              view={diagView}
              retryLabel={t("ops.sources.diagnostics.retry")}
              onRetry={refreshDiag}
              staleText={t("ops.sources.diagnostics.stale")}
            />
          }
        >
          {!diagView.settled ? (
            <Skeleton className="h-24 w-full" />
          ) : diagView.failure === "denied" ? (
            <p className="type-secondary px-1 py-6">
              {t("ops.sources.diagnostics.denied")}
            </p>
          ) : diagView.snapshot === null ? (
            <p className="type-secondary px-1 py-6">
              {t("ops.sources.diagnostics.unavailable")}
            </p>
          ) : (
            <DiagnosticsRows diag={diagView.snapshot} />
          )}
        </PageSection>
      )}
    </PageContainer>
  );
}

function DiagnosticsRows({ diag }: { diag: DiagnosticsResponse }) {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  return (
    <>
      <div
        data-slot="diagnostic-data-row"
        className="flex items-baseline justify-between gap-2 py-1"
      >
        <span className="type-secondary">{t("ops.diagnostics.dbLatency")}</span>
        <span className="type-numeric text-sm">{diag.dbLatency} ms</span>
      </div>
      <div
        data-slot="diagnostic-data-row"
        className="flex items-baseline justify-between gap-2 py-1"
      >
        <span className="type-secondary">{t("ops.diagnostics.redis")}</span>
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
            ? formatDateTime(new Date(diag.deadlineScannerStatus.lastScanAt))
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
  );
}

/**
 * Per-source status line: receive time ("最近成功接收"), manual retry, and the
 * source-scoped stale banner. The stale marker covers both failure-kept and
 * age-expired snapshots; a source without a snapshot shows its unavailable or
 * denied text through the caller's body slot instead.
 */
function SourceStatusBar({
  view,
  retryLabel,
  onRetry,
  staleText,
}: {
  view: OperationsSourceView<unknown>;
  retryLabel: string;
  onRetry: () => void;
  staleText: string;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const stale =
    view.snapshot !== null &&
    (view.failure === "network" ||
      view.failure === "timeout" ||
      (view.receivedAt !== null &&
        Date.now() - view.receivedAt >= STALE_AFTER_MS));
  return (
    <div className="flex flex-wrap items-center gap-3">
      {view.receivedAt !== null && (
        <span className="type-metadata">
          {t("ops.lastReceived", { time: formatDateTime(view.receivedAt) })}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={retryLabel}
        onClick={onRetry}
      >
        <AppIcon icon={RefreshCw} size="inline" />
      </Button>
      {stale && <InlineErrorBanner>{staleText}</InlineErrorBanner>}
    </div>
  );
}
