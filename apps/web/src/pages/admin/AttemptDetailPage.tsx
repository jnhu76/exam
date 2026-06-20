import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
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

/** Attempt statuses an admin may force-submit (transition to submitted→graded). */
const FORCE_SUBMITTABLE_STATUSES = new Set(["in_progress", "disrupted"]);

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forceReason, setForceReason] = useState("");
  const [forceSubmitting, setForceSubmitting] = useState(false);

  const loadResult = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    setLiveAttempt(null);
    try {
      const data = await api.get<AttemptResultResponse>(
        `/api/scores/attempts/${id}`,
      );
      if (data.showResultImmediately === true) {
        setResult(data);
      } else if (FORCE_SUBMITTABLE_STATUSES.has(data.status)) {
        // Active/abandoned attempt — admin may force-submit. Show the live
        // status instead of an error so the action button is reachable.
        setLiveAttempt({
          attemptId: data.attemptId,
          status: data.status,
          examTitle: data.examTitle,
        });
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

  const handleForceSubmit = useCallback(async () => {
    if (!liveAttempt) return;
    setForceSubmitting(true);
    try {
      await api.post(
        `/api/admin/attempts/${liveAttempt.attemptId}/force-submit`,
        {
          reason: forceReason.trim() || undefined,
        },
      );
      toast.success("已强制交卷");
      setForceDialogOpen(false);
      setForceReason("");
      await loadResult();
    } catch {
      toast.error("强制交卷失败，请稍后重试");
    } finally {
      setForceSubmitting(false);
    }
  }, [liveAttempt, forceReason, loadResult]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result && !liveAttempt) return null;

  // Live (in_progress/disrupted) attempt: admin force-submit action view.
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
              <div className="flex items-center gap-3">
                <StatusBadge status={liveAttempt.status} />
                <span className="text-sm text-muted-foreground">
                  该尝试尚未交卷，管理员可执行强制交卷。
                </span>
              </div>
              <Button
                variant="destructive"
                className="w-fit"
                onClick={() => setForceDialogOpen(true)}
              >
                强制交卷
              </Button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={forceDialogOpen} onOpenChange={setForceDialogOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-sm">
            <DialogHeader>
              <DialogTitle>确认强制交卷</DialogTitle>
              <DialogDescription>
                强制交卷将立即提交并评分该尝试，此操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <Label htmlFor="force-reason">原因（可选）</Label>
              <Textarea
                id="force-reason"
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                placeholder="例如：考生放弃考试"
                rows={3}
                maxLength={500}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setForceDialogOpen(false)}
                disabled={forceSubmitting}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={forceSubmitting}
                onClick={() => void handleForceSubmit()}
              >
                {forceSubmitting ? "提交中…" : "确认强制交卷"}
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
