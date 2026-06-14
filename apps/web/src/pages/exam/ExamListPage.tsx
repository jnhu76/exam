import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Clock, Trophy } from "lucide-react";

interface CandidateExam {
  examId: string;
  title: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  openAt: string;
  closeAt: string;
  questionCount: number;
  attemptCount: number;
  maxAttempts: number;
  finalScore: number | null;
  finalPassed: boolean | null;
  finalAttemptId: string | null;
  isAvailable: boolean;
  isEnded: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExamCard({
  exam,
  onStart,
  onResult,
}: {
  exam: CandidateExam;
  onStart: (examId: string) => void;
  onResult: (attemptId: string) => void;
}) {
  return (
    <Card className="shadow-sm" data-testid={`exam-card-${exam.examId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{exam.title}</CardTitle>
          {exam.finalPassed && (
            <Badge variant="default" className="shrink-0">
              <Trophy className="mr-1 size-3" />
              {exam.finalScore}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {exam.durationMinutes}分钟
          </span>
          <span>
            及格分: {exam.passingScore}/{exam.totalScore}
          </span>
          <span>题目数: {exam.questionCount}</span>
          <span>
            已考: {exam.attemptCount}/{exam.maxAttempts}次
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {formatTime(exam.openAt)} — {formatTime(exam.closeAt)}
        </div>
        <div className="flex justify-end">
          {exam.isAvailable ? (
            <Button
              size="sm"
              onClick={() => onStart(exam.examId)}
              data-testid="exam-start-btn"
            >
              开始考试
            </Button>
          ) : exam.finalAttemptId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResult(exam.finalAttemptId!)}
              data-testid="exam-result-btn"
            >
              查看结果
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ExamListPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<CandidateExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<CandidateExam[]>("/api/candidate/exams");
      setExams(data.filter(Boolean));
    } catch {
      setError("加载考试列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  function handleStart(examId: string) {
    navigate(routes.exam.start(examId));
  }

  function handleResult(attemptId: string) {
    navigate(routes.exam.result(attemptId));
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  const available = exams.filter((e) => e.isAvailable);
  const ended = exams.filter((e) => e.isEnded);

  return (
    <div className="mx-auto max-w-4xl flex flex-col gap-6 p-6">
      {available.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">可参加的考试</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {available.map((exam) => (
              <ExamCard
                key={exam.examId}
                exam={exam}
                onStart={handleStart}
                onResult={handleResult}
              />
            ))}
          </div>
        </section>
      )}

      {ended.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">已结束</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {ended.map((exam) => (
              <ExamCard
                key={exam.examId}
                exam={exam}
                onStart={handleStart}
                onResult={handleResult}
              />
            ))}
          </div>
        </section>
      )}

      {exams.length === 0 && (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="暂无可参加的考试"
          description="当前没有可用的考试。"
        />
      )}
    </div>
  );
}
