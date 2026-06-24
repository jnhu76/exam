import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export function validateScore(score: number, maxScore: number): string | null {
  if (score < 0) return "分数不能为负数";
  if (score > maxScore) return `分数不能超过满分 (${maxScore})`;
  return null;
}

function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null || answer === "") return "未作答";
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean") return answer ? "正确" : "错误";
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>)
      .map(formatAnswer)
      .join("、");
  }
  return String(answer);
}

interface GradingEntry {
  score: number;
  comment: string;
  gradedBy: string;
  gradedAt: string;
}

interface GradingQuestion {
  questionId: string;
  type: string;
  content: string;
  maxScore: number;
  candidateAnswer: unknown;
  entry: GradingEntry | null;
}

interface GradingDetailData {
  attemptId: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  gradingStatus: string;
  questions: GradingQuestion[];
}

interface GradeQuestionResponse {
  attemptId: string;
  gradingStatus: string;
  questionId: string;
  score: number;
  fullyGraded: boolean;
}

export function GradingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<GradingDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<GradingDetailData>(
        `/api/admin/attempts/${id}/grading-details`,
      );
      setData(result);
      const initialScores: Record<string, number> = {};
      const initialComments: Record<string, string> = {};
      for (const q of result.questions) {
        initialScores[q.questionId] = q.entry?.score ?? 0;
        initialComments[q.questionId] = q.entry?.comment ?? "";
      }
      setScores(initialScores);
      setComments(initialComments);
    } catch {
      setError("加载评分详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleSave = useCallback(
    async (questionId: string, maxScore: number) => {
      const score = scores[questionId] ?? 0;
      const err = validateScore(score, maxScore);
      if (err) {
        setValidationErrors((prev) => ({ ...prev, [questionId]: err }));
        return;
      }
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setSaving((prev) => ({ ...prev, [questionId]: true }));
      try {
        const result = await api.post<GradeQuestionResponse>(
          `/api/admin/attempts/${id}/grade-question`,
          {
            questionId,
            score,
            comment: comments[questionId] ?? "",
          },
        );
        setData((prev) =>
          prev ? { ...prev, gradingStatus: result.gradingStatus } : prev,
        );
        if (result.fullyGraded) {
          toast.success("评分已完成");
        } else {
          toast.success("评分已保存");
        }
      } catch {
        toast.error("保存失败，请重试");
      } finally {
        setSaving((prev) => ({ ...prev, [questionId]: false }));
      }
    },
    [id, scores, comments],
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadDetail} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="手动评分"
        description={`${data.examTitle} — ${data.candidateName}`}
        actions={
          <Button
            variant="ghost"
            onClick={() => navigate("/admin/grading-queue")}
          >
            <ArrowLeft className="mr-2 size-4" />
            返回队列
          </Button>
        }
        status={<StatusBadge status={data.gradingStatus} />}
      />
      {data.questions.map((q) => (
        <Card key={q.questionId}>
          <CardHeader>
            <CardTitle className="text-base">{q.content}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>满分: {q.maxScore}</span>
              <span>·</span>
              <span>主观题</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>考生作答</Label>
              <div
                data-testid={`grading-candidate-answer-${q.questionId}`}
                className="min-h-16 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap"
              >
                {formatAnswer(q.candidateAnswer)}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`score-${q.questionId}`}>分数</Label>
              <Input
                id={`score-${q.questionId}`}
                data-testid={`grading-score-input-${q.questionId}`}
                type="number"
                min={0}
                max={q.maxScore}
                value={scores[q.questionId] ?? ""}
                onChange={(e) =>
                  setScores((prev) => ({
                    ...prev,
                    [q.questionId]: Number(e.target.value),
                  }))
                }
              />
              {validationErrors[q.questionId] && (
                <p className="text-sm text-destructive">
                  {validationErrors[q.questionId]}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`comment-${q.questionId}`}>评语（可选）</Label>
              <Textarea
                id={`comment-${q.questionId}`}
                data-testid={`grading-comment-input-${q.questionId}`}
                value={comments[q.questionId] ?? ""}
                onChange={(e) =>
                  setComments((prev) => ({
                    ...prev,
                    [q.questionId]: e.target.value,
                  }))
                }
                placeholder="输入评语..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid={`grading-save-btn-${q.questionId}`}
                onClick={() => handleSave(q.questionId, q.maxScore)}
                disabled={saving[q.questionId]}
              >
                {saving[q.questionId] ? "保存中..." : "保存"}
              </Button>
              {q.entry && (
                <span className="text-sm text-muted-foreground">
                  已评分: {q.entry.score} 分
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
