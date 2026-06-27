import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AdminShell,
  AdminShellHeader,
  AdminPageCard,
  AdminStatusTag,
} from "@/components/admin";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Users } from "lucide-react";
import type {
  CandidateStatusItem,
  CandidateStatusResponse,
} from "@exam/contracts";

/** Polling interval for the proctor dashboard (ms). */
const POLL_INTERVAL_MS = 5_000;

/** Groups candidates into status categories for the proctor dashboard. */
interface StatusGroups {
  active: CandidateStatusItem[];
  disrupted: CandidateStatusItem[];
  submitted: CandidateStatusItem[];
  graded: CandidateStatusItem[];
}

/**
 * Groups an array of candidate status items by their attempt status.
 */
function groupByStatus(candidates: CandidateStatusItem[]): StatusGroups {
  const groups: StatusGroups = {
    active: [],
    disrupted: [],
    submitted: [],
    graded: [],
  };
  for (const c of candidates) {
    if (c.status === "in_progress") {
      groups.active.push(c);
    } else if (c.status === "disrupted") {
      groups.disrupted.push(c);
    } else if (c.status === "submitted" || c.status === "grading") {
      groups.submitted.push(c);
    } else if (c.status === "graded") {
      groups.graded.push(c);
    }
    // not_started / queued / voided are not displayed in the status card groups
  }
  return groups;
}

/**
 * Proctor dashboard for monitoring live exam candidates via HTTP polling.
 * Displays status cards grouped by attempt state and exposes action buttons
 * for force-submit, extend-time, and misconduct flag.
 */
export function ProctorDashboardPage() {
  const { id: examId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CandidateStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  // Action dialogs
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [extending, setExtending] = useState(false);
  const [extendTarget, setExtendTarget] = useState<CandidateStatusItem | null>(
    null,
  );

  const [misconductDialogOpen, setMisconductDialogOpen] = useState(false);
  const [misconductSeverity, setMisconductSeverity] = useState<
    "warning" | "serious"
  >("warning");
  const [misconductNotes, setMisconductNotes] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [misconductTarget, setMisconductTarget] =
    useState<CandidateStatusItem | null>(null);

  const [forceSubmitting, setForceSubmitting] = useState(false);

  /** Fetches candidate status from the API. */
  const loadStatus = useCallback(async () => {
    if (!examId) return;
    setError(null);
    try {
      const result = await api.get<CandidateStatusResponse>(
        `/api/admin/exams/${examId}/candidates/status`,
      );
      setData(result);
    } catch {
      setError("加载监考数据失败");
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    loadStatus();
    intervalRef.current = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadStatus]);

  /** Handles force-submit for a candidate. */
  async function handleForceSubmit(attemptId: string) {
    setForceSubmitting(true);
    try {
      await api.post(`/api/admin/attempts/${attemptId}/force-submit`, {
        reason: "管理员强制交卷",
      });
      toast.success("已强制交卷");
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "强制交卷失败");
    } finally {
      setForceSubmitting(false);
    }
  }

  /** Handles extend-time for a candidate. */
  async function handleExtendTime() {
    if (!extendTarget?.attemptId || extending) return;
    setExtending(true);
    try {
      await api.post(
        `/api/admin/attempts/${extendTarget.attemptId}/extend-time`,
        { additionalMinutes: extendMinutes },
      );
      toast.success(`已延长 ${extendMinutes} 分钟`);
      setExtendDialogOpen(false);
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "延长失败");
    } finally {
      setExtending(false);
    }
  }

  /** Handles misconduct flag for a candidate. */
  async function handleFlagMisconduct() {
    if (!misconductTarget?.attemptId || flagging) return;
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${misconductTarget.attemptId}/misconduct`,
        { severity: misconductSeverity, notes: misconductNotes || "监考标记" },
      );
      toast.success("已标记违规");
      setMisconductDialogOpen(false);
      setMisconductNotes("");
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "标记违规失败");
    } finally {
      setFlagging(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadStatus} />;
  if (!data) return null;

  const groups = groupByStatus(data.candidates);
  const hasAnyCandidates = data.candidates.length > 0;

  return (
    <AdminShell>
      <AdminShellHeader
        title="监考"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                void loadStatus();
              }}
            >
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              返回
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">全部 ({data.total})</TabsTrigger>
          <TabsTrigger value="active">
            答题中 ({groups.active.length})
          </TabsTrigger>
          <TabsTrigger value="disrupted">
            断线 ({groups.disrupted.length})
          </TabsTrigger>
          <TabsTrigger value="submitted">
            已交卷 ({groups.submitted.length})
          </TabsTrigger>
          <TabsTrigger value="graded">
            已出分 ({groups.graded.length})
          </TabsTrigger>
        </TabsList>

        {!hasAnyCandidates && (
          <div className="mt-4">
            <EmptyState
              icon={<Users className="size-8" />}
              title="暂无考生数据"
              description="目前没有正在考试的考生。"
            />
          </div>
        )}

        <TabsContent value="all" className="mt-4">
          {renderCards(data.candidates)}
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          {renderCards(groups.active)}
        </TabsContent>
        <TabsContent value="disrupted" className="mt-4">
          {renderCards(groups.disrupted)}
        </TabsContent>
        <TabsContent value="submitted" className="mt-4">
          {renderCards(groups.submitted)}
        </TabsContent>
        <TabsContent value="graded" className="mt-4">
          {renderCards(groups.graded)}
        </TabsContent>
      </Tabs>

      {/* Extend-time dialog */}
      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>延长时间</DialogTitle>
            <DialogDescription>
              为考生 {extendTarget?.name} 延长考试时间
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">延长分钟数</Label>
            <Input
              id="extend-minutes"
              type="number"
              min={1}
              value={extendMinutes}
              onChange={(e) =>
                setExtendMinutes(Number.parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtendDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={extending || extendMinutes <= 0}
              onClick={() => void handleExtendTime()}
            >
              {extending ? "延长中..." : `延长 ${extendMinutes} 分钟`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Misconduct dialog */}
      <Dialog
        open={misconductDialogOpen}
        onOpenChange={setMisconductDialogOpen}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>标记违规</DialogTitle>
            <DialogDescription>
              为考生 {misconductTarget?.name} 标记违规行为
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="misconduct-severity">严重程度</Label>
            <Select
              value={misconductSeverity}
              onValueChange={(v: "warning" | "serious") =>
                setMisconductSeverity(v)
              }
            >
              <SelectTrigger id="misconduct-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">警告</SelectItem>
                <SelectItem value="serious">严重</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="misconduct-notes">违规说明</Label>
            <Textarea
              id="misconduct-notes"
              value={misconductNotes}
              onChange={(e) => setMisconductNotes(e.target.value)}
              placeholder="请填写违规说明"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMisconductDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={flagging || !misconductNotes.trim()}
              onClick={() => void handleFlagMisconduct()}
            >
              {flagging ? "标记中..." : "确认标记"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );

  /** Renders a grid of candidate status cards. */
  function renderCards(items: CandidateStatusItem[]) {
    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Users className="size-8" />}
          title="暂无数据"
          description="当前筛选条件下没有考生。"
        />
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((candidate) => {
          const isLive =
            candidate.status === "in_progress" ||
            candidate.status === "disrupted";
          return (
            <Card key={candidate.candidateId} className="shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">
                    {candidate.name}
                  </span>
                  <AdminStatusTag status={candidate.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {candidate.deadlineAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">截止时间</span>
                    <span>
                      {new Date(candidate.deadlineAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                {candidate.lastActivityAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">最后活跃</span>
                    <span>
                      {new Date(candidate.lastActivityAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                {candidate.misconduct && (
                  <Badge
                    variant={
                      candidate.misconduct.severity === "serious"
                        ? "destructive"
                        : "secondary"
                    }
                    className="w-fit"
                  >
                    违规:{" "}
                    {candidate.misconduct.severity === "serious"
                      ? "严重"
                      : "警告"}
                  </Badge>
                )}
                {isLive && candidate.attemptId && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(candidate.status === "in_progress" ||
                      candidate.status === "disrupted") && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={forceSubmitting}
                          >
                            强制交卷
                          </Button>
                        }
                        title="确认强制交卷"
                        description={`确定要强制提交考生「${candidate.name}」的答卷吗？此操作不可撤销。`}
                        destructive
                        onConfirm={() =>
                          void handleForceSubmit(candidate.attemptId!)
                        }
                      />
                    )}
                    {candidate.attemptId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setExtendTarget(candidate);
                          setExtendMinutes(10);
                          setExtendDialogOpen(true);
                        }}
                      >
                        延长时间
                      </Button>
                    )}
                    {candidate.attemptId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMisconductTarget(candidate);
                          setMisconductSeverity("warning");
                          setMisconductNotes("");
                          setMisconductDialogOpen(true);
                        }}
                      >
                        标记违规
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }
}
