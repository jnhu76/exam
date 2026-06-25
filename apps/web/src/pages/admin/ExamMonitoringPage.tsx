import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router";
import type {
  ProctorAttemptListResponse,
  ProctorAttemptStatus,
  ProctorAttemptEventListResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CircleAlert,
  RefreshCw,
  Monitor,
  User,
  Timer,
  EyeOff,
  WifiOff,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Activity,
} from "lucide-react";

const POLL_INTERVAL_MS = 15_000;

const ONLINE_LABEL: Record<string, string> = {
  online: "在线",
  stale: "离线中",
  offline: "离线",
};

const ONLINE_COLOR: Record<string, string> = {
  online: "bg-success text-success-foreground",
  stale: "bg-warning text-warning-foreground",
  offline: "bg-destructive text-destructive-foreground",
};

const WARNING_LABEL: Record<string, string> = {
  normal: "正常",
  warning: "需关注",
  critical: "需立即关注",
};

const WARNING_ICON: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  normal: Activity,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const WARNING_COLOR: Record<string, string> = {
  normal: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  critical: "bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: "考试中",
  disrupted: "已中断",
  submitted: "已提交",
  grading: "评分中",
  graded: "已评分",
  voided: "已作废",
};

export function ExamMonitoringPage() {
  const { examId } = useParams<{ examId: string }>();
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
      if (attempts.length === 0) {
        setLoadError("加载监控数据失败");
      } else {
        setStaleWarning("监控数据刷新失败，当前为上次成功数据");
        logger.warn("monitoring.poll_failed", { examId });
      }
    } finally {
      setIsLoading(false);
    }
  }, [examId, attempts.length]);

  const loadTimeline = useCallback(async (attemptId: string) => {
    setTimelineLoading(true);
    setTimeline(null);
    try {
      const data = await api.get<ProctorAttemptEventListResponse>(
        `/api/admin/attempts/${attemptId}/proctor-events?limit=50`,
      );
      setTimeline(data);
    } catch {
      // Swallow — timeline is secondary to the list.
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttempts();
    const interval = setInterval(loadAttempts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAttempts]);

  useEffect(() => {
    if (selectedAttemptId) loadTimeline(selectedAttemptId);
  }, [selectedAttemptId, loadTimeline]);

  if (isLoading && attempts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="考试监控" />
        <LoadingState label="正在加载监控数据..." />
      </div>
    );
  }

  if (loadError && attempts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="考试监控" />
        <ErrorState message={loadError} onRetry={loadAttempts} />
      </div>
    );
  }

  const selectedAttempt = attempts.find(
    (a) => a.attemptId === selectedAttemptId,
  );

  return (
    <div className="flex flex-col gap-6">
      {staleWarning && (
        <Alert variant="default">
          <CircleAlert />
          <AlertDescription>{staleWarning}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <PageHeader title="考试监控" />
        <div className="flex items-center gap-3">
          {lastRefreshedAt !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              上次刷新：{new Date(lastRefreshedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-label="刷新监控数据"
            onClick={() => {
              setIsLoading(true);
              loadAttempts();
            }}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      {attempts.length === 0 ? (
        <EmptyState
          icon={<Monitor className="size-8" />}
          title="暂无活跃考生"
          description="当前没有正在考试的候选人"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <Th>候选人</Th>
                <Th>考试状态</Th>
                <Th>在线状态</Th>
                <Th>最近心跳</Th>
                <Th>最近保存</Th>
                <Th>页面不可见</Th>
                <Th>网络离线</Th>
                <Th>保存失败</Th>
                <Th>提交失败</Th>
                <Th>关注级别</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr
                  key={a.attemptId}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <User className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-32">
                        {a.candidateName}
                      </span>
                    </div>
                  </Td>
                  <Td>{STATUS_LABEL[a.status] ?? a.status}</Td>
                  <Td>
                    <Badge
                      variant="secondary"
                      className={ONLINE_COLOR[a.onlineState]}
                    >
                      {ONLINE_LABEL[a.onlineState]}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">
                    {a.lastHeartbeatAt ? formatTimeAgo(a.lastHeartbeatAt) : "—"}
                  </Td>
                  <Td className="tabular-nums">
                    {a.lastSaveAt ? formatTimeAgo(a.lastSaveAt) : "—"}
                  </Td>
                  <Td className="tabular-nums text-center">
                    {a.visibilityLostCount}
                  </Td>
                  <Td className="tabular-nums text-center">
                    {a.browserOfflineCount}
                  </Td>
                  <Td className="tabular-nums text-center">
                    {a.saveFailedCount}
                  </Td>
                  <Td className="tabular-nums text-center">
                    {a.submitFailedCount}
                  </Td>
                  <Td>
                    <Badge
                      variant="secondary"
                      className={WARNING_COLOR[a.warningLevel]}
                    >
                      <span className="flex items-center gap-1">
                        {(() => {
                          const Icon = WARNING_ICON[a.warningLevel];
                          return Icon ? <Icon className="size-3" /> : null;
                        })()}
                        {WARNING_LABEL[a.warningLevel]}
                      </span>
                    </Badge>
                  </Td>
                  <Td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAttemptId(a.attemptId)}
                    >
                      时间线
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!selectedAttemptId}
        onOpenChange={(open) => {
          if (!open) setSelectedAttemptId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              事件时间线 — {selectedAttempt?.candidateName ?? ""}
            </DialogTitle>
          </DialogHeader>
          {timelineLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : timeline && timeline.items.length > 0 ? (
            <div className="flex flex-col gap-1">
              {timeline.items.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 rounded-md border p-2 text-xs"
                >
                  <span className="text-muted-foreground shrink-0 w-16 tabular-nums">
                    {new Date(ev.occurredAt).toLocaleTimeString()}
                  </span>
                  <EventBadge level={ev.level} kind={ev.kind} />
                  <span className="font-medium">{ev.name}</span>
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
            <p className="text-sm text-muted-foreground">暂无事件</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</td>
  );
}

function EventBadge({ level, kind }: { level: string; kind: string }) {
  const color =
    level === "error"
      ? "bg-destructive/10 text-destructive"
      : level === "warn"
        ? "bg-warning/10 text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={`shrink-0 ${color}`}>
      {kind === "audit_log" ? "操作" : "前端"}
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
