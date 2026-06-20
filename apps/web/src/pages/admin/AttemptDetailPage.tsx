import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        `/api/admin/attempts/${liveAttempt.attemptId}/flag-misconduct`,
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
  if (!result && !liveAttempt) return null;

  // Live (in_progress/disrupted) attempt: admin misconduct-flag action view.
  if (liveAttempt && !result) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={`${liveAttempt.examTitle} - 答卷详情`}
          actions={
            <Button variant="outline" onClick={() => void navigate(-1)}>
              返回
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">尝试状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={liveAttempt.status} />
                {liveMisconduct && (
                  <StatusBadge
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
          </CardContent>
        </Card>

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
      </div>
    );
  }

  // Past this point the attempt is graded with a visible result.
  if (!result) return null;

  const sortedQuestions = [...result.questionResults].sort(
    (a, b) => a.order - b.order,
  );
  const earnedScore = sortedQuestions.reduce((sum, q) => sum + q.score, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${result.examTitle} - 答卷详情`}
        actions={
          <Button variant="outline" onClick={() => void navigate(-1)}>
            返回
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">成绩概览</CardTitle>
        </CardHeader>
        <CardContent>
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
              <StatusBadge
                status={result.passed ? "passed" : "not_passed"}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">答题详情</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
