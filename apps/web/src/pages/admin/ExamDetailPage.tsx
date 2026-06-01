import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users } from "lucide-react";

interface ExamDetail {
  id: string;
  title: string;
  description: string;
  courseId: string;
  status: string;
  timingMode: string;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  controlFlags: Record<string, unknown>;
  retakePolicy: string;
  scoreStrategy: string;
  maxAttempts: number;
  stats: {
    participantCount: number;
    completedCount: number;
    passedCount: number;
  };
  participants: Array<{
    candidateId: string;
    name: string;
    fields: Record<string, unknown>;
    status: string;
    score: number | null;
    passed: boolean | null;
  }>;
}

const statusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  open: "进行中",
  closed: "已结束",
  archived: "已归档",
};

export function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExam = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<ExamDetail>(`/api/exams/${id}`);
      setExam(data);
    } catch {
      setError("加载考试详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  async function handlePublish() {
    if (!id) return;
    await api.post(`/api/exams/${id}/publish`);
    await loadExam();
  }

  async function handleArchive() {
    if (!id) return;
    await api.post(`/api/exams/${id}/archive`);
    await loadExam();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExam} />;
  if (!exam) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={exam.title}
        actions={
          <div className="flex gap-2">
            {exam.status === "draft" && (
              <Button onClick={() => void handlePublish()}>发布考试</Button>
            )}
            {(exam.status === "published" || exam.status === "closed") && (
              <Button variant="outline" onClick={() => void handleArchive()}>
                归档
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/exams")}
            >
              返回列表
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{statusLabels[exam.status] ?? exam.status}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              考试时长
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.durationMinutes}分钟</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              及格分
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {exam.passingScore}/{exam.totalScore}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              题目数量
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.questionIds.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">考试配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <span className="text-muted-foreground">时间模式：</span>
            <span>{exam.timingMode}</span>
            <span className="text-muted-foreground">重考策略：</span>
            <span>{exam.retakePolicy}</span>
            <span className="text-muted-foreground">分数策略：</span>
            <span>{exam.scoreStrategy}</span>
            <span className="text-muted-foreground">最大尝试次数：</span>
            <span>{exam.maxAttempts}</span>
            <span className="text-muted-foreground">开始时间：</span>
            <span>{new Date(exam.openAt).toLocaleString()}</span>
            <span className="text-muted-foreground">结束时间：</span>
            <span>{new Date(exam.closeAt).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              参与人数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.stats.participantCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              已完成
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.stats.completedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              已通过
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.stats.passedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">候选人列表</CardTitle>
        </CardHeader>
        <CardContent>
          {exam.participants.length === 0 ? (
            <EmptyState
              icon={<Users className="size-8" />}
              title="暂无报名候选人"
              description="还没有候选人报名参加此考试。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>身份信息</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>成绩</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exam.participants.map((participant) => (
                  <TableRow key={participant.candidateId}>
                    <TableCell>
                      {Object.values(participant.fields)
                        .map(String)
                        .join(" / ") || participant.candidateId.slice(0, 8)}
                    </TableCell>
                    <TableCell>{participant.name}</TableCell>
                    <TableCell>{participant.status}</TableCell>
                    <TableCell>{participant.score ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
