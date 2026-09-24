import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import type {
  ProctorAttemptListResponse,
  ProctorAttemptStatus,
  ProctorAttemptEventListResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { getStatusMeta } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/shared/PageContainer";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { RowActions } from "@/components/shared/RowActions";
import {
  CircleAlert,
  RefreshCw,
  Monitor,
  User,
  TriangleAlert,
  Activity,
  type LucideIcon,
} from "lucide-react";

const POLL_INTERVAL_MS = 15_000;

const ONLINE_LABEL_KEY: Record<string, string> = {
  online: "admin.examMonitoring.onlineLabels.online",
  stale: "admin.examMonitoring.onlineLabels.stale",
  offline: "admin.examMonitoring.onlineLabels.offline",
};

const ONLINE_COLOR: Record<string, string> = {
  online: "bg-success text-success-foreground",
  stale: "bg-warning text-warning-foreground",
  offline: "bg-destructive text-destructive-foreground",
};

const WARNING_LABEL_KEY: Record<string, string> = {
  normal: "admin.examMonitoring.warningLabels.normal",
  warning: "admin.examMonitoring.warningLabels.warning",
  critical: "admin.examMonitoring.warningLabels.critical",
};

const WARNING_ICON: Record<string, LucideIcon> = {
  normal: Activity,
  warning: TriangleAlert,
  critical: CircleAlert,
};

const WARNING_COLOR: Record<string, string> = {
  normal: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  critical: "bg-destructive/10 text-destructive",
};

export function ExamMonitoringPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { id: examId } = useParams<{ id: string }>();
  const [attempts, setAttempts] = useState<ProctorAttemptStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );
  const [timeline, setTimeline] =
    useState<ProctorAttemptEventListResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;

  const loadAttempts = useCallback(async () => {
    if (!examId) return;
    try {
      const data = await api.get<ProctorAttemptListResponse>(
        `/api/admin/exams/${examId}/proctor/attempts`,
      );
      setAttempts(data.items);
      setStaleWarning(null);
      setLastRefreshedAt(Date.now());
    } catch {
      if (attemptsRef.current.length === 0) {
        setLoadError(t("admin.examMonitoring.loadDataFailed"));
      } else {
        setStaleWarning(t("admin.examMonitoring.pollFailed"));
        logger.warn("monitoring.poll_failed", { examId });
      }
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  const loadTimeline = useCallback(async (attemptId: string) => {
    setTimelineLoading(true);
    setTimeline(null);
    setTimelineError(null);
    try {
      const data = await api.get<ProctorAttemptEventListResponse>(
        `/api/admin/attempts/${attemptId}/proctor-events?limit=50`,
      );
      setTimeline(data);
    } catch {
      setTimelineError(t("admin.examMonitoring.timelineLoadFailed"));
      logger.warn("monitoring.timeline_load_failed", { attemptId });
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadAttempts();
      }
    };

    loadAttempts();
    const interval = setInterval(loadAttempts, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadAttempts]);

  useEffect(() => {
    if (selectedAttemptId) loadTimeline(selectedAttemptId);
  }, [selectedAttemptId, loadTimeline]);

  // Refresh time labels every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const columns = useMemo<DataViewColumnDef<ProctorAttemptStatus>[]>(
    () => [
      {
        id: "candidateName",
        meta: { role: "primary-text" },
        header: t("admin.examMonitoring.columns.candidate"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <AppIcon
              icon={User}
              size="badge"
              className="text-muted-foreground shrink-0"
            />
            <span className="min-w-0">{row.original.candidateName}</span>
          </span>
        ),
      },
      {
        id: "status",
        meta: { role: "status" },
        header: t("admin.examMonitoring.columns.status"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "onlineState",
        meta: { role: "type", priority: "normal" },
        header: t("admin.examMonitoring.columns.online"),
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={ONLINE_COLOR[row.original.onlineState]}
          >
            {t(
              ONLINE_LABEL_KEY[
                row.original.onlineState
              ] as "admin.examMonitoring.onlineLabels.online",
            )}
          </Badge>
        ),
      },
      {
        id: "lastHeartbeatAt",
        meta: { role: "duration" },
        header: t("admin.examMonitoring.columns.lastHeartbeat"),
        cell: ({ row }) =>
          row.original.lastHeartbeatAt
            ? formatTimeAgo(row.original.lastHeartbeatAt)
            : "—",
      },
      {
        id: "lastSaveAt",
        meta: { role: "duration" },
        header: t("admin.examMonitoring.columns.lastSave"),
        cell: ({ row }) =>
          row.original.lastSaveAt
            ? formatTimeAgo(row.original.lastSaveAt)
            : "—",
      },
      {
        id: "visibilityLostCount",
        meta: { role: "number" },
        header: t("admin.examMonitoring.columns.visibilityLost"),
        cell: ({ row }) => row.original.visibilityLostCount,
      },
      {
        id: "browserOfflineCount",
        meta: { role: "number" },
        header: t("admin.examMonitoring.columns.browserOffline"),
        cell: ({ row }) => row.original.browserOfflineCount,
      },
      {
        id: "saveFailedCount",
        meta: { role: "number" },
        header: t("admin.examMonitoring.columns.saveFailed"),
        cell: ({ row }) => row.original.saveFailedCount,
      },
      {
        id: "submitFailedCount",
        meta: { role: "number" },
        header: t("admin.examMonitoring.columns.submitFailed"),
        cell: ({ row }) => row.original.submitFailedCount,
      },
      {
        id: "warningLevel",
        meta: { role: "type", priority: "normal" },
        header: t("admin.examMonitoring.columns.warningLevel"),
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={WARNING_COLOR[row.original.warningLevel]}
          >
            <span className="flex items-center gap-1">
              {(() => {
                const Icon = WARNING_ICON[row.original.warningLevel];
                return Icon ? <AppIcon icon={Icon} size="badge" /> : null;
              })()}
              {t(
                WARNING_LABEL_KEY[
                  row.original.warningLevel
                ] as "admin.examMonitoring.warningLabels.normal",
              )}
            </span>
          </Badge>
        ),
      },
      {
        id: "actions",
        meta: { role: "actions" },
        header: t("admin.examMonitoring.columns.actions"),
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            actions={[
              {
                id: "timeline",
                label: t("admin.examMonitoring.timeline.button"),
                icon: History,
                onSelect: () => setSelectedAttemptId(row.original.attemptId),
              },
            ]}
          />
        ),
      },
    ],
    [t],
  );

  if (isLoading && attempts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("admin.examMonitoring.pageTitle")} />
        <LoadingState label={t("admin.examMonitoring.loadingLabel")} />
      </div>
    );
  }

  if (loadError && attempts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("admin.examMonitoring.pageTitle")} />
        <ErrorState message={loadError} onRetry={loadAttempts} />
      </div>
    );
  }

  const selectedAttempt = attempts.find(
    (a) => a.attemptId === selectedAttemptId,
  );

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      {staleWarning && (
        <Alert variant="default">
          <AppIcon icon={CircleAlert} size="inline" />
          <AlertDescription>{staleWarning}</AlertDescription>
        </Alert>
      )}
      <PageHeader
        title={t("admin.examMonitoring.pageTitle")}
        actions={
          <div className="flex items-center gap-3">
            {lastRefreshedAt !== null && (
              <span className="type-numeric text-xs text-muted-foreground">
                {t("admin.examMonitoring.lastRefreshed", {
                  time: formatTime(lastRefreshedAt),
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label={t("admin.examMonitoring.ariaRefresh")}
              onClick={() => {
                setIsLoading(true);
                loadAttempts();
              }}
            >
              <AppIcon icon={RefreshCw} size="inline" />
            </Button>
          </div>
        }
      />

      {attempts.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Monitor} size="state" />}
          title={t("admin.examMonitoring.emptyTitle")}
          description={t("admin.examMonitoring.emptyDescription")}
        />
      ) : (
        <DataTableShell archetype="log-diagnostic">
          <DesktopDataTable columns={columns} data={attempts} />
        </DataTableShell>
      )}

      <Dialog
        open={!!selectedAttemptId}
        onOpenChange={(open) => {
          if (!open) setSelectedAttemptId(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {t("admin.examMonitoring.timeline.title", {
                name: selectedAttempt?.candidateName ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {/* dialog-body owns the vertical scroll; the header stays fixed. */}
          <div data-slot="dialog-body" className="flex flex-col gap-1">
            {timelineLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : timelineError ? (
              <Alert variant="destructive">
                <AppIcon icon={CircleAlert} size="inline" />
                <AlertDescription>{timelineError}</AlertDescription>
              </Alert>
            ) : timeline && timeline.items.length > 0 ? (
              <div className="flex flex-col gap-1">
                {timeline.items.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-3 rounded-md border p-2 text-xs"
                  >
                    <span className="text-muted-foreground shrink-0 w-16 type-numeric">
                      {formatTime(ev.occurredAt)}
                    </span>
                    <EventBadge level={ev.level} kind={ev.kind} />
                    <span>{ev.name}</span>
                    {ev.route && (
                      <span className="text-muted-foreground truncate max-w-32">
                        {ev.route}
                      </span>
                    )}
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <span className="text-muted-foreground">
                        {JSON.stringify(ev.metadata)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="type-secondary">
                {t("admin.examMonitoring.timeline.noEvents")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function EventBadge({ level, kind }: { level: string; kind: string }) {
  const { t } = useTranslation();
  let color: string;
  if (level === "error") {
    color = "bg-destructive/10 text-destructive";
  } else if (level === "warn") {
    color = "bg-warning/10 text-warning";
  } else {
    color = "bg-muted text-muted-foreground";
  }
  return (
    <Badge variant="secondary" className={`shrink-0 ${color}`}>
      {kind === "audit_log"
        ? t("admin.examMonitoring.timeline.auditLog")
        : t("admin.examMonitoring.timeline.frontend")}
    </Badge>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h`;
}
