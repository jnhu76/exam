import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AdminShell,
  AdminShellHeader,
  AdminPageCard,
  AdminStatusTag,
} from "@/components/admin";
import {
  Play,
  Send,
  Save,
  WifiOff,
  RefreshCw,
  Clock,
  Timer,
  Flag,
  FileCheck2,
  CheckCircle2,
  HelpCircle,
  Download,
  FileJson,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TYPE_LABELS } from "@/lib/constants";
import type {
  AttemptTimelineEvent,
  AttemptTimelineResponse,
} from "@exam/contracts";

/**
 * Alias for {@link AttemptTimelineEvent} from the shared contracts package,
 * so the component reads naturally while staying in sync with the backend
 * schema (no type drift between frontend and backend).
 */
type TimelineEvent = AttemptTimelineEvent;

/** Tone classes for timeline event badges (semantic tokens only). */
type EventTone =
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "secondary"
  | "muted";

/** Display metadata for a known audit action: Chinese label, tone, and icon. */
interface EventMeta {
  label: string;
  tone: EventTone;
  icon: LucideIcon;
}

/**
 * Maps attempt-lifecycle audit actions to human-readable labels. Audit
 * *actions* are a distinct vocabulary from lifecycle *statuses*, so this lives
 * here rather than in statusMeta.ts. Unknown actions fall back to a muted
 * generic entry using the raw action string.
 */
const EVENT_META: Record<string, EventMeta> = {
  "attempt.start": { label: "开始答题", tone: "primary", icon: Play },
  "attempt.saveAnswer": { label: "保存答案", tone: "secondary", icon: Save },
  "attempt.disrupted": { label: "连接中断", tone: "warning", icon: WifiOff },
  "attempt.restore": { label: "重新连接", tone: "info", icon: RefreshCw },
  "attempt.submit": { label: "提交答卷", tone: "primary", icon: Send },
  "attempt.autoSubmit": { label: "自动交卷", tone: "secondary", icon: Send },
  "attempt.forceSubmit": {
    label: "管理员强制交卷",
    tone: "destructive",
    icon: Send,
  },
  "attempt.extendTime": {
    label: "管理员延长时长",
    tone: "warning",
    icon: Timer,
  },
  "attempt.misconductFlagged": {
    label: "标记违规",
    tone: "destructive",
    icon: Flag,
  },
  "grading.score_entered": {
    label: "录入评分",
    tone: "secondary",
    icon: FileCheck2,
  },
  "grading.finalized": {
    label: "评分完成",
    tone: "success",
    icon: CheckCircle2,
  },
};

/** Badge tone → Tailwind class mapping for timeline events. */
const eventToneClass: Record<EventTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  secondary: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
};

/** Resolves an audit action to its display metadata, falling back to muted. */
function getEventMeta(action: string): EventMeta {
  return (
    EVENT_META[action] ?? {
      label: action,
      tone: "muted",
      icon: HelpCircle,
    }
  );
}

/** Per-question grading result for a single exam attempt. */
interface QuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  type: string;
  content: string;
  order: number;
}

/** Attempt result returned when grading is complete and results are visible. */
interface VisibleAttemptResult {
  attemptId: string;
  status: "graded";
  showResultImmediately: true;
  examTitle: string;
  passingScore: number;
  totalScore: number;
  passed: boolean;
  gradedAt: string;
  questionResults: QuestionResult[];
}

/** Union of the visible attempt result and the hidden (not-yet-graded) response. */
type AttemptResultResponse =
  | VisibleAttemptResult
  | {
      attemptId: string;
      status: string;
      showResultImmediately: false;
      examTitle: string;
    };

/** Attempt statuses an admin may flag for misconduct. */
const FLAGGABLE_STATUSES = new Set(["in_progress", "disrupted"]);

/** Misconduct flag DTO (mirrors MisconductFlagDTO in @exam/contracts). */
interface MisconductFlag {
  flaggedAt: string;
  flaggedBy: string;
  notes: string;
  severity: "warning" | "serious";
}

/** Converts an answer value to a display-friendly string. */
function formatAnswer(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Triggers a download for one of the attempt export formats and surfaces a
 * toast on failure. Shared by the CSV and JSON export buttons.
 */
async function exportAttempt(
  attemptId: string,
  format: "csv" | "json",
): Promise<void> {
  try {
    if (format === "csv") {
      await downloadFile(
        `/api/admin/attempts/${attemptId}/export/csv`,
        `attempt-${attemptId}.csv`,
      );
    } else {
      await downloadFile(
        `/api/admin/attempts/${attemptId}/export`,
        `attempt-${attemptId}.json`,
      );
    }
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "导出失败，请稍后重试";
    toast.error(message);
  }
}

/** Props for the attempt export buttons (CSV + JSON). */
interface ExportButtonsProps {
  attemptId: string;
}

/**
 * Two outline buttons — 导出CSV and 导出JSON — that download the attempt via
 * the shared {@link downloadFile} helper (cookie-authenticated, cross-origin
 * safe). Reused by both the live and graded attempt views.
 */
function ExportButtons({ attemptId }: ExportButtonsProps) {
  return (
    <>
      <Button
        variant="outline"
        onClick={() => void exportAttempt(attemptId, "csv")}
      >
        <Download className="size-4" aria-hidden="true" />
        导出CSV
      </Button>
      <Button
        variant="outline"
        onClick={() => void exportAttempt(attemptId, "json")}
      >
        <FileJson className="size-4" aria-hidden="true" />
        导出JSON
      </Button>
    </>
  );
}

/** Props for the attempt lifecycle timeline section. */
interface TimelineSectionProps {
  events: TimelineEvent[] | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  expandedEventId: string | null;
  onToggleEvent: (id: string) => void;
}

/**
 * Card showing the chronological audit trail of an attempt. Reuses the shared
 * loading/error/empty states. Each event row expands to reveal its metadata.
 */
function TimelineSection({
  events,
  isLoading,
  hasError,
  onRetry,
  expandedEventId,
  onToggleEvent,
}: TimelineSectionProps) {
  return (
    <AdminPageCard title="答卷时间线">
      {isLoading ? (
        <LoadingState />
      ) : hasError ? (
        <ErrorState message="加载时间线失败" onRetry={onRetry} />
      ) : !events || events.length === 0 ? (
        <EmptyState
          icon={<Clock className="size-8" />}
          title="暂无时间线事件"
          description="该尝试的操作记录将显示在此"
        />
      ) : (
        <div className="flex flex-col gap-1">
          {events.map((event, index) => {
            const meta = getEventMeta(event.action);
            const Icon = meta.icon;
            const isExpanded = expandedEventId === event.id;
            return (
              <div key={event.id}>
                {index > 0 && <Separator className="my-1" />}
                <button
                  type="button"
                  onClick={() => onToggleEvent(event.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  aria-expanded={isExpanded}
                >
                  <span className="text-muted-foreground" aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={eventToneClass[meta.tone]}
                      >
                        {meta.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(event.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground truncate">
                      操作者 {event.actorId}
                    </span>
                  </span>
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-1 px-2 pb-2">
                    <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                    {event.ipAddress && (
                      <p className="text-xs text-muted-foreground">
                        IP: {event.ipAddress}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminPageCard>
  );
}

/**
 * Displays a graded exam attempt's score summary and per-question answer details.
 * Shows the earned score, passing threshold, and a table of each question with
 * the candidate's answer, standard answer, and points awarded.
 */
export function AttemptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<VisibleAttemptResult | null>(null);
  const [liveAttempt, setLiveAttempt] = useState<{
    attemptId: string;
    status: string;
    examTitle: string;
  } | null>(null);
  const [liveMisconduct, setLiveMisconduct] = useState<MisconductFlag | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Timeline fetch is independent of the result fetch so it can load and
  // render for any attempt status (live or graded).
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagSeverity, setFlagSeverity] = useState<"warning" | "serious">(
    "warning",
  );
  const [flagNotes, setFlagNotes] = useState("");
  const [flagging, setFlagging] = useState(false);

  const loadResult = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setLiveAttempt(null);
    setLiveMisconduct(null);
    try {
      const data = await api.get<AttemptResultResponse>(
        `/api/scores/attempts/${id}`,
      );
      if (data.showResultImmediately === true) {
        setResult(data);
      } else if (FLAGGABLE_STATUSES.has(data.status)) {
        setLiveAttempt({
          attemptId: data.attemptId,
          status: data.status,
          examTitle: data.examTitle,
        });
        // The hidden (non-graded) response does not expose misconduct; the
        // badge is shown once an admin flags it this session.
      } else {
        setError(
          data.status === "submitted"
            ? "该尝试已提交，等待评分"
            : data.status === "grading"
              ? "该尝试正在评分中"
              : data.status === "graded"
                ? "该尝试已评分，但成绩尚未公布"
                : "该尝试尚未完成评分或结果不可见",
        );
      }
    } catch {
      setError("加载尝试详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadResult();
  }, [loadResult]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    setTimelineLoading(true);
    setTimelineError(false);
    setTimeline(null);
    try {
      const data = await api.get<AttemptTimelineResponse>(
        `/api/admin/attempts/${id}/timeline`,
      );
      setTimeline(data.events);
    } catch {
      setTimelineError(true);
    } finally {
      setTimelineLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleFlag = useCallback(async () => {
    if (!liveAttempt) return;
    const notes = flagNotes.trim();
    if (!notes) {
      toast.error("请填写违规说明");
      return;
    }
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${liveAttempt.attemptId}/misconduct`,
        { severity: flagSeverity, notes },
      );
      toast.success("已标记违规");
      setFlagDialogOpen(false);
      setFlagNotes("");
      setLiveMisconduct({
        flaggedAt: new Date().toISOString(),
        flaggedBy: "",
        notes,
        severity: flagSeverity,
      });
    } catch {
      toast.error("标记违规失败，请稍后重试");
    } finally {
      setFlagging(false);
    }
  }, [liveAttempt, flagSeverity, flagNotes]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result && !liveAttempt)
    return (
      <ErrorState message="答题数据加载异常，请重试" onRetry={loadResult} />
    );

  // Live (in_progress/disrupted) attempt: admin misconduct-flag action view.
  if (liveAttempt && !result) {
    return (
      <AdminShell>
        <AdminShellHeader
          title={`${liveAttempt.examTitle} - 答卷详情`}
          actions={
            <div className="flex gap-2">
              <ExportButtons attemptId={id!} />
              <Button variant="outline" onClick={() => void navigate(-1)}>
                返回
              </Button>
            </div>
          }
        />
        <AdminPageCard title="尝试状态">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <AdminStatusTag status={liveAttempt.status} />
              {liveMisconduct && (
                <AdminStatusTag
                  status={`misconduct_${liveMisconduct.severity}`}
                />
              )}
              {liveMisconduct && (
                <span className="text-sm text-muted-foreground">
                  {liveMisconduct.notes}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => setFlagDialogOpen(true)}
            >
              标记违规
            </Button>
          </div>
        </AdminPageCard>

        <TimelineSection
          events={timeline}
          isLoading={timelineLoading}
          hasError={timelineError}
          onRetry={loadTimeline}
          expandedEventId={expandedEventId}
          onToggleEvent={toggleEvent}
        />

        <Dialog open={flagDialogOpen} onOpenChange={setFlagDialogOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-sm">
            <DialogHeader>
              <DialogTitle>标记违规</DialogTitle>
              <DialogDescription>
                标记违规用于记录考生异常行为，不会改变尝试状态。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="flag-severity">严重程度</Label>
                <Select
                  value={flagSeverity}
                  onValueChange={(v) =>
                    setFlagSeverity(v as "warning" | "serious")
                  }
                >
                  <SelectTrigger id="flag-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">警告</SelectItem>
                    <SelectItem value="serious">严重</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="flag-notes">违规说明</Label>
                <Textarea
                  id="flag-notes"
                  value={flagNotes}
                  onChange={(e) => setFlagNotes(e.target.value)}
                  placeholder="例如：考生查看手机"
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setFlagDialogOpen(false)}
                disabled={flagging}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={flagging}
                onClick={() => void handleFlag()}
              >
                {flagging ? "提交中…" : "确认标记"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminShell>
    );
  }

  // Past this point the attempt is graded with a visible result.
  if (!result)
    return (
      <ErrorState message="成绩数据加载异常，请重试" onRetry={loadResult} />
    );

  const sortedQuestions = [...result.questionResults].sort(
    (a, b) => a.order - b.order,
  );
  const earnedScore = sortedQuestions.reduce((sum, q) => sum + q.score, 0);

  return (
    <AdminShell>
      <AdminShellHeader
        title={`${result.examTitle} - 答卷详情`}
        actions={
          <div className="flex gap-2">
            <ExportButtons attemptId={id!} />
            <Button variant="outline" onClick={() => void navigate(-1)}>
              返回
            </Button>
          </div>
        }
      />

      <AdminPageCard title="成绩概览">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">总分</p>
            <p className="text-3xl font-bold tabular-nums">
              {result.totalScore}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">得分</p>
            <p
              data-testid="earned-score"
              className={`text-3xl font-bold tabular-nums ${result.passed ? "text-success" : "text-destructive"}`}
            >
              {earnedScore}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">及格线</p>
            <p className="text-3xl font-bold tabular-nums">
              {result.passingScore}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">状态</p>
            <AdminStatusTag status={result.passed ? "passed" : "not_passed"} />
          </div>
        </div>
      </AdminPageCard>

      <AdminPageCard title="答题详情">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">题号</TableHead>
              <TableHead>题目</TableHead>
              <TableHead>题型</TableHead>
              <TableHead>考生答案</TableHead>
              <TableHead>标准答案</TableHead>
              <TableHead className="text-right">得分</TableHead>
              <TableHead className="text-right">满分</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedQuestions.map((q) => (
              <TableRow key={q.questionId}>
                <TableCell className="font-medium">{q.order}</TableCell>
                <TableCell className="max-w-md truncate" title={q.content}>
                  {q.content}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {TYPE_LABELS[q.type] ?? q.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={q.correct ? "default" : "destructive"}>
                    {formatAnswer(q.candidateAnswer)}
                  </Badge>
                </TableCell>
                <TableCell>{formatAnswer(q.standardAnswer)}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {q.score}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {q.maxScore}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminPageCard>

      <TimelineSection
        events={timeline}
        isLoading={timelineLoading}
        hasError={timelineError}
        onRetry={loadTimeline}
        expandedEventId={expandedEventId}
        onToggleEvent={toggleEvent}
      />
    </AdminShell>
  );
}
